package local.review;

import jakarta.annotation.PostConstruct;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class Worker {
  private final Catalog db;
  private final Parser parser;
  private final Store objects;
  private final TransactionTemplate tx;

  Worker(Catalog db, Parser parser, Store objects, TransactionTemplate tx) {
    this.db = db;
    this.parser = parser;
    this.objects = objects;
    this.tx = tx;
  }

  @PostConstruct
  void recover() {
    db.recover();
  }

  @Scheduled(fixedDelay = 300)
  void runOne() {
    var task = db.next();
    if (task == null || db.claim(task) != 1) return;
    Path dir = null;
    String reason = "存储服务暂不可用，请恢复后重试";
    try {
      var file = db.file(task.file());
      dir = Files.createTempDirectory("review-import-");
      if (task.status().equals("recheck")) {
        refreshText(task, dir);
        return;
      }
      Path input = dir.resolve("source." + Parser.extension(file.name()));
      try (var source = objects.open("original/" + file.digest())) {
        Files.copy(source, input);
      }
      reason = "无法解析文件，请检查文件能否打开及转换工具是否可用";
      var segments = parser.parse(input, dir);
      if (segments.isEmpty()) throw new IOException("无可定位内容");
      reason = "结果保存失败，请恢复存储服务后重试";
      String prefix = "preview/" + task.job() + "/" + task.file() + "/";
      if ("line".equals(Parser.kind(file.name())))
        objects.put(prefix + "lines.html", dir.resolve("lines.html"));
      else if (!"image".equals(Parser.kind(file.name())))
        for (var s : segments)
          objects.put(prefix + s.pos() + ".png", dir.resolve(s.pos() + ".png"));
      tx.executeWithoutResult(
          status -> {
            for (var s : segments) db.insertSegment(task.job(), task.file(), s);
            db.ready(task.job(), task.file(), prefix);
          });
    } catch (Exception e) {
      if (task.status().equals("recheck"))
        db.finishRecheck(task.job(), task.file(), "重新识别失败，已保留上次结果，可重试");
      else db.fail(task.job(), task.file(), reason);
    } finally {
      if (dir != null) {
        try (var paths = Files.walk(dir)) {
          for (Path path : paths.sorted(Comparator.reverseOrder()).toList())
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
          /* Temporary files are never served. */
        }
      }
    }
  }

  private void refreshText(Catalog.Task task, Path dir) throws Exception {
    var previous = db.segments(task.job(), task.file());
    java.util.List<Catalog.Segment> refreshed;
    if (parser.layoutAvailable()) {
      var file = db.file(task.file());
      Path input = dir.resolve("source." + Parser.extension(file.name()));
      try (var in = objects.open("original/" + file.digest())) {
        Files.copy(in, input);
      }
      refreshed = parser.rereadLayout(input, dir, previous);
    } else {
      refreshed = refreshPreviewText(task, dir, previous);
    }
    tx.executeWithoutResult(
        status -> {
          for (var s : refreshed) db.refreshSegment(task.job(), task.file(), s);
          db.finishRecheck(task.job(), task.file(), null);
        });
  }

  private java.util.List<Catalog.Segment> refreshPreviewText(
      Catalog.Task task, Path dir, java.util.List<Catalog.Segment> previous) throws Exception {
    String prefix = db.preview(task.job(), task.file());
    var suspect = previous.stream().filter(s -> PageText.suspect(s.body())).toList();
    for (var s : suspect) {
      try (var in = objects.open(prefix + s.pos() + ".png")) {
        Files.copy(in, dir.resolve(s.pos() + ".png"));
      }
    }
    return parser.improve(suspect, dir);
  }
}
