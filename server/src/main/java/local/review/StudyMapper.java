package local.review;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
interface StudyMapper {
  record State(String topic, long revision, boolean completed, String note) {}

  @Select("SELECT topic, revision, completed, note FROM study_states")
  List<State> all();

  @Select("SELECT topic, revision, completed, note FROM study_states WHERE topic=#{id}")
  State get(String id);

  @Select("SELECT topic, revision, completed, note FROM study_states WHERE topic=#{id} FOR UPDATE")
  State current(String id);

  @Insert("INSERT INTO study_states(topic,revision,completed,note) VALUES(#{topic},1,COALESCE(#{completed},false),COALESCE(#{note},''))")
  void create(String topic, Boolean completed, String note);

  @Update("UPDATE study_states SET revision=revision+1, completed=COALESCE(#{completed},completed), note=COALESCE(#{note},note) WHERE topic=#{topic} AND revision=#{revision}")
  int update(String topic, long revision, Boolean completed, String note);
}
