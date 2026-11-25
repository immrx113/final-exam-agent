package local.review;

import jakarta.servlet.http.HttpServletResponse;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/course")
class ImportApi {
  static final Set<String> FORMATS =
      Set.of("pdf", "ppt", "pptx", "doc", "docx", "md", "png", "jpg", "jpeg");
  static final Set<String> ROLES = Set.of("courseware", "material", "exam");
  final Catalog db;
  final Store store;

  ImportApi(Catalog db, Store store) {
    this.db = db;
    this.store = store;
  }

  private static ResponseStatusException invalid() {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST);
  }

  private static ResponseStatusException missing() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND);
  }

  private static String hex(byte[] bytes) {
    return HexFormat.of().formatHex(bytes);
  }

  @PostMapping(value = "/files", headers = "X-Review-Request=1")
  Map<String, String> upload(@RequestParam MultipartFile file, @RequestParam String role)
      throws Exception {
    String name = Objects.toString(file.getOriginalFilename(), "");
    if (name.isBlank()
        || name.length() > 255
        || name.chars().anyMatch(c -> c < 32 || c == 127)
        || name.contains("/")
        || name.contains("\\")
        || !ROLES.contains(role)
        || file.isEmpty()) throw invalid();
    if (!name.contains(".") || !FORMATS.contains(Parser.extension(name)))
      throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    Path temp = Files.createTempFile("review-upload-", ".bin");
    try {
      var hash = MessageDigest.getInstance("SHA-256");
      try (var src = new DigestInputStream(file.getInputStream(), hash)) {
        Files.copy(src, temp, StandardCopyOption.REPLACE_EXISTING);
      }
      String digest = hex(hash.digest());
      String id =
          hex(hash.digest((role + "\0" + name + "\0" + digest).getBytes(StandardCharsets.UTF_8)));
      putOriginal(digest, temp);
      db.addFile(new Catalog.FileRow(id, name, role, digest));
      return Map.of("id", id);
    } finally {
      Files.deleteIfExists(temp);
    }
  }

  private void putOriginal(String digest, Path temp) {
    try {
      store.put("original/" + digest, temp);
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  record ListedFile(String id, String name, String role) {}

  @GetMapping("/files")
  List<ListedFile> files() {
    return db.files().stream().map(f -> new ListedFile(f.id(), f.name(), f.role())).toList();
  }

  record Submission(List<String> files) {}

  @PostMapping(value = "/jobs", headers = "X-Review-Request=1")
  @Transactional
  Map<String, String> submit(@RequestBody Submission input) {
    if (input.files() == null
        || input.files().isEmpty()
        || input.files().size() != new HashSet<>(input.files()).size()) throw invalid();
    if (input.files().stream().anyMatch(id -> id == null || !id.matches("[0-9a-f]{64}")))
      throw invalid();
    String manifest = String.join(",", new TreeSet<>(input.files()));
    String job = UUID.nameUUIDFromBytes(manifest.getBytes(StandardCharsets.US_ASCII)).toString();
    db.job(job);
    var existing = db.items(job);
    if (existing.isEmpty()) {
      for (String id : input.files()) {
        if (id == null || db.file(id) == null) throw invalid();
        db.queue(job, id);
      }
    } else if (!new HashSet<>(input.files())
        .equals(new HashSet<>(existing.stream().map(Catalog.Item::file).toList()))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT);
    }
    return Map.of("id", job);
  }

  @GetMapping("/jobs")
  List<String> jobs() {
    return db.jobs();
  }

  @GetMapping("/jobs/{job}")
  List<Catalog.Item> items(@PathVariable UUID job) {
    var result = db.items(job.toString());
    if (result.isEmpty()) throw missing();
    return result;
  }

  @PostMapping(value = "/jobs/{job}/{file}/retry", headers = "X-Review-Request=1")
  void retry(@PathVariable UUID job, @PathVariable String file) {
    if (db.retry(job.toString(), file) != 1) throw new ResponseStatusException(HttpStatus.CONFLICT);
  }

  record Source(String id, int pos, String body, boolean review, String label, String url) {}

  @PostMapping(value = "/jobs/{job}/{file}/recheck", headers = "X-Review-Request=1")
  void recheck(@PathVariable UUID job, @PathVariable String file) {
    var row = db.file(file);
    if (row == null || !Set.of("page", "rendered").contains(Parser.kind(row.name())))
      throw invalid();
    if (db.recheck(job.toString(), file) != 1)
      throw new ResponseStatusException(HttpStatus.CONFLICT);
  }

  @GetMapping("/jobs/{job}/{file}/segments")
  List<Source> segments(@PathVariable UUID job, @PathVariable String file) {
    var f = db.file(file);
    if (f == null || db.preview(job.toString(), file) == null) throw missing();
    String kind = Parser.kind(f.name());
    return db.segments(job.toString(), file).stream()
        .map(
            s -> {
              String label =
                  switch (kind) {
                    case "line" -> "第 " + s.pos() + " 行";
                    case "image" -> "原图";
                    case "rendered" -> "转换预览第 " + s.pos() + " 页";
                    default -> "原文第 " + s.pos() + " 页";
                  };
              String url = "/api/course/jobs/" + job + "/" + file + "/preview/" + s.pos();
              if (kind.equals("line")) url += "#L" + s.pos();
              return new Source(file + "-" + s.pos(), s.pos(), s.body(), s.review(), label, url);
            })
        .toList();
  }

  @GetMapping("/jobs/{job}/{file}/preview/{pos}")
  void preview(
      @PathVariable UUID job,
      @PathVariable String file,
      @PathVariable int pos,
      HttpServletResponse res)
      throws Exception {
    String prefix = db.preview(job.toString(), file);
    if (prefix == null || pos < 1) throw missing();
    var row = db.file(file);
    if (Parser.kind(row.name()).equals("image")) {
      if (pos != 1) throw missing();
      String type = Parser.extension(row.name()).equals("png") ? "image/png" : "image/jpeg";
      stream("original/" + row.digest(), type, res);
      return;
    }
    boolean line = Parser.kind(row.name()).equals("line");
    stream(
        prefix + (line ? "lines.html" : pos + ".png"),
        line ? "text/html;charset=UTF-8" : "image/png",
        res);
  }

  @GetMapping("/files/{id}/original")
  void original(@PathVariable String id, HttpServletResponse res) throws Exception {
    var file = db.file(id);
    if (file == null) throw missing();
    res.setHeader(
        "Content-Disposition",
        ContentDisposition.attachment()
            .filename(file.name(), StandardCharsets.UTF_8)
            .build()
            .toString());
    stream("original/" + file.digest(), "application/octet-stream", res);
  }

  private void stream(String key, String type, HttpServletResponse res) throws Exception {
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try (var in = store.open(key)) {
      res.setContentType(type);
      in.transferTo(res.getOutputStream());
    } catch (io.minio.errors.ErrorResponseException e) {
      if (e.errorResponse().code().equals("NoSuchKey")) throw missing();
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
