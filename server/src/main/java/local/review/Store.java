package local.review;

import io.minio.*;
import java.io.*;
import java.nio.file.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class Store {
  private static final String BUCKET = "review-m1";
  private final MinioClient client;
  private boolean initialized;

  Store(
      @Value("${review.endpoint}") String endpoint,
      @Value("${review.user}") String user,
      @Value("${review.password}") String password) {
    client = MinioClient.builder().endpoint(endpoint).credentials(user, password).build();
  }

  private synchronized void ensureBucket() throws Exception {
    if (initialized) return;
    if (!client.bucketExists(BucketExistsArgs.builder().bucket(BUCKET).build())) {
      client.makeBucket(MakeBucketArgs.builder().bucket(BUCKET).build());
    }
    initialized = true;
  }

  void put(String key, Path path) throws Exception {
    ensureBucket();
    client.uploadObject(
        UploadObjectArgs.builder().bucket(BUCKET).object(key).filename(path.toString()).build());
  }

  InputStream open(String key) throws Exception {
    return client.getObject(GetObjectArgs.builder().bucket(BUCKET).object(key).build());
  }
}
