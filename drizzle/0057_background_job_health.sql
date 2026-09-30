-- Additive operational evidence only; no customer or payment records change.
CREATE TABLE background_job_health (
  job_key TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
