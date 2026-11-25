CREATE TABLE study_states (
  topic CHAR(36) PRIMARY KEY,
  revision BIGINT NOT NULL,
  completed BOOLEAN NOT NULL,
  note MEDIUMTEXT NOT NULL
);
