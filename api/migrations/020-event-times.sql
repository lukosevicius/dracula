CREATE TABLE event_times (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT NOT NULL,
  event_date VARCHAR(10) NOT NULL,
  event_time VARCHAR(5) NULL,
  event_end_time VARCHAR(5) NULL,
  UNIQUE KEY uq_event_times_slot (event_id, event_date, event_time),
  INDEX idx_event_times_date (event_date, event_id),
  CONSTRAINT fk_event_times_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
