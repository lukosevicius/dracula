CREATE TABLE auth_challenges (
  challenge_hash BINARY(32) NOT NULL PRIMARY KEY,
  nonce_hash BINARY(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  INDEX idx_auth_challenges_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
