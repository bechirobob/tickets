CREATE TABLE organizer_report_preferences (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE organizer_report_rollout (id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL);
INSERT INTO organizer_report_rollout VALUES (1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE organizer_reports (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  period_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  event_slugs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(account_id,kind,period_key)
);
CREATE INDEX organizer_reports_account_created_idx ON organizer_reports(account_id,created_at);
