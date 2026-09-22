ALTER TABLE push_subscriptions ADD COLUMN host_updates INTEGER NOT NULL DEFAULT 0;
-- Preserve existing Room consent; booking-only devices must explicitly opt in.
UPDATE push_subscriptions SET host_updates = room_updates;

CREATE TABLE room_announcement_deliveries (
  id TEXT PRIMARY KEY,
  attendee_id TEXT NOT NULL,
  event_slug TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX room_announcement_pending_idx ON room_announcement_deliveries(status, next_attempt_at);
