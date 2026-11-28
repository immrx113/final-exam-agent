CREATE TABLE analysis_tasks (
  seq BIGINT AUTO_INCREMENT PRIMARY KEY,
  id CHAR(36) NOT NULL UNIQUE,
  course_id VARCHAR(36) NOT NULL,
  job CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  state VARCHAR(12) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  input_json LONGTEXT,
  token CHAR(36),
  due_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  version CHAR(36),
  reason VARCHAR(160),
  error_code INT,
  UNIQUE KEY request_once(course_id, request_id),
  INDEX delivery(state, due_at),
  INDEX batch_task(course_id, job, seq),
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY(job) REFERENCES jobs(id) ON DELETE CASCADE
);
ALTER TABLE analysis_versions ADD task_id CHAR(36) UNIQUE,
  ADD FOREIGN KEY(task_id) REFERENCES analysis_tasks(id);
