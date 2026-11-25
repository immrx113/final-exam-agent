package local.review;

import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
interface Catalog {
  record FileRow(String id, String name, String role, String digest) {}

  record Item(String file, String name, String role, String status, String reason) {}

  record Segment(int pos, String body, boolean review) {}

  record Task(String job, String file, String status) {}

  @Insert(
      "INSERT INTO files(id,name,role,digest) VALUES(#{id},#{name},#{role},#{digest}) ON DUPLICATE"
          + " KEY UPDATE id=files.id")
  void addFile(FileRow file);

  @Select("SELECT * FROM files WHERE id=#{id}")
  FileRow file(String id);

  @Select("SELECT id,name,role,digest FROM files ORDER BY name,id")
  List<FileRow> files();

  @Insert("INSERT INTO jobs(id) VALUES(#{id}) ON DUPLICATE KEY UPDATE id=jobs.id")
  void job(String id);

  @Select("SELECT id FROM jobs ORDER BY seq DESC")
  List<String> jobs();

  @Insert("INSERT INTO items(job,file) VALUES(#{job},#{file})")
  void queue(String job, String file);

  @Select(
      "SELECT i.file,f.name,f.role,i.status,i.reason FROM items i JOIN files f ON f.id=i.file WHERE"
          + " job=#{job} ORDER BY f.name,i.file")
  List<Item> items(String job);

  @Select(
      "SELECT i.job,i.file,i.status FROM items i JOIN jobs j ON j.id=i.job WHERE i.status IN"
          + " ('queued','recheck') ORDER BY j.seq,i.file LIMIT 1")
  Task next();

  @Update(
      "UPDATE items SET status=IF(status='recheck','rechecking','processing') WHERE job=#{job} AND"
          + " file=#{file} AND status=#{status}")
  int claim(Task task);

  @Update(
      "UPDATE items SET status=IF(status='rechecking','recheck','queued') WHERE status IN"
          + " ('processing','rechecking')")
  void recover();

  @Update(
      "UPDATE items SET status='queued',reason=NULL WHERE job=#{job} AND file=#{file} AND"
          + " status='failed'")
  int retry(String job, String file);

  @Update(
      "UPDATE items SET status='recheck',reason=NULL WHERE job=#{job} AND file=#{file} AND"
          + " status='ready'")
  int recheck(String job, String file);

  @Update(
      "UPDATE items SET status='ready',reason=#{reason} WHERE job=#{job} AND file=#{file} AND"
          + " status='rechecking'")
  void finishRecheck(String job, String file, String reason);

  @Update(
      "UPDATE segments SET body=#{s.body},review=#{s.review} WHERE job=#{job} AND file=#{file} AND"
          + " pos=#{s.pos}")
  void refreshSegment(String job, String file, Segment s);

  @Insert(
      "INSERT INTO segments(job,file,pos,body,review)"
          + " VALUES(#{job},#{file},#{s.pos},#{s.body},#{s.review})")
  void insertSegment(String job, String file, Segment s);

  @Select("SELECT pos,body,review FROM segments WHERE job=#{job} AND file=#{file} ORDER BY pos")
  List<Segment> segments(String job, String file);

  @Update("UPDATE items SET status='ready',preview=#{prefix} WHERE job=#{job} AND file=#{file}")
  void ready(String job, String file, String prefix);

  @Update("UPDATE items SET status='failed',reason=#{reason} WHERE job=#{job} AND file=#{file}")
  void fail(String job, String file, String reason);

  @Select(
      "SELECT preview FROM items WHERE job=#{job} AND file=#{file} AND status IN"
          + " ('ready','recheck','rechecking')")
  String preview(String job, String file);
}
