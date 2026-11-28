package local.review;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
interface TaskMapper {
  record Task(String id, String job, String requestId, String state, int attempts,
              String version, String reason, Integer errorCode) {
    boolean terminal() { return state.equals("published") || state.equals("failed"); }
  }

  String SELECT = "SELECT id,job,request_id AS requestId,state,attempts,version,reason,error_code AS errorCode FROM analysis_tasks ";
  String OPEN = "state NOT IN ('failed','published')";
  String WAITING = "state IN ('pending','queued','retry')";
  @Select(SELECT + "WHERE course_id=#{course} AND request_id=#{key}")
  Task requested(String course, String key);
  @Select(SELECT + "WHERE course_id=#{course} AND " + OPEN + " ORDER BY seq DESC LIMIT 1")
  Task active(String course);
  @Select(SELECT + "WHERE course_id=#{course} AND job=#{job} ORDER BY seq DESC LIMIT 1")
  Task latest(String course, String job);
  @Select(SELECT + "WHERE course_id=#{course} AND id=#{id}")
  Task owned(String course, String id);
  @Select(SELECT + "WHERE id=#{id}")
  Task get(String id);
  @Insert("INSERT INTO analysis_tasks(id,course_id,job,request_id,input_json) VALUES(#{id},#{course},#{job},#{key},#{input})")
  void insert(String id, String course, String job, String key, String input);

  // The row is also the transactional outbox. Keep resending unclaimed work if a broker loses it.
  record Delivery(String id, String topic) {}
  @Select("SELECT id,COALESCE(input_json->>'$.workerTopic','ReviewAnalysis') AS topic FROM analysis_tasks WHERE " + WAITING + " AND due_at<=NOW(3) ORDER BY due_at,seq LIMIT 16")
  List<Delivery> due();
  @Update("UPDATE analysis_tasks SET state='queued',due_at=TIMESTAMPADD(SECOND,30,NOW(3)) WHERE id=#{id} AND " + WAITING + " AND due_at<=NOW(3)")
  int sent(String id);
  @Update("UPDATE analysis_tasks SET reason=#{reason},due_at=TIMESTAMPADD(SECOND,3,NOW(3)) WHERE id=#{id} AND " + WAITING)
  int waiting(String id, String reason);
  @Update("UPDATE analysis_tasks SET state='running',attempts=attempts+1,token=#{token},reason=NULL,due_at=TIMESTAMPADD(SECOND,#{seconds},NOW(3)) WHERE id=#{id} AND " + WAITING + " AND (state<>'retry' OR due_at<=NOW(3))")
  int claim(String id, String token, long seconds);
  @Select("SELECT input_json FROM analysis_tasks WHERE id=#{id} AND token=#{token}")
  String input(String id, String token);
  @Update("UPDATE analysis_tasks SET state='published',version=#{version},token=NULL,input_json=NULL,reason=NULL,error_code=NULL WHERE id=#{id} AND state='running' AND token=#{token} AND due_at>NOW(3)")
  int finish(String id, String token, String version);
  @Update("UPDATE analysis_tasks SET state=#{state},token=NULL,input_json=IF(#{state}='failed',NULL,input_json),reason=#{reason},error_code=#{code},due_at=TIMESTAMPADD(SECOND,2,NOW(3)) WHERE id=#{id} AND token=#{token} AND state='running' AND due_at>NOW(3)")
  int fail(String id, String token, String state, String reason, int code);
  @Update("UPDATE analysis_tasks SET state='retry',token=NULL,attempts=attempts-1,reason='等待执行锁恢复',due_at=NOW(3) WHERE id=#{id} AND token=#{token} AND state='running' AND due_at>NOW(3)")
  int lostLock(String id, String token);
  @Update("UPDATE analysis_tasks SET state=IF(attempts>=3,'failed','retry'),input_json=IF(attempts>=3,NULL,input_json),reason='执行超时或服务重启',error_code=504,token=NULL,due_at=NOW(3) WHERE state='running' AND due_at<=NOW(3)")
  int expire();
}
