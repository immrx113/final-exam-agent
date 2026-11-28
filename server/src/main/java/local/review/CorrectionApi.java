package local.review;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import java.time.Instant;
import java.util.*;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import static local.review.AnalysisApi.*;

@RestController
@RequestMapping({"/api/course", "/api/courses/{course}"})
class CorrectionApi {
  private final CourseMapper courses;
  private final TaskMapper tasks;
  private final AnalysisApi analysis;
  private final AnalysisMapper db;

  CorrectionApi(CourseMapper courses, TaskMapper tasks, AnalysisApi analysis, AnalysisMapper db) {
    this.courses = courses;
    this.tasks = tasks;
    this.analysis = analysis;
    this.db = db;
  }

  record Edit(Integer question, Integer requirement, List<String> refs, List<String> matches) {}
  record Request(UUID requestId, List<Edit> edits) {}
  record Difference(int question, int requirement, List<String> before, List<String> after, boolean wasPending) {}
  record Audit(String parent, String time, List<Difference> changes) {}
  record Conflict(String reason, String latest) {}

  @GetMapping("/versions")
  List<AnalysisMapper.Edition> history(@PathVariable(required=false) String course) {
    return db.history(courses.require(course).id());
  }

  @GetMapping(value="/versions/{version}", produces=MediaType.APPLICATION_JSON_VALUE)
  String version(@PathVariable(required=false) String course, @PathVariable UUID version) {
    if (!db.ownsVersion(courses.require(course).id(), version.toString()))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return db.result(version.toString());
  }

  private static void valid(boolean condition) {
    if (!condition) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
  }

  @PostMapping(value="/versions/{version}/corrections", headers="X-Review-Request=1")
  @Transactional(rollbackFor=Exception.class)
  ResponseEntity<?> correct(@PathVariable(required=false) String course, @PathVariable UUID version,
                            @RequestBody Request request) throws JsonProcessingException {
    String parent = version.toString();
    var owner = courses.findForUpdate(course == null ? "default" : course);
    if (owner == null || !db.ownsVersion(owner.id(), parent)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    valid(request.requestId() != null && request.edits() != null && !request.edits().isEmpty());
    String requestId = request.requestId().toString();
    String digest = ArtifactStore.hash(analysis.json.writeValueAsBytes(request.edits()));
    var receipt = db.receipt(owner.id(), requestId);
    String latest = db.latest(owner.id());
    if (receipt != null) {
      if (parent.equals(receipt.parent()) && digest.equals(receipt.digest()))
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(db.result(receipt.version()));
      return ResponseEntity.status(409).body(new Conflict("同一提交标识已用于其他修改", latest));
    }
    if (!parent.equals(latest) || tasks.active(owner.id()) != null) {
      String reason = parent.equals(latest) ? "课程正在分析，完成后可重试" : "已有新版本，请核对后重新提交";
      return ResponseEntity.status(409).body(new Conflict(reason, latest));
    }
    var base = analysis.json.readValue(db.result(parent), Result.class);
    if (base.questions() == null)
      return ResponseEntity.status(409).body(new Conflict("请重新分析以生成可修正的题目明细", latest));
    var topics = base.ranked().stream().sorted(Comparator.comparingInt(Ranked::outlineOrder)).map(Ranked::topic).toList();
    var names = new HashSet<>(topics.stream().map(Topic::name).toList());
    var questions = new ArrayList<>(base.questions());
    var changes = applyEdits(questions, names, request.edits());
    var reviews = new ArrayList<>(base.reviews().stream().filter(r -> r.question() == null).toList());
    for (int qi = 0; qi < questions.size(); qi++) {
      var requirements = questions.get(qi).requirements();
      for (int ri = 0; ri < requirements.size(); ri++) {
        var r = requirements.get(ri);
        if (r.pending()) reviews.add(new Review(r.reason(), r.refs(), qi, ri));
      }
    }
    var passages = analysis.json.readValue(db.passages(parent), new TypeReference<List<StudyPlan.Passage>>() {});
    String child = UUID.randomUUID().toString();
    var output = new Output(child, topics, questions, reviews, 1);
    var prepared = new Prepared(base.sources(), output, passages);
    var result = analysis.publish(owner, base.job(), child, null, prepared, new Audit(parent, Instant.now().toString(), changes));
    db.revision(child, parent, requestId, digest);
    return ResponseEntity.ok(result);
  }

  static List<Difference> applyEdits(List<Question> questions, Set<String> topics, List<Edit> edits) {
    var changes = new ArrayList<Difference>();
    var seen = new HashSet<List<Integer>>();
    for (var e : edits) {
      valid(e != null && e.question() != null && e.question() >= 0 && e.question() < questions.size());
      var q = questions.get(e.question());
      valid(e.requirement() != null && e.requirement() >= 0 && e.requirement() < q.requirements().size());
      valid(seen.add(List.of(e.question(), e.requirement())));
      var requirements = new ArrayList<>(q.requirements());
      var old = requirements.get(e.requirement());
      valid(old.refs().equals(e.refs()) && e.matches() != null && topics.containsAll(e.matches()));
      var chosen = new LinkedHashSet<>(e.matches());
      valid(chosen.size() == e.matches().size() && (old.pending() || !chosen.equals(new HashSet<>(old.matches()))));
      requirements.set(e.requirement(), new Requirement(old.text(), old.refs(), e.matches(), List.of(), false, "人工核对"));
      var matches = requirements.stream().flatMap(r -> r.matches().stream()).distinct().toList();
      questions.set(e.question(), new Question(q.file(), q.label(), q.refs(), matches, requirements));
      changes.add(new Difference(e.question(), e.requirement(), old.matches(), e.matches(), old.pending()));
    }
    return changes;
  }
}
