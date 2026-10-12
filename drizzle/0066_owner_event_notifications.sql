-- Extend opt-in notifications to owner existing all-event access. No historical backfill.
DROP TRIGGER organizer_rsvp_push_created;
DROP TRIGGER organizer_rsvp_push_verified;
CREATE TRIGGER organizer_rsvp_push_created AFTER INSERT ON event_registrations
WHEN NEW.kind='rsvp' AND NEW.status IN ('requested','waitlisted','confirmed')
BEGIN
 INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)
 SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id
 FROM organizer_push_subscriptions p
 JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=p.account_id
 WHERE p.revoked_at IS NULL AND (s.role='owner' OR (s.role='organizer' AND EXISTS (SELECT 1 FROM staff_event_assignments a WHERE a.account_id=s.id AND a.event_slug=NEW.event_slug))) AND s.status='active'
 AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER organizer_rsvp_push_verified AFTER UPDATE OF status ON event_registrations
WHEN NEW.kind='rsvp' AND OLD.status='unverified' AND NEW.status IN ('requested','waitlisted','confirmed')
BEGIN
 INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)
 SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id
 FROM organizer_push_subscriptions p
 JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=p.account_id
 WHERE p.revoked_at IS NULL AND (s.role='owner' OR (s.role='organizer' AND EXISTS (SELECT 1 FROM staff_event_assignments a WHERE a.account_id=s.id AND a.event_slug=NEW.event_slug))) AND s.status='active'
 AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
