package local.review;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static local.review.AnalysisApi.*;

@RestController
@RequestMapping("/api/course/versions/{version}")
class StudyApi {
  private final AnalysisMapper analysis;
  private final StudyMapper states;
  private final ObjectMapper json;

  StudyApi(AnalysisMapper analysis, StudyMapper states, ObjectMapper json) {
    this.analysis = analysis;
    this.states = states;
    this.json = json;
  }

  private Result snapshot(UUID version) throws JsonProcessingException {
    String raw = analysis.result(version.toString());
    if (raw == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return json.readValue(raw, Result.class);
  }

  record Change(Long revision, Boolean completed, String note) {}

  @GetMapping("/states")
  List<StudyMapper.State> states(@PathVariable UUID version) throws JsonProcessingException {
    var visible = new HashSet<String>();
    var result = snapshot(version);
    for (var row : result.ranked()) if (result.paperCount()==0 || row.count()>0) visible.add(row.id());
    return states.all().stream().filter(s -> visible.contains(s.topic())).toList();
  }

  @PutMapping(value="/states/{topic}", headers="X-Review-Request=1")
  @Transactional
  ResponseEntity<StudyMapper.State> save(@PathVariable UUID version, @PathVariable UUID topic,
      @RequestBody Change change) throws JsonProcessingException {
    String id = topic.toString();
    if (change.revision()==null || change.revision()<0 || (change.completed()==null && change.note()==null))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var result = snapshot(version);
    if (result.ranked().stream().noneMatch(r -> r.id().equals(id) && (r.count()>0 || result.paperCount()==0)))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    if (change.revision()==0) {
      try { states.create(id,change.completed(),change.note()); }
      catch (DuplicateKeyException e) { return conflict(id); }
    } else if (states.update(id,change.revision(),change.completed(),change.note())==0) {
      return conflict(id);
    }
    return ResponseEntity.ok(states.get(id));
  }

  private ResponseEntity<StudyMapper.State> conflict(String id) {
    return ResponseEntity.status(HttpStatus.CONFLICT).body(states.current(id));
  }

  @GetMapping("/export")
  ResponseEntity<byte[]> export(@PathVariable UUID version) throws JsonProcessingException {
    var document = markdown(snapshot(version));
    if (document.isEmpty()) return ResponseEntity.noContent().build();
    var filename = ContentDisposition.attachment().filename("数据库原理-" + version + ".md", StandardCharsets.UTF_8).build();
    return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/markdown;charset=UTF-8"))
        .header(HttpHeaders.CONTENT_DISPOSITION, filename.toString()).body(document.getBytes(StandardCharsets.UTF_8));
  }

  private static String plain(String value) {
    return value.replaceAll("[\\p{Cntrl}\\p{Zl}\\p{Zp}]+", " ").replace("&","&amp;").replace("<","&lt;")
        .replace(">","&gt;").replaceAll("([\\\\\u0060*_{}\\[\\]()#!|~])", "\\\\$1");
  }

  static String markdown(Result result) {
    Map<String,List<Ranked>> chapters = new LinkedHashMap<>();
    result.ranked().stream().filter(r -> r.count()>0).sorted(Comparator.comparingInt(Ranked::outlineOrder))
        .forEach(r -> chapters.computeIfAbsent(r.topic().chapter(), k -> new ArrayList<>()).add(r));
    if (chapters.isEmpty()) return "";
    var out = new StringBuilder("# 数据库原理\n\n格式版本：1\n\n分析版本：").append(result.version())
        .append("\n\n有效试卷：").append(result.paperCount()).append(" 份\n");
    chapters.forEach((chapter,rows) -> {
      out.append("\n## ").append(plain(chapter)).append("\n");
      for (var row : rows) {
        out.append("\n### ").append(plain(row.topic().name())).append("\n\n知识点标识：").append(row.id())
            .append("\n\n").append(plain(row.topic().text())).append("\n\n命中 ").append(row.count())
            .append(" 题，覆盖 ").append(row.papers()).append("/").append(result.paperCount()).append(" 份卷。\n\n");
        for (var ref : row.topic().refs()) source(out,"教学出处",result.sources().get(ref));
        for (var q : row.questions())
          for (var ref : q.refs()) source(out,"真题依据 · 第 " + plain(q.label()) + " 题", result.sources().get(ref));
      }
    });
    return out.toString();
  }

  private static void source(StringBuilder out, String label, Ref ref) {
    out.append("- ").append(label).append("：").append(plain(ref.name())).append(" · ").append(plain(ref.label())).append("\n");
  }
}
