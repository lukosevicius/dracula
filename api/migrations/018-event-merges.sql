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
