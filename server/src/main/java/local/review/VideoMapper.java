package local.review;

import org.apache.ibatis.annotations.*;

@Mapper
interface VideoMapper {
  record Row(String status, String payload) {}

  @Select(
      "SELECT video_status status, video_result payload FROM analysis_versions WHERE"
          + " version_id=#{version}")
  Row state(String version);

  @Update(
      "UPDATE analysis_versions SET video_status='queued' WHERE version_id=#{version} AND"
          + " video_status IS NULL")
  int activate(String version);

  @Update(
      "UPDATE analysis_versions SET video_status='queued',video_result=NULL WHERE"
          + " version_id=#{version} AND video_status IN ('failed','partial')")
  int retry(String version);

  String AVAILABLE =
      "(video_status='queued' OR (video_status='running' AND video_started < UTC_TIMESTAMP() -"
          + " INTERVAL 5 MINUTE))";

  @Select(
      "SELECT version_id FROM analysis_versions WHERE " + AVAILABLE + " ORDER BY seq DESC LIMIT 1")
  String next();

  @Update(
      "UPDATE analysis_versions SET video_status='running', video_started=UTC_TIMESTAMP(),"
          + " video_token=#{token} WHERE version_id=#{version} AND "
          + AVAILABLE)
  int claim(String version, String token);

  @Update(
      "UPDATE analysis_versions SET video_status=#{status},video_result=#{payload},video_token=NULL"
          + " WHERE version_id=#{version} AND video_token=#{token}")
  void finish(String version, String token, String status, String payload);
}
