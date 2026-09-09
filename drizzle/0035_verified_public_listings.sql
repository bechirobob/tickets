-- Public curation is BeCore verification, including scheduled releases.
UPDATE curated_event_records SET is_verified = 1
WHERE status IN ('published', 'scheduled') AND is_test_event = 0;
--> statement-breakpoint
CREATE TRIGGER curated_events_verify_insert
AFTER INSERT ON curated_event_records
WHEN NEW.status IN ('published', 'scheduled') AND NEW.is_test_event = 0 AND NEW.is_verified = 0
BEGIN
  UPDATE curated_event_records SET is_verified = 1 WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER curated_events_verify_update
AFTER UPDATE OF status, is_test_event, is_verified ON curated_event_records
WHEN NEW.status IN ('published', 'scheduled') AND NEW.is_test_event = 0 AND NEW.is_verified = 0
BEGIN
  UPDATE curated_event_records SET is_verified = 1 WHERE id = NEW.id;
END;
