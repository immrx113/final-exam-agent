package local.review;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
interface StudyMapper {
  record State(String topic, long revision, boolean completed, String note) {}

  @Select("SELECT topic, revision, completed, note FROM study_states WHERE course_id=#{course}")
  List<State> all(String course);

  @Select("SELECT topic, revision, completed, note FROM study_states WHERE course_id=#{course} AND topic=#{id}")
  State get(String course, String id);

  @Select("SELECT topic, revision, completed, note FROM study_states WHERE course_id=#{course} AND topic=#{id} FOR UPDATE")
  State current(String course, String id);

  @Insert("INSERT INTO study_states(course_id,topic,revision,completed,note) VALUES(#{course},#{topic},1,COALESCE(#{completed},false),COALESCE(#{note},''))")
  void create(String course, String topic, Boolean completed, String note);

  @Update("UPDATE study_states SET revision=revision+1, completed=COALESCE(#{completed},completed), note=COALESCE(#{note},note) WHERE course_id=#{course} AND topic=#{topic} AND revision=#{revision}")
  int update(String course, String topic, long revision, Boolean completed, String note);
}
