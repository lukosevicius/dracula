-- Artist matching: an AI step reads each event, code links the performers to artists (src/artists/matching.ts).

-- Artists Dracula adds itself (foreign acts and others missing from MusicBrainz) get a random UUID like MusicBrainz IDs.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'musicbrainz';

-- 'suggested' links wait for an editor in Seeker. Role and quote come from the AI step, and decided_by says who linked it.
ALTER TABLE event_artist_decisions
  ADD COLUMN IF NOT EXISTS role VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS evidence VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS decided_by VARCHAR(32) NOT NULL DEFAULT 'editor';
CREATE INDEX IF NOT EXISTS idx_event_artist_decisions_decision ON event_artist_decisions(decision);

-- The latest AI reading of each event. content_hash skips events whose text has not changed since.
-- result holds every performer found, how it was matched, and names with no artist yet (offered as new artists).
CREATE TABLE IF NOT EXISTS artist_extractions (
  event_id BIGINT NOT NULL PRIMARY KEY,
  content_hash CHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  model VARCHAR(191) NOT NULL,
  extracted_at VARCHAR(30) NOT NULL,
  status VARCHAR(32) NOT NULL,
  result LONGTEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd DOUBLE NULL,
  error_message VARCHAR(1000) NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
