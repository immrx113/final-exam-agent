import io.minio.*;
import java.io.*;
import java.nio.file.*;
import java.sql.*;
import java.util.*;

/** Fault injection for the disposable R1 database and bucket on the dedicated ports. */
class StorageFault {
  public static void main(String[] args) throws Exception {
    var config = new Properties();
    try (var in = Files.newInputStream(Path.of(".local/r1.env"))) { config.load(in); }
    if (!"33326".equals(config.getProperty("REVIEW_MYSQL_PORT"))
        || !"39026".equals(config.getProperty("REVIEW_MINIO_PORT"))) throw new AssertionError("test ports");
    var minio = MinioClient.builder().endpoint("http://127.0.0.1:39026")
        .credentials(config.getProperty("REVIEW_OBJECT_USER"), config.getProperty("REVIEW_OBJECT_PASSWORD")).build();
    try (minio; var db = DriverManager.getConnection(
        "jdbc:mysql://127.0.0.1:33326/review?allowPublicKeyRetrieval=true&sslMode=DISABLED",
        "review", config.getProperty("REVIEW_DB_PASSWORD"))) {
      String course = UUID.fromString(args[1]).toString();
      String file = args[2];
      if (!file.matches("[a-f0-9]{64}")) throw new AssertionError("invalid file");
      try (var q = db.prepareStatement("SELECT f.digest FROM files f JOIN courses c ON f.course_id=c.id " +
          "WHERE f.id=? AND c.id=? AND c.name LIKE 'R1-故障-%'")) {
        q.setString(1, file);
        q.setString(2, course);
        try (var row = q.executeQuery()) {
          if (!row.next()) throw new AssertionError("fixture outside test course");
          String digest = row.getString(1);
          String constraint = "r1_fault_" + file.substring(0, 16);
          try (var sql = db.createStatement()) {
            switch (args[0]) {
              case "block" -> sql.execute("ALTER TABLE parse_artifacts ADD CONSTRAINT " + constraint +
                  " CHECK (digest <> '" + digest + "')");
              case "release" -> sql.execute("ALTER TABLE parse_artifacts DROP CHECK " + constraint);
              case "unpublished" -> {
                try (var count = sql.executeQuery("SELECT COUNT(*) FROM parse_artifacts WHERE course_id='" +
                    course + "' AND digest='" + digest + "'")) {
                  count.next();
                  if (count.getInt(1) != 0) throw new AssertionError("incomplete artifact was published");
                }
              }
              case "hide-original" -> minio.removeObject(RemoveObjectArgs.builder().bucket("review-m1")
                  .object("original/" + digest).build());
              case "corrupt-preview" -> {
                try (var id = sql.executeQuery("SELECT artifact FROM items WHERE file='" + file +
                    "' AND artifact IS NOT NULL LIMIT 1")) {
                  if (!id.next()) throw new AssertionError("missing test artifact");
                  String key = "artifacts/" + id.getString(1) + "/lines.html";
                  byte[] bytes;
                  try (var in = minio.getObject(GetObjectArgs.builder().bucket("review-m1").object(key).build())) {
                    bytes = in.readAllBytes();
                  }
                  bytes[bytes.length / 2] ^= 1;
                  minio.putObject(PutObjectArgs.builder().bucket("review-m1").object(key)
                      .stream(new ByteArrayInputStream(bytes), bytes.length, -1).build());
                }
              }
              default -> throw new AssertionError("unknown operation");
            }
          }
        }
      }
    }
  }
}
