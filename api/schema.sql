CREATE TABLE artists (mbid VARCHAR(191) PRIMARY KEY, name LONGTEXT NOT NULL, sort_name LONGTEXT, artist_type LONGTEXT, country LONGTEXT, area LONGTEXT, begin_area LONGTEXT, begin_date LONGTEXT, end_date LONGTEXT, disambiguation LONGTEXT, aliases_json LONGTEXT NOT NULL, source_url LONGTEXT NOT NULL, first_seen_at LONGTEXT NOT NULL, updated_at LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE events (id BIGINT AUTO_INCREMENT PRIMARY KEY, title LONGTEXT NOT NULL, event_date VARCHAR(32), event_end_date VARCHAR(32), event_time LONGTEXT, venue LONGTEXT, city VARCHAR(191), ticket_url LONGTEXT, review_status VARCHAR(32) NOT NULL, interest_score TINYINT UNSIGNED NOT NULL DEFAULT 1, manual_fields LONGTEXT NOT NULL, created_at LONGTEXT NOT NULL, updated_at LONGTEXT NOT NULL, CONSTRAINT chk_events_interest_score CHECK (interest_score BETWEEN 1 AND 5), INDEX idx_events_date_id(event_date,id), INDEX idx_events_review_date_id(review_status,event_date,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE event_sources (id BIGINT AUTO_INCREMENT PRIMARY KEY, event_id BIGINT NOT NULL, source_key VARCHAR(191) NOT NULL, source_id VARCHAR(191) NOT NULL, source_url LONGTEXT NOT NULL, content_html LONGTEXT NOT NULL, source_data_json LONGTEXT NOT NULL, last_checked_at LONGTEXT, about_url LONGTEXT, about_checked_at LONGTEXT, UNIQUE KEY(source_key,source_id), INDEX(event_id), FOREIGN KEY(event_id) REFERENCES events(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE event_artist_decisions (event_id BIGINT NOT NULL, artist_mbid VARCHAR(191) NOT NULL, decision VARCHAR(32) NOT NULL, PRIMARY KEY(event_id,artist_mbid), FOREIGN KEY(event_id) REFERENCES events(id), FOREIGN KEY(artist_mbid) REFERENCES artists(mbid)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE assistant_event_reviews (event_id BIGINT PRIMARY KEY, reviewed_at LONGTEXT NOT NULL, notes LONGTEXT NOT NULL, confirmed_at LONGTEXT, FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE event_prices (event_id BIGINT PRIMARY KEY, price_text LONGTEXT, price_type VARCHAR(32) NOT NULL, manual BIGINT NOT NULL, checked_at LONGTEXT, FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE jobs (id BIGINT AUTO_INCREMENT PRIMARY KEY, source LONGTEXT NOT NULL, action LONGTEXT NOT NULL, status LONGTEXT NOT NULL, started_at LONGTEXT NOT NULL, finished_at LONGTEXT, progress_json LONGTEXT NOT NULL, error_message LONGTEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE ai_evaluations (id BIGINT AUTO_INCREMENT PRIMARY KEY, job_id BIGINT NOT NULL, event_id BIGINT NOT NULL, model LONGTEXT NOT NULL, created_at LONGTEXT NOT NULL, classification LONGTEXT, explanation LONGTEXT, performers_json LONGTEXT NOT NULL, input_tokens BIGINT NOT NULL, output_tokens BIGINT NOT NULL, cost_usd DOUBLE NOT NULL, status LONGTEXT NOT NULL, error_message LONGTEXT, review_decision LONGTEXT NOT NULL, INDEX(job_id,event_id), FOREIGN KEY(event_id) REFERENCES events(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE import_runs (id BIGINT AUTO_INCREMENT PRIMARY KEY, started_at LONGTEXT NOT NULL, finished_at LONGTEXT, requested_limit BIGINT NOT NULL, fetched_count BIGINT NOT NULL, added_count BIGINT NOT NULL, updated_count BIGINT NOT NULL, status LONGTEXT NOT NULL, error_message LONGTEXT, mode LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE source_state (source_key VARCHAR(191) PRIMARY KEY, next_offset BIGINT NOT NULL, total_available BIGINT, updated_at LONGTEXT NOT NULL, last_request_at LONGTEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE vilnius_events (source_id BIGINT PRIMARY KEY, title LONGTEXT NOT NULL, source_url LONGTEXT NOT NULL, content_html LONGTEXT NOT NULL, categories_json LONGTEXT NOT NULL, featured_media BIGINT, published_at LONGTEXT, modified_at LONGTEXT, first_seen_at LONGTEXT NOT NULL, updated_at LONGTEXT NOT NULL, event_date LONGTEXT, event_time LONGTEXT, venue LONGTEXT, ticket_url LONGTEXT, details_manual BIGINT NOT NULL, review_status LONGTEXT NOT NULL, details_checked_at LONGTEXT, event_end_date LONGTEXT, details_version BIGINT NOT NULL, manual_fields LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE vilnius_event_artists (event_id BIGINT NOT NULL, artist_mbid VARCHAR(191) NOT NULL, decision VARCHAR(32) NOT NULL, PRIMARY KEY(event_id,artist_mbid), FOREIGN KEY(event_id) REFERENCES vilnius_events(source_id) ON DELETE CASCADE, FOREIGN KEY(artist_mbid) REFERENCES artists(mbid) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE vilnius_event_runs (id BIGINT AUTO_INCREMENT PRIMARY KEY, started_at LONGTEXT NOT NULL, finished_at LONGTEXT, status LONGTEXT NOT NULL, fetched_count BIGINT NOT NULL, added_count BIGINT NOT NULL, updated_count BIGINT NOT NULL, error_message LONGTEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE job_leases (source_key VARCHAR(191) PRIMARY KEY, job_id BIGINT NOT NULL, run_id BIGINT, import_run_id BIGINT, owner_hash CHAR(64) NOT NULL, expires_at BIGINT NOT NULL, FOREIGN KEY(job_id) REFERENCES jobs(id), FOREIGN KEY(run_id) REFERENCES vilnius_event_runs(id), FOREIGN KEY(import_run_id) REFERENCES import_runs(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE vilnius_images (media_id BIGINT PRIMARY KEY, source_url LONGTEXT NOT NULL, local_name LONGTEXT NOT NULL, mime_type LONGTEXT NOT NULL, width BIGINT, height BIGINT, source_modified LONGTEXT, downloaded_at LONGTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE event_images (event_id BIGINT PRIMARY KEY, source_key VARCHAR(191) NOT NULL, source_id VARCHAR(191) NOT NULL, source_url LONGTEXT NOT NULL, local_name LONGTEXT NOT NULL, mime_type LONGTEXT NOT NULL, width BIGINT, height BIGINT, downloaded_at LONGTEXT NOT NULL, UNIQUE KEY(source_key,source_id), FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE seeker_saved_events (event_id BIGINT NOT NULL PRIMARY KEY, saved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE seeker_settings (setting_key VARCHAR(191) NOT NULL PRIMARY KEY, setting_value JSON NOT NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE verification_providers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  provider ENUM('gemini','openai') NOT NULL,
  model VARCHAR(150) NOT NULL,
  encrypted_key VARBINARY(4096) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE verification_rule_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rules JSON NOT NULL,
  activated_by VARCHAR(191) NOT NULL,
  activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;

CREATE TABLE verification_rule_state (
  id TINYINT PRIMARY KEY,
  active_version_id BIGINT NULL,
  draft JSON NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  FOREIGN KEY(active_version_id) REFERENCES verification_rule_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO verification_rule_state(id) VALUES(1);

INSERT INTO verification_rule_versions(rules,activated_by,activated_at)
VALUES (
  JSON_OBJECT(
    'markdown', '# Music classification

Classify concerts, live performances, DJ sets and events where music is the main activity as music. Use not_music when the main activity is unrelated to music. Use unsure if the listing does not establish which applies.

# Source description

Use the imported description as evidence for event details. Leave the description itself as supplied. Report a finding for a specific field when a saved detail conflicts with reliable evidence or a required detail is missing.

# Performers

Check who actually performs using the title and description. Keep confirmed artist links and use the catalogue for new links when the listing clearly identifies the performer. Report each performer separately using their listed name and supporting quote. Log weak identifications, such as a guest credited only by first name, as observations. Flag an ambiguous catalogue match when the listing clearly identifies the performer. A tribute subject, composer, influence or person merely mentioned in the listing is not a performer.

# Dates, times and venue

Use Vilnius local time. Distinguish the performance start from doors, the end time and the date the listing was published. Use structured source values as evidence. Flag explicit disagreements between the listing text and structured values, and quote the competing value. Never infer a missing year or time.

# Ticket prices

Use the advertised general admission price. An explicit positive ticket price means paid admission. Leave a matching saved price type confirmed. A blank ticket price can be filled from clear evidence on a Draft or Live event when the price is unlocked and the action permission allows it. Ignore optional fees, free table reservations and free admission for specific age groups when deciding the general price. Report a review item when reliable ticket sources conflict or the general price is genuinely ambiguous.

# Other details

Leave unknown optional details unknown. Report specific cancellation or duplicate signals when supported by the evidence.',
    'permissions', JSON_OBJECT(
      'title', 'review', 'event_date', 'auto', 'event_end_date', 'auto', 'event_time', 'auto',
      'venue', 'auto', 'city', 'auto', 'ticket_url', 'auto', 'about_url', 'auto',
      'price_type', 'auto', 'price_text', 'auto', 'artists', 'auto', 'music', 'auto',
      'not_music', 'auto', 'unsure', 'review', 'publication_status', 'auto'
    )
  ),
  'Seeker defaults · Focused verification',
  UTC_TIMESTAMP(3)
);

UPDATE verification_rule_state
SET active_version_id=LAST_INSERT_ID(),revision=revision+1
WHERE id=1 AND active_version_id IS NULL;

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
  rules_version_id BIGINT NULL,
  preview_rules JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  UNIQUE KEY(import_job_id),
  UNIQUE KEY(actor,request_key),
  INDEX idx_verification_jobs_created(created_at),
  FOREIGN KEY(rules_version_id) REFERENCES verification_rule_versions(id)
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
  INDEX idx_event_verifications_finished(finished_at),
  UNIQUE KEY(job_id,event_id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES verification_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

ALTER TABLE event_sources ADD is_secondary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE event_redirects (
  old_event_id BIGINT PRIMARY KEY,
  event_id BIGINT NOT NULL,
  merged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_event_redirects_event(event_id),
  CONSTRAINT fk_event_redirects_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE event_duplicate_dismissals (
  first_event_id BIGINT NOT NULL,
  second_event_id BIGINT NOT NULL,
  dismissed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (first_event_id, second_event_id),
  INDEX idx_event_duplicate_dismissals_second(second_event_id),
  CONSTRAINT fk_event_duplicate_dismissals_first FOREIGN KEY (first_event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_duplicate_dismissals_second FOREIGN KEY (second_event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT chk_event_duplicate_dismissals_order CHECK (first_event_id < second_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE events ADD event_end_time VARCHAR(5) NULL AFTER event_time;

-- Avilys listings already carry an end time in their source data (Vilnius wall time, even with a trailing Z).
UPDATE events e
JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id AND source_key='avilys' ORDER BY id LIMIT 1)
SET e.event_end_time=SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(s.source_data_json,'$.endTime')),12,5)
WHERE e.event_end_time IS NULL AND JSON_VALID(s.source_data_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(s.source_data_json,'$.endTime')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]';

-- Event type replaces the music classification: music, festival, other or unsure. "Not music" becomes "other".
UPDATE events SET review_status='other' WHERE review_status='not_music';
UPDATE vilnius_events SET review_status='other' WHERE review_status='not_music';

START TRANSACTION;

-- Rules still using the default classification paragraph get the event type wording as a new active version.
-- Customised rules are left as they are, and verification accepts "not_music" from them as "other".
INSERT INTO verification_rule_versions(rules,activated_by,activated_at)
SELECT JSON_SET(v.rules,
    '$.markdown', REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.markdown')),
      '# Music classification', '# Event type'),
      'Use not_music when the main activity is unrelated to music.',
      'Use festival for a festival programme where music is a main part. Use other when the main activity is not music.'),
    '$.permissions.festival', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.permissions.music')), 'auto'),
    '$.permissions.other', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.permissions.not_music')), 'auto')),
  'Seeker defaults · Event types', UTC_TIMESTAMP(3)
FROM verification_rule_state s JOIN verification_rule_versions v ON v.id=s.active_version_id
WHERE s.id=1 AND JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.markdown')) LIKE '%Use not_music when the main activity is unrelated to music.%';

UPDATE verification_rule_state
SET active_version_id=LAST_INSERT_ID(),revision=revision+1
WHERE id=1 AND EXISTS (SELECT 1 FROM verification_rule_versions WHERE id=LAST_INSERT_ID() AND activated_by='Seeker defaults · Event types');

COMMIT;
