ALTER TABLE events
  ADD publication_status ENUM('draft','live') NOT NULL DEFAULT 'draft',
  ADD publication_manual BOOLEAN NOT NULL DEFAULT FALSE,
  ADD publication_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD classification_manual BOOLEAN NOT NULL DEFAULT FALSE,
  ADD description_override TEXT NULL,
  ADD about_url_override VARCHAR(2048) NULL,
  ADD revision INT UNSIGNED NOT NULL DEFAULT 1,
  ADD verification_status ENUM('not_verified','queued','verifying','verified','stale','failed') NOT NULL DEFAULT 'not_verified',
  ADD needs_attention BOOLEAN NOT NULL DEFAULT FALSE,
  ADD INDEX idx_events_public_date(publication_status,event_date,id),
  ADD INDEX idx_events_verification(verification_status,id),
  ADD INDEX idx_events_attention(needs_attention,id);

UPDATE events SET publication_status='live' WHERE review_status='music';

ALTER TABLE event_sources ADD detail_evidence_json JSON NULL;

CREATE TABLE event_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT NOT NULL,
  action VARCHAR(50) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  changes JSON NOT NULL,
  context JSON NOT NULL,
  INDEX(event_id,id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO event_history(event_id,action,actor,occurred_at,changes,context)
  SELECT id,'publication_migrated','migration',UTC_TIMESTAMP(3),JSON_OBJECT(),JSON_OBJECT('publication_status','live')
  FROM events WHERE publication_status='live';

CREATE TABLE verification_providers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  provider ENUM('gemini','openai') NOT NULL,
  model VARCHAR(150) NOT NULL,
  encrypted_key VARBINARY(4096) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE verification_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  profile_id BIGINT NULL,
  provider VARCHAR(30) NULL,
  model VARCHAR(150) NULL,
  import_job_id BIGINT NULL,
  actor VARCHAR(191) NOT NULL,
  request_key VARCHAR(100) NULL,
  request_hash CHAR(64) NULL,
  allow_publish BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY(import_job_id),
  UNIQUE KEY(actor,request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE event_verifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL,
  event_revision INT UNSIGNED NOT NULL,
  status ENUM('queued','running','completed','failed','skipped') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  claim CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  result JSON NULL,
  error_message VARCHAR(500) NULL,
  INDEX(status,id),
  INDEX(event_id,id),
  UNIQUE KEY(job_id,event_id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES verification_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE verification_findings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT NOT NULL,
  verification_id BIGINT NULL,
  field_name VARCHAR(50) NOT NULL,
  finding JSON NOT NULL,
  status ENUM('open','approved','dismissed','superseded') NOT NULL DEFAULT 'open',
  resolved_by VARCHAR(191) NULL,
  INDEX(event_id,status,id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(verification_id) REFERENCES event_verifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE seeker_agent_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  scopes JSON NOT NULL,
  revoked_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE seeker_import_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(191) NOT NULL,
  request_key VARCHAR(100) NOT NULL,
  options JSON NOT NULL,
  status ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
  job_id BIGINT NULL,
  claim CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  error_message VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY(actor,request_key),
  INDEX(status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
