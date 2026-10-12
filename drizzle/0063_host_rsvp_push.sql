-- Additive, opt-in host devices; no historical RSVP backfill.
CREATE TABLE organizer_push_subscriptions (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES staff_sessions(id) ON DELETE CASCADE,
 consent_id TEXT NOT NULL,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE INDEX organizer_push_account ON organizer_push_subscriptions(account_id, revoked_at);
CREATE TABLE organizer_rsvp_push_deliveries (
 id TEXT PRIMARY KEY,
 subscription_version TEXT NOT NULL,
 registration_id TEXT NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES organizer_push_subscriptions(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 claim TEXT,
 completed_at TEXT,
 outcome TEXT
);
CREATE UNIQUE INDEX organizer_rsvp_push_device ON organizer_rsvp_push_deliveries(registration_id, subscription_id);
CREATE INDEX organizer_rsvp_push_pending ON organizer_rsvp_push_deliveries(completed_at, lease_until, created_at);
CREATE TRIGGER organizer_rsvp_push_created AFTER INSERT ON event_registrations
WHEN NEW.kind='rsvp' AND NEW.status IN ('requested','waitlisted','confirmed')
BEGIN
 INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)
 SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id
 FROM organizer_push_subscriptions p JOIN staff_event_assignments a ON a.account_id=p.account_id
 JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id
 WHERE a.event_slug=NEW.event_slug AND p.revoked_at IS NULL AND s.role='organizer' AND s.status='active'
 AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER organizer_rsvp_push_verified AFTER UPDATE OF status ON event_registrations
WHEN NEW.kind='rsvp' AND OLD.status='unverified' AND NEW.status IN ('requested','waitlisted','confirmed')
BEGIN
 INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)
 SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id
 FROM organizer_push_subscriptions p JOIN staff_event_assignments a ON a.account_id=p.account_id
 JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id
 WHERE a.event_slug=NEW.event_slug AND p.revoked_at IS NULL AND s.role='organizer' AND s.status='active'
 AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
