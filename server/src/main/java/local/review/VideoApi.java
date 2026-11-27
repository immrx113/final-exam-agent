package local.review;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping({"/api/course", "/api/courses/{course}"})
class VideoApi {
  private final CourseMapper courses;
  private final VideoMapper jobs;
  private final AnalysisMapper analysis;
  private final VideoSource source;
  private final ObjectMapper json;

  VideoApi(CourseMapper courses, VideoMapper jobs, AnalysisMapper analysis, VideoSource source, ObjectMapper json) {
    this.courses = courses;
    this.jobs = jobs;
    this.analysis = analysis;
    this.source = source;
    this.json = json;
  }

  record State(String status, String reason, List<VideoRules.Item> items) {}

  private void requireVersion(String course, UUID version) {
    if (!analysis.ownsVersion(courses.require(course).id(), version.toString()))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  }

  @GetMapping("/versions/{version}/videos")
  State read(@PathVariable(name="course", required=false) String course, @PathVariable UUID version) throws Exception {
    requireVersion(course, version);
    String id = version.toString();
    var row = jobs.state(id);
    if (row == null || row.status() == null) {
      jobs.activate(id);
      row = jobs.state(id);
      if (row == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
    var report =
        row.payload() == null
            ? new VideoRules.Report("", List.of())
            : json.readValue(row.payload(), VideoRules.Report.class);
    return new State(row.status(), report.reason(), report.items());
  }

  @PostMapping(value = "/versions/{version}/videos/retry", headers = "X-Review-Request=1")
  State retry(@PathVariable(name="course", required=false) String course, @PathVariable UUID version) throws Exception {
    requireVersion(course, version);
    jobs.retry(version.toString());
    return read(course, version);
  }

  @Scheduled(fixedDelay = 1000)
  void process() throws Exception {
    var pending = jobs.next();
    if (pending == null) return;
    String version = pending.versionId();
    String token = UUID.randomUUID().toString();
    if (jobs.claim(version, token) == 0) return;
    State state;
    try {
      var result = json.readValue(analysis.result(version), AnalysisApi.Result.class);
      state = source.lookup(pending.courseName(), VideoRules.priority(result));
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return;
    } catch (Exception e) {
      state = new State("failed", "视频检索暂时不可用，请重试。", List.of());
    }
    jobs.finish(
        version,
        token,
        state.status(),
        json.writeValueAsString(new VideoRules.Report(state.reason(), state.items())));
  }
}
