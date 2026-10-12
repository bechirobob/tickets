-- Additive delivery outbox; captured by the verified-payment transaction only.
CREATE TABLE organizer_purchase_push_deliveries (
 id TEXT PRIMARY KEY,
 subscription_version TEXT NOT NULL,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES organizer_push_subscriptions(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 claim TEXT,
 completed_at TEXT,
 outcome TEXT
);
CREATE UNIQUE INDEX organizer_purchase_push_device ON organizer_purchase_push_deliveries(order_id, subscription_id);
CREATE INDEX organizer_purchase_push_pending ON organizer_purchase_push_deliveries(completed_at, lease_until, created_at);
