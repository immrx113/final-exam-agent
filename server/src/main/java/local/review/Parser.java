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
    return switch (kind(input.toString())) {
      case "line" -> markdown(input, dir);
      case "image" -> image(input, dir);
      case "page" -> pdf(input, dir);
      default -> {
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
        yield pdf(dir.resolve("source.pdf"), dir);
      }
    };
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

  private List<Catalog.Segment> image(Path input, Path dir) throws Exception {
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
    return List.of(recognize(image, 1, dir));
  }

  private List<Catalog.Segment> pdf(Path input, Path dir) throws Exception {
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
        result.add(
            text.isEmpty() ? recognize(image, page, dir) : new Catalog.Segment(page, text, false));
      }
    }
    return result;
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
