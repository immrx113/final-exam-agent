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

  @Select("SELECT id,name,topic_ns AS topicNs,profile FROM courses WHERE id=#{id} FOR UPDATE")
  Course findForUpdate(String id);

  default Course require(String id) {
    Course row = find(id == null ? "default" : id);
    if (row == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return row;
  }

  @Select("SELECT c.id,c.name,EXISTS(SELECT 1 FROM analysis_versions v WHERE v.course_id=c.id) AS hasPublished FROM courses c ORDER BY c.seq")
  List<Summary> list();

  @Select("SELECT c.id,c.name,EXISTS(SELECT 1 FROM analysis_versions v WHERE v.course_id=c.id) AS hasPublished FROM courses c WHERE c.id=#{id}")
  Summary summary(String id);

  @Insert("INSERT INTO courses(id,name,topic_ns,profile) VALUES(#{id},#{name},#{id},'general')")
  void create(String id, String name);

  @Update("UPDATE courses SET name=#{name} WHERE id=#{id}")
  int rename(String id, String name);

  @Select("SELECT EXISTS(SELECT 1 FROM items i JOIN jobs j ON j.id=i.job WHERE j.course_id=#{course} AND i.status NOT IN ('ready','failed'))")
  boolean hasActiveItems(String course);

  @Select("SELECT version_id FROM analysis_versions WHERE course_id=#{course}")
  List<String> versions(String course);

  @Delete("DELETE FROM study_states WHERE course_id=#{course}")
  void deleteStudyStates(String course);

  @Delete("DELETE h FROM analysis_hits h JOIN analysis_versions v ON v.version_id=h.version_id WHERE v.course_id=#{course}")
  void deleteAnalysisHits(String course);

  @Delete("DELETE FROM analysis_versions WHERE course_id=#{course}")
  void deleteAnalysisVersions(String course);

  @Delete("DELETE s FROM segments s JOIN jobs j ON j.id=s.job WHERE j.course_id=#{course}")
  void deleteSegments(String course);

  @Delete("DELETE i FROM items i JOIN jobs j ON j.id=i.job WHERE j.course_id=#{course}")
  void deleteItems(String course);

  @Delete("DELETE FROM jobs WHERE course_id=#{course}")
  void deleteJobs(String course);

  @Delete("DELETE FROM files WHERE course_id=#{course}")
  void deleteFiles(String course);

  @Delete("DELETE FROM courses WHERE id=#{id}")
  int deleteCourse(String id);
}
