CREATE TABLE marketing_contacts (
 email TEXT PRIMARY KEY, provider_id TEXT, unsubscribed INTEGER NOT NULL DEFAULT 0,
 reserved INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE marketing_state (
 id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'checking', contact_count INTEGER NOT NULL DEFAULT 0,
 reserved_count INTEGER NOT NULL DEFAULT 0, checked_at TEXT, error TEXT, lease_token TEXT, lease_until TEXT
);
INSERT INTO marketing_state (id) VALUES ('resend');
CREATE TABLE marketing_campaigns (
 id TEXT PRIMARY KEY, event_slug TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 template TEXT NOT NULL, audience TEXT NOT NULL, scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, recipient_count INTEGER NOT NULL,
 segment_id TEXT, broadcast_id TEXT, html TEXT NOT NULL, text_body TEXT NOT NULL,
 error TEXT, sent_at TEXT, metrics_at TEXT, metrics_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX marketing_campaigns_status_schedule ON marketing_campaigns(status,scheduled_at);
CREATE INDEX marketing_campaigns_event_created ON marketing_campaigns(event_slug,created_at);
CREATE TABLE marketing_recipients (
 campaign_id TEXT NOT NULL, contact_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 PRIMARY KEY(campaign_id,contact_id)
);
