-- One row per run of the scheduled import (seeker/scheduled-import.ts), from GitHub or the Mac, with every step's
-- result, so Seeker's Import log shows the whole run: imports, merged duplicates and artist matching.
CREATE TABLE IF NOT EXISTS scheduled_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  started_at VARCHAR(30) NOT NULL,
  finished_at VARCHAR(30) NOT NULL,
  origin VARCHAR(32) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  steps LONGTEXT NOT NULL,
  run_url VARCHAR(500) NULL,
  INDEX idx_scheduled_runs_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
