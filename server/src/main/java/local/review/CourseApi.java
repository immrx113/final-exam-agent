package local.review;

import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/courses")
class CourseApi {
  private final CourseMapper courses;
  private final TaskMapper tasks;
  private final TransactionTemplate tx;
  private final StringRedisTemplate cache;

  CourseApi(
      CourseMapper courses,
      TaskMapper tasks,
      TransactionTemplate tx,
      StringRedisTemplate cache) {
    this.courses = courses;
    this.tasks = tasks;
    this.tx = tx;
    this.cache = cache;
  }

  @GetMapping
  List<CourseMapper.Summary> list() { return courses.list(); }

  record NewCourse(String name) {}

  private static String validateName(NewCourse input) {
    String raw = Objects.toString(input == null ? null : input.name(), "");
    String name = raw.strip();
    if (name.isEmpty() || name.codePointCount(0, name.length()) > 80 ||
        raw.codePoints().anyMatch(Character::isISOControl) || name.contains("/") || name.contains("\\"))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    return name;
  }

  @PostMapping(headers = "X-Review-Request=1")
  @ResponseStatus(HttpStatus.CREATED)
  CourseMapper.Summary create(@RequestBody(required = false) NewCourse input) {
    String name = validateName(input);
    String id = UUID.randomUUID().toString();
    try { courses.create(id, name); }
    catch (DuplicateKeyException e) { throw new ResponseStatusException(HttpStatus.CONFLICT); }
    return new CourseMapper.Summary(id, name, false);
  }

  @RequestMapping(
      value = "/{id}",
      method = {RequestMethod.PATCH, RequestMethod.PUT},
      headers = "X-Review-Request=1")
  CourseMapper.Summary rename(
      @PathVariable String id, @RequestBody(required = false) NewCourse input) {
    if ("default".equals(id)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var existing = courses.find(id);
    if (existing == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    String name = validateName(input);
    if (!existing.name().equals(name)) {
      try {
        if (courses.rename(id, name) == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      } catch (DuplicateKeyException e) {
        throw new ResponseStatusException(HttpStatus.CONFLICT);
      }
    }
    var updated = courses.summary(id);
    if (updated == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return updated;
  }

  @DeleteMapping(value = "/{id}", headers = "X-Review-Request=1")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void delete(@PathVariable String id) {
    if ("default".equals(id)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    List<String> versions =
        tx.execute(
            status -> {
              var row = courses.findForUpdate(id);
              if (row == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
              if (courses.hasActiveItems(id) || tasks.active(id) != null)
                throw new ResponseStatusException(HttpStatus.CONFLICT);
              var list = courses.versions(id);
              courses.deleteStudyStates(id);
              courses.deleteAnalysisHits(id);
              courses.deleteAnalysisVersions(id);
              courses.deleteSegments(id);
              courses.deleteItems(id);
              courses.deleteJobs(id);
              courses.deleteFiles(id);
              courses.deleteCourse(id);
              return list;
            });
    if (versions != null && !versions.isEmpty()) {
      try {
        cache.delete(versions.stream().map(v -> "review:m2:" + v).toList());
      } catch (DataAccessException ignored) {
        /* Best-effort cache eviction after DB commit. */
      }
    }
  }
}
