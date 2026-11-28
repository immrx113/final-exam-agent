package local.review;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.minio.errors.ErrorResponseException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class ArtifactStore {
  record Manifest(String parser, Map<String,String> previews) {}
  private final ArtifactMapper db;
  private final Store objects;
  private final ObjectMapper json;
  private final TransactionTemplate tx;

  ArtifactStore(ArtifactMapper db, Store objects, ObjectMapper json, TransactionTemplate tx) {
    this.db = db;
    this.objects = objects;
    this.json = json;
    this.tx = tx;
  }

  private static MessageDigest sha256() {
    try { return MessageDigest.getInstance("SHA-256"); }
    catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
  }

  static String hash(byte[] bytes) {
    return HexFormat.of().formatHex(sha256().digest(bytes));
  }

  static String hash(InputStream in) throws IOException {
    var digest = sha256();
    in.transferTo(new DigestOutputStream(OutputStream.nullOutputStream(), digest));
    return HexFormat.of().formatHex(digest.digest());
  }

  static String hash(Path path) throws IOException {
    try (var in = Files.newInputStream(path)) { return hash(in); }
  }

  private String textDigest(List<Catalog.Segment> segments) throws IOException {
    var digest = sha256();
    json.writeValue(new DigestOutputStream(OutputStream.nullOutputStream(), digest), segments);
    return HexFormat.of().formatHex(digest.digest());
  }

  static String prefix(String id) { return "artifacts/" + id + "/"; }

  private static List<String> previews(String kind, List<Catalog.Segment> segments) {
    return switch (kind) {
      case "line" -> List.of("lines.html");
      case "image" -> List.of("original");
      default -> segments.stream().map(s -> s.pos() + ".png").toList();
    };
  }

  private boolean intact(String key, String expected) throws Exception {
    try (var in = objects.open(key)) {
      return hash(in).equals(expected);
    } catch (ErrorResponseException e) {
      if ("NoSuchKey".equals(e.errorResponse().code())) return false;
      throw e;
    }
  }

  boolean reuse(Catalog.Task task, Catalog.FileRow file, String profile) throws Exception {
    String signature = hash(profile.getBytes(StandardCharsets.UTF_8));
    var candidate = db.candidate(file.courseId(), file.digest(), Parser.extension(file.name()), signature);
    if (candidate == null) return false;
    var segments = db.segments(candidate.id());
    if (segments.isEmpty() || !textDigest(segments).equals(candidate.textDigest())) return false;
    Manifest manifest;
    try {
      manifest = json.readValue(candidate.manifest(), Manifest.class);
    } catch (JsonProcessingException e) { return false; }
    var names = previews(Parser.kind(file.name()), segments);
    if (manifest == null || !profile.equals(manifest.parser()) || manifest.previews() == null
        || !manifest.previews().keySet().equals(new HashSet<>(names))) return false;
    for (String name : names) {
      String key = name.equals("original") ? "original/" + file.digest() : prefix(candidate.id()) + name;
      if (!intact(key, manifest.previews().get(name))) return false;
    }
    tx.executeWithoutResult(status -> bind(task, candidate.id(), "reused"));
    return true;
  }

  void publish(Catalog.Task task, Catalog.FileRow file, String profile, Path dir,
               List<Catalog.Segment> segments) throws Exception {
    String id = UUID.randomUUID().toString();
    var manifest = new LinkedHashMap<String,String>();
    for (String name : previews(Parser.kind(file.name()), segments)) {
      if (name.equals("original")) {
        manifest.put(name, file.digest());
      } else {
        Path path = dir.resolve(name);
        String digest = hash(path);
        String key = prefix(id) + name;
        objects.put(key, path);
        if (!intact(key, digest)) throw new IOException("预览校验失败");
        manifest.put(name, digest);
      }
    }
    var artifact = new ArtifactMapper.Artifact(id, file.courseId(), file.digest(),
        Parser.extension(file.name()), hash(profile.getBytes(StandardCharsets.UTF_8)), textDigest(segments),
        json.writeValueAsString(new Manifest(profile, manifest)));
    tx.executeWithoutResult(status -> {
      db.create(artifact);
      for (var s : segments) db.addSegment(id, s);
      bind(task, id, "parsed");
    });
  }

  private void bind(Catalog.Task task, String id, String origin) {
    db.remember(task.job(), task.file(), id);
    db.bind(task.job(), task.file(), id, origin);
  }
}
