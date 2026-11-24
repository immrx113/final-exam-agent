import com.google.gson.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;

public class Probe {
    static final Gson JSON = new GsonBuilder().setPrettyPrinting().serializeNulls().disableHtmlEscaping().create();
    static final Path ROOT = Path.of("").toAbsolutePath();
    static Path out;

    static void save(String name, Object value) throws IOException {
        Files.writeString(out.resolve(name), JSON.toJson(value));
    }

    static BufferedImage examPage(int pageNumber) {
        BufferedImage image = new BufferedImage(1400, 680, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, image.getWidth(), image.getHeight());
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setFont(new Font("Microsoft YaHei", Font.BOLD, 48));
        g.setColor(new Color(28, 52, 72));
        g.drawString("第" + pageNumber + "题", 80, 140);
        g.setFont(new Font("Microsoft YaHei", Font.PLAIN, 44));
        if (pageNumber == 2) {
            // Simulate information lost in a damaged scan by downsampling the equation.
            BufferedImage equation = new BufferedImage(540, 85, BufferedImage.TYPE_INT_RGB);
            Graphics2D ink = equation.createGraphics();
            ink.setColor(Color.WHITE);
            ink.fillRect(0, 0, 540, 85);
            ink.setColor(Color.GRAY);
            ink.setFont(g.getFont());
            ink.drawString("求 πₓ (R ⋈ S) 的结果。", 0, 54);
            ink.dispose();
            Image faded = equation.getScaledInstance(36, 6, Image.SCALE_AREA_AVERAGING);
            g.drawImage(faded, 80, 205, 540, 85, null);
        } else if (pageNumber == 3) {
            String lead = "关系代数表达式 π";
            g.drawString(lead, 80, 260);
            int subscriptX = 80 + g.getFontMetrics().stringWidth(lead);
            Font body = g.getFont();
            g.setFont(body.deriveFont(26f));
            g.drawString("x", subscriptX, 271);
            int nextX = subscriptX + g.getFontMetrics().stringWidth("x");
            g.setFont(body);
            g.drawString("(R) 只保留哪些属性？", nextX, 260);
            g.drawString("说明投影与选择的区别。", 80, 352);
        } else {
            g.drawString("能唯一标识元组的最小属性集合叫什么？", 80, 260);
            g.drawString("说明为什么不能再删去其中任何一个属性。", 80, 352);
        }
        g.dispose();
        return image;
    }

    static void makeExam() throws IOException {
        try (var pdf = new PDDocument()) {
            for (int pageNumber = 1; pageNumber <= 3; pageNumber++) {
                BufferedImage image = examPage(pageNumber);
                if (pageNumber == 1) ImageIO.write(image, "png", out.resolve("clear.png").toFile());
                if (pageNumber == 2) ImageIO.write(image, "jpg", out.resolve("unclear.jpg").toFile());
                var page = new PDPage(new PDRectangle(700, 340));
                pdf.addPage(page);
                try (var content = new PDPageContentStream(pdf, page)) {
                    content.drawImage(LosslessFactory.createFromImage(pdf, image), 0, 0, 700, 340);
                }
            }
            pdf.save(out.resolve("exam.pdf").toFile());
        }
    }

    static String ocr(Path image) throws Exception {
        Path log = out.resolve("ocr-errors.log");
        var process = new ProcessBuilder("powershell.exe", "-NoProfile", "-NonInteractive",
            "-ExecutionPolicy", "Bypass", "-File", ROOT.resolve("ocr.ps1").toString(),
            image.toString()).redirectError(ProcessBuilder.Redirect.appendTo(log.toFile())).start();
        String text = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (process.waitFor() != 0) throw new IOException("OCR failed; see " + log.getFileName());
        return text.strip();
    }

    record Segment(String id, String text) {}
    record Match(String segment, String question, String concept, Double score, String review) {}
    record Response(int version, String batch, Match[] matches, JsonObject metrics) {}

    static String compact(String text) { return text.replaceAll("\\s+", ""); }

    static JsonObject location(JsonObject item) throws Exception {
        String file = item.get("file").getAsString();
        String actual, link = file;
        if (item.has("page")) {
            int page = item.get("page").getAsInt();
            Path preview = out.resolve(file + ".pdf");
            link = preview.getFileName() + "#page=" + page;
            try (var pdf = Loader.loadPDF(preview.toFile())) {
                if (page > pdf.getNumberOfPages()) throw new IOException("Missing preview page");
                var stripper = new PDFTextStripper();
                stripper.setStartPage(page);
                stripper.setEndPage(page);
                actual = stripper.getText(pdf);
            }
        } else if (item.has("line")) {
            var lines = Files.readAllLines(out.resolve(file));
            int target = item.get("line").getAsInt();
            actual = lines.get(target - 1);
            var preview = new StringBuilder("<!doctype html><meta charset='utf-8'><title>资料原文</title><ol>");
            for (int i = 0; i < lines.size(); i++)
                preview.append("<li id='L").append(i + 1).append("'>").append(escape(lines.get(i))).append("</li>");
            Files.writeString(out.resolve(file + ".html"), preview.append("</ol>").toString());
            link = file + ".html#L" + target;
        } else {
            actual = ocr(out.resolve(file));
        }
        JsonObject result = item.deepCopy();
        result.addProperty("link", link);
        result.addProperty("actual", actual.strip());
        result.addProperty("passed", compact(actual).contains(item.get("contains").getAsString()));
        return result;
    }

    static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    .replace("\"", "&quot;");
    }

    public static void main(String[] args) throws Exception {
        out = Path.of(args[0]).toAbsolutePath();
        makeExam();
        JsonObject truth = JsonParser.parseString(Files.readString(ROOT.resolve("fixtures/truth.json"))).getAsJsonObject();
        var segments = new ArrayList<Segment>();
        try (var pdf = Loader.loadPDF(out.resolve("exam.pdf").toFile())) {
            var renderer = new PDFRenderer(pdf);
            for (int i = 0; i < pdf.getNumberOfPages(); i++) {
                Path image = out.resolve("page-" + (i + 1) + ".png");
                ImageIO.write(renderer.renderImageWithDPI(i, 144), "png", image.toFile());
                segments.add(new Segment("exam-p" + (i + 1), ocr(image)));
            }
        }
        String batch = UUID.randomUUID().toString();
        save("request.json", Map.of("version", 1, "batch", batch, "concepts", truth.get("concepts"),
            "segments", segments));
        var agent = new ProcessBuilder(args[1], ROOT.resolve("agent.py").toString())
            .redirectInput(out.resolve("request.json").toFile())
            .redirectOutput(out.resolve("response.json").toFile()).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        if (!agent.waitFor(120, java.util.concurrent.TimeUnit.SECONDS)) {
            agent.destroyForcibly();
            throw new IOException("Agent timeout");
        }
        if (agent.exitValue() != 0) throw new IOException("Agent failed");
        Response response = JSON.fromJson(Files.readString(out.resolve("response.json")), Response.class);
        if (response.version != 1 || !batch.equals(response.batch) || response.matches.length != segments.size())
            throw new IOException("Batch identity or size mismatch");
        Map<String,String> concepts = new HashMap<>();
        for (var item : truth.getAsJsonArray("concepts")) {
            var c = item.getAsJsonObject();
            concepts.put(c.get("id").getAsString(), c.get("description").getAsString());
        }
        Map<String,Match> matches = new HashMap<>();
        Set<String> ids = new HashSet<>();
        segments.forEach(s -> ids.add(s.id));
        for (Match m : response.matches) {
            if (!ids.contains(m.segment) || matches.put(m.segment, m) != null || m.review == null ||
                (m.review.isBlank() ? !concepts.containsKey(m.concept) : m.concept != null))
                throw new IOException("Invalid evidence or concept in model response");
        }
        var html = new StringBuilder("<!doctype html><html lang='zh-CN'><meta charset='utf-8'><title>M0 原页核对</title><main><h1>数据库原理 · 样例核对</h1><p>下方显示 OCR 原始文本。公式与下标可打开试卷原页核对。</p>");
        var evaluated = new JsonArray();
        boolean passed = true;
        for (var entry : truth.getAsJsonArray("questions")) {
            var expected = entry.getAsJsonObject();
            int page = expected.get("page").getAsInt();
            Segment s = segments.get(page - 1);
            Match m = matches.get(s.id);
            String expectedConcept = JSON.fromJson(expected.get("concept"), String.class);
            boolean ok = Objects.equals(m.concept, expectedConcept) &&
                Objects.equals(m.question, expected.get("question").getAsString()) &&
                expected.get("review").getAsBoolean() == !m.review.isBlank();
            passed &= ok;
            var result = expected.deepCopy();
            result.add("actual", JSON.toJsonTree(m));
            result.addProperty("passed", ok);
            evaluated.add(result);
            html.append("<section><h2>试卷第 ").append(page).append(" 页</h2><p>")
                .append(escape(m.concept == null ? "待核对：" + m.review :
                    concepts.get(m.concept)))
                .append("</p><pre>").append(escape(s.text)).append("</pre><a href='exam.pdf#page=")
                .append(page).append("'>打开试卷原页</a> · <a href='page-").append(page)
                .append(".png'>查看该页扫描图</a></section>");
        }
        var locations = new JsonArray();
        html.append("<h2>格式与来源定位</h2><ul>");
        for (var item : truth.getAsJsonArray("locations")) {
            var input = item.getAsJsonObject();
            JsonObject result;
            try { result = location(input); }
            catch (Exception e) {
                result = input.deepCopy();
                result.addProperty("error", e.getClass().getSimpleName());
                result.addProperty("passed", false);
            }
            locations.add(result);
            boolean ok = result.get("passed").getAsBoolean();
            passed &= ok;
            html.append("<li>").append(ok ? "通过 " : "待核对 ");
            if (result.has("link")) html.append("<a href='").append(result.get("link").getAsString()).append("'>");
            html.append(escape(input.get("file").getAsString()));
            if (result.has("link")) html.append("</a>");
            html.append("</li>");
        }
        Files.writeString(out.resolve("index.html"), html.append("</ul></main></html>").toString());
        save("evaluation.json", Map.of("questions", evaluated, "locations", locations,
            "metrics", response.metrics, "passed", passed));
        System.out.println("Evaluation: " + passed + " | " + out.resolve("index.html"));
        if (!passed) System.exit(2);
    }
}
