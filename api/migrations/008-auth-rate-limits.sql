CREATE TABLE auth_rate_limits (
  bucket VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  window_start DATETIME(3) NOT NULL,
  attempts INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE user_sessions ADD INDEX idx_user_sessions_revoked (revoked_at);
