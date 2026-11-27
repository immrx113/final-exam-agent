package local.review;

import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/courses")
class CourseApi {
  private final CourseMapper courses;

  CourseApi(CourseMapper courses) { this.courses = courses; }

  @GetMapping
  List<CourseMapper.Summary> list() { return courses.list(); }

  record NewCourse(String name) {}

  @PostMapping(headers = "X-Review-Request=1")
  @ResponseStatus(HttpStatus.CREATED)
  CourseMapper.Summary create(@RequestBody NewCourse input) {
    String raw = Objects.toString(input.name(), "");
    String name = raw.strip();
    if (name.isEmpty() || name.codePointCount(0,name.length()) > 80 ||
        raw.codePoints().anyMatch(Character::isISOControl) || name.contains("/") || name.contains("\\"))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    String id = UUID.randomUUID().toString();
    try { courses.create(id, name); }
    catch (DuplicateKeyException e) { throw new ResponseStatusException(HttpStatus.CONFLICT); }
    return new CourseMapper.Summary(id, name, false);
  }
}
