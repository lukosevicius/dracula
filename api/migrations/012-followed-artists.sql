CREATE TABLE user_followed_artists (
  user_id BIGINT NOT NULL,
  artist_mbid VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, artist_mbid),
  KEY idx_followed_artist (artist_mbid),
  CONSTRAINT fk_followed_artist_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_followed_artist_artist FOREIGN KEY (artist_mbid) REFERENCES artists(mbid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
