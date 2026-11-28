package local.review;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
interface ArtifactMapper {
  record Artifact(String id, String course, String digest, String format, String profile,
                  String textDigest, String manifest) {}

  @Select("SELECT id,course_id AS course,digest,format,profile,text_digest AS textDigest,manifest " +
      "FROM parse_artifacts WHERE course_id=#{course} AND digest=#{digest} AND format=#{format} " +
      "AND profile=#{profile} ORDER BY seq DESC LIMIT 1")
  Artifact candidate(String course, String digest, String format, String profile);

  @Insert("INSERT INTO parse_artifacts(id,course_id,digest,format,profile,text_digest,manifest) " +
      "VALUES(#{id},#{course},#{digest},#{format},#{profile},#{textDigest},#{manifest})")
  void create(Artifact row);

  @Insert("INSERT INTO artifact_segments(artifact,pos,body,review) VALUES(#{id},#{s.pos},#{s.body},#{s.review})")
  void addSegment(String id, Catalog.Segment s);

  @Select("SELECT pos,body,review FROM artifact_segments WHERE artifact=#{id} ORDER BY pos")
  List<Catalog.Segment> segments(String id);

  @Insert("INSERT INTO item_artifacts(job,file,artifact) VALUES(#{job},#{file},#{id})")
  void remember(String job, String file, String id);

  @Update("UPDATE items SET artifact=#{id},parse_origin=#{origin},status='ready',reason=NULL WHERE job=#{job} AND file=#{file}")
  void bind(String job, String file, String id, String origin);

  @Select("SELECT artifact FROM items WHERE job=#{job} AND file=#{file} AND status IN ('ready','recheck','rechecking')")
  String current(String job, String file);

  @Select("SELECT EXISTS(SELECT 1 FROM item_artifacts WHERE job=#{job} AND file=#{file} AND artifact=#{id})")
  boolean wasBound(String job, String file, String id);
}
