package local.review;

import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Read MinerU's page-indexed block list; whole-document Markdown loses source locations. */
final class MinerU {
  private static final ObjectMapper JSON = new ObjectMapper();
  private final URI base;

  MinerU(String endpoint) {
    base = URI.create(endpoint);
    if (!"http".equals(base.getScheme())
        || !Set.of("localhost", "127.0.0.1", "[::1]").contains(base.getHost()))
      throw new IllegalArgumentException("MinerU requires a local HTTP endpoint");
  }

  private HttpURLConnection connect(String path, int timeout) throws IOException {
    var connection = (HttpURLConnection) base.resolve(path).toURL().openConnection(Proxy.NO_PROXY);
    connection.setConnectTimeout(700);
    connection.setReadTimeout(timeout);
    connection.setInstanceFollowRedirects(false);
    return connection;
  }

  boolean available() {
    try {
      var c = connect("/openapi.json", 3000);
      try (var in = c.getInputStream()) {
        return JSON.readTree(in.readNBytes(1_000_000)).path("paths").has("/file_parse");
      } finally {
        c.disconnect();
      }
    } catch (IOException e) {
      return false;
    }
  }

  List<Catalog.Segment> parse(Path pdf, int count, boolean forceOcr) throws IOException {
    String boundary = "review-" + UUID.randomUUID();
    var header = new StringBuilder();
    var fields =
        Map.of(
            "backend",
            "pipeline",
            "parse_method",
            forceOcr ? "ocr" : "auto",
            "lang_list",
            "ch",
            "response_format_zip",
            "true",
            "return_content_list",
            "true",
            "return_md",
            "false",
            "return_images",
            "false",
            "formula_enable",
            "false",
            "table_enable",
            "false");
    fields.forEach(
        (key, value) ->
            header
                .append("--")
                .append(boundary)
                .append("\r\nContent-Disposition: form-data; name=\"")
                .append(key)
                .append("\"\r\n\r\n")
                .append(value)
                .append("\r\n"));
    header
        .append("--")
        .append(boundary)
        .append(
            "\r\n"
                + "Content-Disposition: form-data; name=\"files\"; filename=\"source.pdf\"\r\n"
                + "Content-Type: application/pdf\r\n\r\n");
    byte[] start = header.toString().getBytes(StandardCharsets.US_ASCII);
    byte[] end = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.US_ASCII);
    var c = connect("/file_parse", 3_600_000);
    try {
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
      c.setFixedLengthStreamingMode(start.length + Files.size(pdf) + end.length);
      try (var out = c.getOutputStream()) {
        out.write(start);
        Files.copy(pdf, out);
        out.write(end);
      }
      if (c.getResponseCode() != 200) throw new IOException("MinerU HTTP " + c.getResponseCode());
      try (var in = c.getInputStream()) {
        return read(in, count);
      }
    } finally {
      c.disconnect();
    }
  }

  static List<Catalog.Segment> read(InputStream response, int count) throws IOException {
    try (var zip = new ZipInputStream(response)) {
      for (ZipEntry entry; (entry = zip.getNextEntry()) != null; ) {
        if (!entry.getName().endsWith("_content_list.json")) continue;
        int limit = 64 * 1024 * 1024;
        byte[] bytes = zip.readNBytes(limit + 1);
        if (bytes.length > limit) throw new IOException("Oversized MinerU block list");
        JsonNode blocks = JSON.readTree(bytes);
        if (blocks == null || !blocks.isArray()) throw new IOException("Invalid MinerU block list");
        var pages = new StringBuilder[count];
        Arrays.setAll(pages, i -> new StringBuilder());
        for (JsonNode b : blocks) {
          var index = b.path("page_idx");
          if (!index.isIntegralNumber()
              || !index.canConvertToInt()
              || index.asInt() < 0
              || index.asInt() >= count) throw new IOException("Invalid MinerU source page");
          var page = pages[index.asInt()];
          switch (b.path("type").asText()) {
            case "text" -> {
              String line = b.path("text").asText("").strip();
              if (!line.isEmpty()) {
                if (b.path("text_level").asInt() > 0) page.append("### ");
                page.append(line).append('\n');
              }
            }
            case "list" -> {
              for (var line : b.path("list_items"))
                if (line.isTextual()) page.append(line.textValue()).append('\n');
            }
            default -> {
              /* Figures, tables, formulae and marginalia remain in the original preview. */
            }
          }
        }
        var result = new ArrayList<Catalog.Segment>();
        for (int i = 0; i < count; i++) {
          String body = pages[i].toString().strip();
          result.add(new Catalog.Segment(i + 1, body, PageText.suspect(body)));
        }
        return result;
      }
      throw new IOException("MinerU ZIP contains no page-indexed block list");
    }
  }
}
