package local.review;

import com.fasterxml.jackson.core.JsonProcessingException;
import java.time.Duration;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping({"/api/course","/api/courses/{course}"})
class AnalysisTasks {
  private final CourseMapper courses;
  private final AnalysisApi analysis;
  private final TaskMapper tasks;

  AnalysisTasks(CourseMapper courses, AnalysisApi analysis, TaskMapper tasks) {
    this.courses = courses;
    this.analysis = analysis;
    this.tasks = tasks;
  }

  record Request(UUID requestId) {}
  record Admission(TaskMapper.Task task, boolean conflict) {}

  private Admission admit(String course, UUID job, UUID key) {
    return analysis.tx.execute(status -> {
      var owner = courses.findForUpdate(course == null ? "default" : course);
      if (owner == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      analysis.imports.ownedJob(owner.id(), job);
      var existing = tasks.requested(owner.id(), key.toString());
      if (existing != null) return new Admission(existing, !existing.job().equals(job.toString()));
      var busy = tasks.active(owner.id());
      if (busy != null) return new Admission(busy, true);
      var frozen = analysis.freeze(owner, job);
      String id = UUID.randomUUID().toString();
      try {
        tasks.insert(id, owner.id(), job.toString(), key.toString(), analysis.json.writeValueAsString(frozen));
      } catch (JsonProcessingException e) {
        throw new IllegalStateException("无法登记分析输入", e);
      }
      return new Admission(tasks.get(id), false);
    });
  }

  @PostMapping(value="/jobs/{job}/analysis-tasks", headers="X-Review-Request=1")
  ResponseEntity<TaskMapper.Task> submit(@PathVariable(required=false) String course,
      @PathVariable UUID job, @RequestBody Request body) {
    if (body == null || body.requestId() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var accepted = admit(course, job, body.requestId());
    return ResponseEntity.status(accepted.conflict() ? HttpStatus.CONFLICT : HttpStatus.ACCEPTED).body(accepted.task());
  }

  @GetMapping("/jobs/{job}/analysis-tasks")
  ResponseEntity<TaskMapper.Task> find(@PathVariable(required=false) String course, @PathVariable UUID job) {
    var owner = analysis.imports.ownedJob(course, job);
    var active = tasks.active(owner.id());
    var task = active != null ? active : tasks.latest(owner.id(), job.toString());
    return task == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(task);
  }

  @GetMapping("/analysis-tasks/{id}")
  TaskMapper.Task status(@PathVariable(required=false) String course, @PathVariable UUID id) {
    var task = tasks.owned(courses.require(course).id(), id.toString());
    if (task == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return task;
  }

  @PostMapping(value="/jobs/{job}/analysis", headers="X-Review-Request=1", produces=MediaType.APPLICATION_JSON_VALUE)
  String synchronous(@PathVariable(required=false) String course, @PathVariable UUID job,
      @RequestHeader(value="Idempotency-Key", required=false) UUID key) throws InterruptedException {
    var admission = admit(course, job, key == null ? UUID.randomUUID() : key);
    if (admission.conflict()) throw new ResponseStatusException(HttpStatus.CONFLICT);
    var task = admission.task();
    long deadline = System.nanoTime() + Duration.ofSeconds(3 * analysis.timeout + 90).toNanos();
    while (!task.terminal()) {
      if (System.nanoTime() >= deadline) throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT);
      Thread.sleep(250);
      task = status(course, UUID.fromString(task.id()));
    }
    if (task.state().equals("failed"))
      throw new ResponseStatusException(HttpStatus.valueOf(task.errorCode()), task.reason());
    return analysis.db.result(task.version());
  }
}
