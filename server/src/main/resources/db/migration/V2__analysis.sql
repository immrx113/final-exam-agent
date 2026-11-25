CREATE TABLE analysis_versions (
  seq BIGINT AUTO_INCREMENT PRIMARY KEY,
  version_id CHAR(36) NOT NULL UNIQUE,
  job CHAR(36) NOT NULL,
  result_json LONGTEXT NOT NULL,
  FOREIGN KEY (job) REFERENCES jobs(id)
);
CREATE TABLE analysis_hits (
  version_id CHAR(36) NOT NULL,
  topic CHAR(36) NOT NULL,
  paper CHAR(64) NOT NULL,
  question_no INT NOT NULL,
  PRIMARY KEY (version_id, topic, paper, question_no),
  FOREIGN KEY (version_id) REFERENCES analysis_versions(version_id)
);
