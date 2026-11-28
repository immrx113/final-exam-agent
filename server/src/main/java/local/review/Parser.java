package local.review;

import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.util.HtmlUtils;

@Service
class Parser {
  private final String office;
  private final Path ocr;
  private MinerU layout;
  private String layoutEndpoint;
  @Value("${review.parser-revision:1}")
  private String revision = "1";

  static final class Run {
    final String layoutVersion;
    final boolean force;
    int parses, conversions, rendered, ocrPages, layoutPages;
    Run(String layoutVersion, boolean force) {
      this.layoutVersion = layoutVersion;
      this.force = force;
    }
  }

  Run plan(String name, boolean force) {
    boolean paged = Set.of("page", "rendered").contains(kind(name));
    return new Run(paged && layout != null ? layout.apiVersion() : null, force);
  }

  String profile(String name, Run run) throws IOException {
    String kind = kind(name);
    var parts = new ArrayList<>(List.of("parser-v1", revision, kind));
    if (!kind.equals("line")) {
      parts.add(System.getProperty("os.version"));
      if (run.layoutVersion != null) parts.add("mineru-pipeline-ch:" + layoutEndpoint + ":" + run.layoutVersion);
      else {
        parts.add("windows-ocr:" + ocr);
        if (Files.isRegularFile(ocr)) parts.add(ArtifactStore.hash(ocr));
      }
      if (!kind.equals("image")) parts.add(org.apache.pdfbox.util.Version.getVersion());
      if (kind.equals("rendered")) {
        parts.add(office);
        Path exe = Path.of(office);
        if (Files.isRegularFile(exe)) parts.add(Files.getLastModifiedTime(exe).toString());
        Path version = exe.resolveSibling("version.ini");
        if (Files.isRegularFile(version)) parts.add(ArtifactStore.hash(version));
      }
    }
    return String.join("\n", parts);
  }

  @Value("${review.mineru-url:http://127.0.0.1:8000}")
  void configureLayout(String endpoint) {
    layoutEndpoint = endpoint;
    layout = endpoint.isBlank() ? null : new MinerU(endpoint);
  }

  private List<Catalog.Segment> readLayout(Path pdf, List<Catalog.Segment> previous, boolean force)
      throws IOException {
    var parsed = layout.parse(pdf, previous.size(), force);
    var result = new ArrayList<Catalog.Segment>();
    for (var p : parsed) {
      result.add(
          p.body().isBlank()
              ? new Catalog.Segment(p.pos(), previous.get(p.pos() - 1).body(), true)
              : p);
    }
    return result;
  }

  Parser(@Value("${review.office}") String office, @Value("${review.ocr}") String ocr) {
    this.office = office;
    this.ocr = Path.of(ocr).toAbsolutePath();
  }

  static String extension(String name) {
    return name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
  }

  static String kind(String name) {
    return switch (extension(name)) {
      case "md" -> "line";
      case "png", "jpg", "jpeg" -> "image";
      case "pdf" -> "page";
      default -> "rendered";
    };
  }

  List<Catalog.Segment> parse(Path input, Path dir) throws Exception {
    return parse(input, dir, plan(input.toString(), false));
  }

  List<Catalog.Segment> parse(Path input, Path dir, Run run) throws Exception {
    run.parses++;
    return switch (kind(input.toString())) {
      case "line" -> markdown(input, dir);
      case "image" -> image(input, dir, run);
      case "page" -> pdf(input, dir, run);
      default -> {
        run.conversions++;
        yield pdf(convertOffice(input, dir), dir, run);
      }
    };
  }

  private Path convertOffice(Path input, Path dir) throws Exception {
    execute(
        dir,
        90,
        office,
        "-env:UserInstallation=" + dir.resolve("profile").toUri(),
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        dir.toString(),
        input.toString());
    return dir.resolve("source.pdf");
  }

  private List<Catalog.Segment> markdown(Path input, Path dir) throws IOException {
    var result = new ArrayList<Catalog.Segment>();
    var html = new StringBuilder("<!doctype html><meta charset=utf-8><title>资料原文</title><ol>");
    var lines = Files.readAllLines(input, StandardCharsets.UTF_8);
    for (int i = 0; i < lines.size(); i++) {
      String line = lines.get(i);
      html.append("<li id=L")
          .append(i + 1)
          .append("><pre>")
          .append(HtmlUtils.htmlEscape(line))
          .append("</pre></li>");
      if (!line.isBlank()) result.add(new Catalog.Segment(i + 1, line, false));
    }
    Files.writeString(dir.resolve("lines.html"), html.append("</ol>").toString());
    return result;
  }

  private List<Catalog.Segment> image(Path input, Path dir, Run run) throws Exception {
    try (var stream = ImageIO.createImageInputStream(input.toFile())) {
      var readers = ImageIO.getImageReaders(stream);
      if (!readers.hasNext()) throw new IOException("无效图片");
      var reader = readers.next();
      try {
        reader.setInput(stream);
        String type = extension(input.toString()).equals("png") ? "png" : "jpeg";
        if (!reader.getFormatName().equalsIgnoreCase(type)
            || (long) reader.getWidth(0) * reader.getHeight(0) > 40_000_000)
          throw new IOException("图片格式或尺寸无效");
      } finally {
        reader.dispose();
      }
    }
    BufferedImage decoded = ImageIO.read(input.toFile());
    if (decoded == null) throw new IOException("无效图片");
    Path image = dir.resolve("1.png");
    ImageIO.write(decoded, "png", image.toFile());
    run.ocrPages++;
    return List.of(recognize(image, 1, dir));
  }

  private List<Catalog.Segment> pdf(Path input, Path dir, Run run) throws Exception {
    var result = new ArrayList<Catalog.Segment>();
    try (var document = Loader.loadPDF(input.toFile())) {
      var renderer = new PDFRenderer(document);
      var strip = new PDFTextStripper();
      for (int page = 1; page <= document.getNumberOfPages(); page++) {
        strip.setStartPage(page);
        strip.setEndPage(page);
        String text = strip.getText(document).strip();
        Path image = dir.resolve(page + ".png");
        var box = document.getPage(page - 1).getCropBox();
        float dimension = Math.max(box.getWidth(), box.getHeight());
        float dpi = Math.min(144, 3000f * 72 / Math.max(1, dimension));
        ImageIO.write(renderer.renderImageWithDPI(page - 1, dpi), "png", image.toFile());
        run.rendered++;
        result.add(new Catalog.Segment(page, text, false));
      }
    }
    if (run.layoutVersion != null) {
      boolean forceOcr = run.force || result.stream().anyMatch(p -> PageText.suspect(p.body()));
      run.layoutPages += result.size();
      if (forceOcr) run.ocrPages += result.size();
      return readLayout(input, result, forceOcr);
    }
    return improve(result, dir, run);
  }

  private List<Catalog.Segment> improve(List<Catalog.Segment> pages, Path dir, Run run) throws Exception {
    var pending = pages.stream().filter(p -> PageText.suspect(p.body())).toList();
    if (pending.isEmpty()) return pages;
    Map<Integer, Catalog.Segment> replacements = new HashMap<>();
    Path manifest = dir.resolve("ocr-pages.txt");
    for (int start = 0; start < pending.size(); start += 16) {
      var batch = pending.subList(start, Math.min(start + 16, pending.size()));
      run.ocrPages += batch.size();
      Files.write(
          manifest, batch.stream().map(p -> dir.resolve(p.pos() + ".png").toString()).toList());
      try {
        execute(
            dir,
            45 * batch.size(),
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            ocr.toString(),
            "-PageList",
            manifest.toString());
      } catch (IOException e) {
        if (run.force) throw e;
        /* Keep readable source text and flag incomplete pages. */
      }
      for (var original : batch) {
        Path output = dir.resolve(original.pos() + ".png.txt");
        if (run.force && !Files.isRegularFile(output)) throw new IOException("重新识别未返回页面");
        String read = Files.exists(output) ? PageText.fromOcr(Files.readString(output)) : "";
        boolean uncertain = PageText.suspect(read) || read.replaceAll("\\s", "").length() < 8;
        replacements.put(
            original.pos(),
            new Catalog.Segment(
                original.pos(), read.isBlank() ? PageText.body(original.body()) : read, uncertain));
      }
    }
    return pages.stream().map(p -> replacements.getOrDefault(p.pos(), p)).toList();
  }

  private Catalog.Segment recognize(Path image, int page, Path dir) throws InterruptedException {
    try {
      execute(
          dir,
          45,
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          ocr.toString(),
          image.toString());
      String body = Files.readString(dir.resolve("stdout"), StandardCharsets.UTF_8).strip();
      return new Catalog.Segment(page, body, body.replaceAll("\\s", "").length() < 8);
    } catch (IOException e) {
      return new Catalog.Segment(page, "", true);
    }
  }

  private static void execute(Path dir, int timeout, String... args)
      throws IOException, InterruptedException {
    var proc =
        new ProcessBuilder(args)
            .directory(dir.toFile())
            .redirectOutput(dir.resolve("stdout").toFile())
            .redirectError(dir.resolve("stderr").toFile())
            .start();
    try {
      if (!proc.waitFor(timeout, TimeUnit.SECONDS) || proc.exitValue() != 0)
        throw new IOException("转换工具未完成");
    } finally {
      if (proc.isAlive()) {
        proc.descendants().forEach(ProcessHandle::destroyForcibly);
        proc.destroyForcibly();
      }
    }
  }
}
