ALTER TABLE job_leases ADD COLUMN import_run_id BIGINT NULL, ADD FOREIGN KEY(import_run_id) REFERENCES import_runs(id);
