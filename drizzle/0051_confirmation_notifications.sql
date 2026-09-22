ALTER TABLE push_subscriptions ADD COLUMN confirmation_updates INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN room_updates INTEGER NOT NULL DEFAULT 1;
ALTER TABLE event_registrations ADD COLUMN device_claimed_at TEXT;
ALTER TABLE orders ADD COLUMN checkout_attendee_id TEXT;
CREATE TABLE confirmation_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  lease_token TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX confirmation_deliveries_pending_idx ON confirmation_deliveries(status, lease_until);
