ALTER TABLE events
  ADD COLUMN interest_score TINYINT UNSIGNED NOT NULL DEFAULT 1;

ALTER TABLE events
  ADD CONSTRAINT chk_events_interest_score CHECK (interest_score BETWEEN 1 AND 5);
