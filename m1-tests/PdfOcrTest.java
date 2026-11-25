package local.review;

import java.awt.*;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.Comparator;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.*;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;

/** Exercise the same PDF parser used after Office conversion and on direct PDF uploads. */
public class PdfOcrTest {
  public static void main(String[] args) throws Exception {
    Path dir = Files.createTempDirectory("review-ocr-test-");
    try {
      Path pdf = dir.resolve("fixture.pdf");
      try (var doc = new PDDocument()) {
        var ink = new BufferedImage(900, 200, BufferedImage.TYPE_INT_RGB);
        var g = ink.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, 900, 200);
        g.setFont(new Font("Microsoft YaHei", Font.PLAIN, 54));
        g.setColor(Color.BLACK);
        g.drawString("数据库系统的基本概念", 35, 110);
        g.dispose();
        var picture = LosslessFactory.createFromImage(doc, ink);
        var font = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
        for (String line : new String[] {"1/3", "SELECT DISTINCT id FROM courses", "3/3"}) {
          var page = new PDPage(new PDRectangle(500, 220));
          doc.addPage(page);
          try (var paint = new PDPageContentStream(doc, page)) {
            if (line.equals("1/3")) paint.drawImage(picture, 20, 80, 450, 100);
            paint.beginText();
            paint.setFont(font, 12);
            paint.newLineAtOffset(15, 15);
            paint.showText(line);
            paint.endText();
          }
        }
        doc.save(pdf.toFile());
      }
      var pages = new Parser("", "m0/ocr.ps1").parse(pdf, dir);
      if (pages.size() != 3
          || pages.get(0).review()
          || !pages.get(0).body().contains("数据库系统")
          || !pages.get(1).body().equals("SELECT DISTINCT id FROM courses")
          || !pages.get(2).review()
          || !Files.isRegularFile(dir.resolve("1.png"))) throw new AssertionError(pages);
      System.out.println("PASS rendered Chinese body, native SQL, empty-body review, preview");
    } finally {
      try (var paths = Files.walk(dir)) {
        for (Path p : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(p);
      }
    }
  }
}
