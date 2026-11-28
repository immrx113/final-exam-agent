package local.review;

import jakarta.annotation.PostConstruct;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Service
class Worker {
  private final Catalog db;
  private final Parser parser;
  private final Store objects;
  private static final Logger LOG = LoggerFactory.getLogger(Worker.class);
  private final ArtifactStore artifacts;

  Worker(Catalog db, Parser parser, Store objects, ArtifactStore artifacts) {
    this.db = db;
    this.parser = parser;
    this.objects = objects;
    this.artifacts = artifacts;
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
    Parser.Run run = null;
    boolean force = task.status().equals("recheck");
    try {
      var file = db.file(task.file());
      run = parser.plan(file.name(), force);
      String profile = parser.profile(file.name(), run);
      if (!force && artifacts.reuse(task, file, profile)) return;
      dir = Files.createTempDirectory("review-import-");
      Path input = dir.resolve("source." + Parser.extension(file.name()));
      try (var source = objects.open("original/" + file.digest())) {
        Files.copy(source, input);
      }
      if (!ArtifactStore.hash(input).equals(file.digest())) throw new IOException("原件校验失败");
      reason = "无法解析文件，请检查文件能否打开及转换工具是否可用";
      var segments = parser.parse(input, dir, run);
      if (segments.isEmpty()) throw new IOException("无可定位内容");
      reason = "结果保存失败，请恢复存储服务后重试";
      artifacts.publish(task, file, profile, dir, segments);
    } catch (Exception e) {
      if (task.status().equals("recheck"))
        db.finishRecheck(task.job(), task.file(), "重新识别失败，已保留上次结果，可重试");
      else db.fail(task.job(), task.file(), reason);
    } finally {
      if (run != null) LOG.info("parse job={} file={} parses={} conversions={} rendered={} ocrPages={} layoutPages={}",
          task.job(), task.file(), run.parses, run.conversions, run.rendered, run.ocrPages, run.layoutPages);
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
}
