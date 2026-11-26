-- Listings a source took down. Imports skip them, because a source's list can keep showing a listing whose page is gone.
CREATE TABLE removed_listings (
  source_key VARCHAR(191) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  removed_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (source_key, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
