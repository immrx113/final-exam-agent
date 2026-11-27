CREATE TABLE courses (
  seq BIGINT AUTO_INCREMENT PRIMARY KEY,
  id VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL UNIQUE,
  topic_ns VARCHAR(80) NOT NULL,
  profile VARCHAR(32) NOT NULL
);
INSERT INTO courses (id,name,topic_ns,profile)
VALUES ('default','数据库原理','数据库原理','database');

ALTER TABLE files
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_files_course (course_id,name,id),
  ADD CONSTRAINT fk_files_course FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE jobs
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_jobs_course (course_id,seq),
  ADD CONSTRAINT fk_jobs_course FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE analysis_versions
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_analysis_versions_course (course_id,seq),
  ADD CONSTRAINT fk_analysis_versions_course FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE study_states
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_study_states_course (course_id,topic),
  ADD CONSTRAINT fk_study_states_course FOREIGN KEY (course_id) REFERENCES courses(id);
