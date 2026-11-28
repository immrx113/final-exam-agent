package local.review;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
interface AnalysisMapper {
  record Counts(String topic, int questions, int papers) {}

  @Insert(
      "INSERT INTO analysis_versions(version_id, job, result_json,course_id,task_id) VALUES(#{version}, #{job}, '',#{course},#{task})")
  void begin(String course, String version, String job, String task);

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

  record Edition(String version, String parent) {}
  @Select("SELECT version_id AS version,parent_version AS parent FROM analysis_versions WHERE course_id=#{course} ORDER BY seq DESC")
  List<Edition> history(String course);

  record Receipt(String version, String parent, String digest) {}
  @Select("SELECT version_id AS version,parent_version AS parent,correction_digest AS digest FROM analysis_versions WHERE course_id=#{course} AND correction_request=#{request}")
  Receipt receipt(String course, String request);

  @Update("UPDATE analysis_versions SET parent_version=#{parent},correction_request=#{request},correction_digest=#{digest} WHERE version_id=#{version}")
  void revision(String version, String parent, String request, String digest);

  @Update("UPDATE analysis_versions SET plan_passages=#{json} WHERE version_id=#{version}")
  void storePassages(String version, String json);

  @Select("SELECT plan_passages FROM analysis_versions WHERE version_id=#{version}")
  String passages(String version);

  @Select("SELECT EXISTS(SELECT 1 FROM analysis_versions WHERE version_id=#{version} AND course_id=#{course})")
  boolean ownsVersion(String course, String version);

  @Select("SELECT result_json FROM analysis_versions WHERE version_id=#{version}")
  String result(String version);
}
