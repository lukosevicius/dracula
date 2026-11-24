CREATE TABLE verification_provider_requests (
  id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  verification_id BIGINT NULL,
  provider VARCHAR(30) NOT NULL,
  model VARCHAR(150) NOT NULL,
  requested_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  input_tokens INT UNSIGNED NULL,
  cached_input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  estimated_cost_usd DECIMAL(18,9) NULL,
  INDEX idx_verification_provider_requests_time(requested_at),
  FOREIGN KEY(verification_id) REFERENCES event_verifications(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE event_verifications ADD INDEX idx_event_verifications_finished(finished_at);
ALTER TABLE verification_jobs
  ADD COLUMN started_at DATETIME(3) NULL,
  ADD INDEX idx_verification_jobs_created(created_at);
