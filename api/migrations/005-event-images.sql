CREATE TABLE event_images (
  event_id BIGINT PRIMARY KEY,
  source_key VARCHAR(191) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  source_url LONGTEXT NOT NULL,
  local_name LONGTEXT NOT NULL,
  mime_type LONGTEXT NOT NULL,
  width BIGINT,
  height BIGINT,
  downloaded_at LONGTEXT NOT NULL,
  CONSTRAINT fk_event_images_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE KEY uq_event_images_source (source_key,source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
