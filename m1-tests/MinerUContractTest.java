package local.review;

import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.zip.*;

public class MinerUContractTest {
  private static byte[] zip(String blocks) throws IOException {
    var bytes = new ByteArrayOutputStream();
    try (var out = new ZipOutputStream(bytes)) {
      out.putNextEntry(new ZipEntry("source/ocr/source_content_list.json"));
      out.write(blocks.getBytes(StandardCharsets.UTF_8));
    }
    return bytes.toByteArray();
  }

  public static void main(String[] args) throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    byte[] data =
        zip(
            """
            [{"page_idx":0,"type":"page_footer","text":"1/2"},
             {"page_idx":0,"type":"text","text_level":1,"text":"自然连接"},
             {"page_idx":0,"type":"list","list_items":["按公共属性连接"]},
             {"page_idx":1,"type":"table","table_body":"<td>乱码</td>"}]
            """);
    server.createContext(
        "/file_parse",
        e -> {
          String body = new String(e.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
          boolean valid =
              body.contains("name=\"files\"; filename=\"source.pdf\"")
                  && body.contains("name=\"backend\"\r\n\r\npipeline")
                  && body.contains("name=\"parse_method\"\r\n\r\nocr")
                  && body.contains("name=\"return_content_list\"\r\n\r\ntrue");
          e.sendResponseHeaders(valid ? 200 : 422, data.length);
          try (var out = e.getResponseBody()) {
            out.write(data);
          }
        });
    Path file = Files.createTempFile("mineru-contract-", ".pdf");
    try {
      server.start();
      var client = new MinerU("http://127.0.0.1:" + server.getAddress().getPort());
      var pages = client.parse(file, 2, true);
      if (!pages.get(0).body().equals("### 自然连接\n按公共属性连接")
          || pages.get(1).pos() != 2
          || !pages.get(1).review()) throw new AssertionError(pages);
      try {
        MinerU.read(new ByteArrayInputStream(data), 1);
        throw new AssertionError("Accepted a page outside the document");
      } catch (IOException expected) {
        /* invalid source page */
      }
      System.out.println(
          "PASS local HTTP multipart, ZIP, body order, source pages and layout exclusions");
    } finally {
      server.stop(0);
      Files.deleteIfExists(file);
    }
  }
}
