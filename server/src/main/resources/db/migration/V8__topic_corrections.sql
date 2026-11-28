ALTER TABLE analysis_versions
  ADD parent_version CHAR(36),
  ADD correction_request CHAR(36),
  ADD correction_digest CHAR(64),
  ADD plan_passages LONGTEXT,
  ADD UNIQUE KEY correction_once(course_id, correction_request);
