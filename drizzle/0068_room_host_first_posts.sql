-- No backfill and no access grants. Activation requires an explicit feature flag.
-- Receipts are never retention-pruned: deletion/reposting must not re-arm a host.
CREATE TABLE room_host_first_posts (
 event_slug TEXT NOT NULL,
 host_account_id TEXT NOT NULL,
 message_id TEXT NOT NULL UNIQUE,
 sender_attendee_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 fanout_at TEXT,
 cancelled_at TEXT,
 PRIMARY KEY (event_slug, host_account_id)
);
CREATE INDEX room_host_first_posts_message_idx ON room_host_first_posts(message_id);
