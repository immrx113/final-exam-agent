package local.review;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
interface AnalysisMapper {
  record Counts(String topic, int questions, int papers) {}

  @Insert(
      "INSERT INTO analysis_versions(version_id, job, result_json,course_id) VALUES(#{version}, #{job}, '',#{course})")
  void begin(String course, String version, String job);

  @Insert("INSERT INTO analysis_hits VALUES(#{version}, #{topic}, #{paper}, #{number})")
  void hit(String version, String topic, String paper, int number);

  @Select(
      "SELECT topic, COUNT(*) questions, COUNT(DISTINCT paper) papers FROM analysis_hits WHERE"
          + " version_id=#{version} GROUP BY topic")
  List<Counts> counts(String version);

  @Update("UPDATE analysis_versions SET result_json=#{json},video_status='queued' WHERE version_id=#{version}")
  void finish(String version, String json);

  @Select("SELECT version_id FROM analysis_versions WHERE course_id=#{course} ORDER BY seq DESC LIMIT 1")
  String latest(String course);

  @Select("SELECT EXISTS(SELECT 1 FROM analysis_versions WHERE version_id=#{version} AND course_id=#{course})")
  boolean ownsVersion(String course, String version);

  @Select("SELECT result_json FROM analysis_versions WHERE version_id=#{version}")
  String result(String version);
}
