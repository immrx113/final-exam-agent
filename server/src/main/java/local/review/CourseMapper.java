package local.review;

import java.util.List;
import org.apache.ibatis.annotations.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Mapper
interface CourseMapper {
  record Course(String id, String name, String topicNs, String profile) {
    String base() { return id.equals("default") ? "/api/course" : "/api/courses/" + id; }
  }
  record Summary(String id, String name, boolean hasPublished) {}

  @Select("SELECT id,name,topic_ns AS topicNs,profile FROM courses WHERE id=#{id}")
  Course find(String id);

  default Course require(String id) {
    Course row = find(id == null ? "default" : id);
    if (row == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return row;
  }

  @Select("SELECT c.id,c.name,EXISTS(SELECT 1 FROM analysis_versions v WHERE v.course_id=c.id) AS hasPublished FROM courses c ORDER BY c.seq")
  List<Summary> list();

  @Insert("INSERT INTO courses(id,name,topic_ns,profile) VALUES(#{id},#{name},#{id},'general')")
  void create(String id, String name);
}
