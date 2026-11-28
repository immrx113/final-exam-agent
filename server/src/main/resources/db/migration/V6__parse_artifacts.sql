CREATE TABLE parse_artifacts (
  seq BIGINT AUTO_INCREMENT PRIMARY KEY,
  id CHAR(36) NOT NULL UNIQUE,
  course_id VARCHAR(36) NOT NULL,
  digest CHAR(64) NOT NULL,
  format VARCHAR(8) NOT NULL,
  profile CHAR(64) NOT NULL,
  text_digest CHAR(64) NOT NULL,
  manifest MEDIUMTEXT NOT NULL,
  INDEX reuse_candidate(course_id,digest,format,profile,seq),
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE TABLE artifact_segments (
  artifact CHAR(36) NOT NULL, pos INT NOT NULL,
  body MEDIUMTEXT NOT NULL, review BOOLEAN NOT NULL,
  PRIMARY KEY(artifact,pos),
  FOREIGN KEY(artifact) REFERENCES parse_artifacts(id) ON DELETE CASCADE
);
CREATE TABLE item_artifacts (
  job CHAR(36) NOT NULL, file CHAR(64) NOT NULL, artifact CHAR(36) NOT NULL,
  PRIMARY KEY(job,file,artifact),
  FOREIGN KEY(job,file) REFERENCES items(job,file) ON DELETE CASCADE,
  FOREIGN KEY(artifact) REFERENCES parse_artifacts(id) ON DELETE CASCADE
);
ALTER TABLE items ADD artifact CHAR(36), ADD parse_origin VARCHAR(8),
  ADD FOREIGN KEY(artifact) REFERENCES parse_artifacts(id);
