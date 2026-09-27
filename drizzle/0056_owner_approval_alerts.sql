-- Capture only new review requests. Existing applications are not backfilled.
-- Triggers commit with the form/status change, independently of email availability.
CREATE TABLE owner_approval_outbox (
 kind TEXT NOT NULL CHECK (kind IN ('host','event')),
 target_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY (kind,target_id)
);
CREATE TRIGGER owner_host_review_requested AFTER UPDATE OF status ON host_applications
WHEN NEW.status='pending' AND OLD.status='awaiting_email' AND NEW.email_verified_at IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO owner_approval_outbox(kind,target_id) VALUES ('host',NEW.id);
END;
CREATE TRIGGER owner_event_review_created AFTER INSERT ON party_submissions
WHEN NEW.status='submitted'
BEGIN
 INSERT OR IGNORE INTO owner_approval_outbox(kind,target_id) VALUES ('event',NEW.id);
END;
CREATE TRIGGER owner_event_draft_submitted AFTER UPDATE OF status ON party_submissions
WHEN NEW.status='submitted' AND OLD.status='draft'
BEGIN
 INSERT OR IGNORE INTO owner_approval_outbox(kind,target_id) VALUES ('event',NEW.id);
END;
