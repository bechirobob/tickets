-- Only new signups capture existing opted-in owner devices. No historical backfill.
CREATE TABLE yorkeway_owner_push_deliveries (
  id TEXT PRIMARY KEY,
  signup_id TEXT NOT NULL REFERENCES yorkeway_early_access(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES organizer_push_subscriptions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  subscription_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  claim TEXT,
  completed_at TEXT,
  outcome TEXT
);
CREATE UNIQUE INDEX yorkeway_owner_push_device ON yorkeway_owner_push_deliveries(signup_id,subscription_id);
CREATE INDEX yorkeway_owner_push_pending ON yorkeway_owner_push_deliveries(completed_at,lease_until,created_at);
