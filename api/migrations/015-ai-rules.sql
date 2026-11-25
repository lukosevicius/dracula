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

ALTER TABLE verification_jobs
  ADD rules_version_id BIGINT NULL,
  ADD preview_rules JSON NULL,
  ADD FOREIGN KEY(rules_version_id) REFERENCES verification_rule_versions(id);
