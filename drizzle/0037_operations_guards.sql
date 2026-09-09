CREATE TRIGGER operations_tier_capacity_guard
BEFORE UPDATE OF capacity_admissions ON event_ticket_tiers
WHEN NEW.capacity_admissions < (
  SELECT COALESCE(SUM(admission_count), 0) FROM inventory_reservations
  WHERE ticket_tier_id = OLD.id AND (status = 'consumed' OR (status = 'held' AND julianday(expires_at) > julianday('now')))
)
BEGIN
  SELECT RAISE(ABORT, 'Admission capacity is below the current allocation. Refresh inventory.');
END;
--> statement-breakpoint
CREATE TRIGGER operations_cancelled_event_guard
BEFORE UPDATE OF event_state ON curated_event_records
WHEN OLD.event_state = 'cancelled' AND NEW.event_state <> 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'A cancelled event cannot be reopened through the event editor.');
END;
