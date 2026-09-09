ALTER TABLE `curated_event_records` ADD `removed_at` text;
--> statement-breakpoint
CREATE TABLE event_removal_cleanup (event_slug text PRIMARY KEY NOT NULL, created_at text NOT NULL);
--> statement-breakpoint
CREATE TRIGGER removed_event_stays_removed BEFORE UPDATE ON curated_event_records
WHEN OLD.removed_at IS NOT NULL AND (NEW.removed_at IS NULL OR NEW.status <> 'unpublished')
BEGIN SELECT RAISE(ABORT, 'Removed events cannot be republished'); END;

--> statement-breakpoint
CREATE TRIGGER removed_event_ticket_insert AFTER INSERT ON tickets
WHEN NEW.status = 'issued' AND EXISTS (SELECT 1 FROM curated_event_records WHERE slug = NEW.event_slug AND removed_at IS NOT NULL)
BEGIN UPDATE tickets SET status = 'voided' WHERE id = NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER removed_event_ticket_update AFTER UPDATE OF status ON tickets
WHEN NEW.status = 'issued' AND EXISTS (SELECT 1 FROM curated_event_records WHERE slug = NEW.event_slug AND removed_at IS NOT NULL)
BEGIN UPDATE tickets SET status = 'voided' WHERE id = NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER removed_event_registration_insert AFTER INSERT ON event_registrations
WHEN NEW.status NOT IN ('cancelled','declined') AND EXISTS (SELECT 1 FROM curated_event_records WHERE slug = NEW.event_slug AND removed_at IS NOT NULL)
BEGIN UPDATE event_registrations SET status = 'cancelled' WHERE id = NEW.id; END;
