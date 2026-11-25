ALTER TABLE analysis_versions
  ADD video_status VARCHAR(12) NULL,
  ADD video_result TEXT NULL,
  ADD video_token CHAR(36) NULL,
  ADD video_started DATETIME NULL,
  ADD INDEX video_jobs (video_status, seq);
