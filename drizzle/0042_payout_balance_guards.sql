DROP INDEX `payout_transfers_settlement_unique`;--> statement-breakpoint
CREATE INDEX `payout_transfers_settlement_idx` ON `payout_transfers` (`settlement_id`);--> statement-breakpoint
CREATE TRIGGER payout_balance_guard BEFORE INSERT ON payout_transfers
WHEN NEW.status NOT IN ('failed','reversed')
BEGIN
  SELECT CASE WHEN NEW.amount_minor < 1 OR NEW.amount_minor + (
    SELECT COALESCE(SUM(p.amount_minor),0)
    FROM payout_transfers p JOIN event_settlements prior ON prior.id=p.settlement_id
    JOIN event_settlements current ON current.id=NEW.settlement_id
    WHERE p.event_slug=NEW.event_slug AND p.status NOT IN ('failed','reversed')
      AND prior.period_start<current.period_end AND prior.period_end>current.period_start
  ) > COALESCE((SELECT net_ticket_sales_minor FROM event_settlements WHERE id=NEW.settlement_id),0)
  THEN RAISE(ABORT,'Settlement balance is already reserved') END;
END;
--> statement-breakpoint
INSERT OR IGNORE INTO guest_entries (id,event_slug,guest_name,guest_email,guest_phone,admission_count,kind,note,status,created_by,created_at)
SELECT 'rsvp:'||r.id,r.event_slug,r.guest_name,r.normalized_email,r.phone,r.party_size,'guest_list','RSVP','expected','system:rsvp',r.created_at
FROM event_registrations r JOIN curated_event_records e ON e.slug=r.event_slug
WHERE r.status='confirmed' AND r.verified_at IS NULL AND e.removed_at IS NULL;
