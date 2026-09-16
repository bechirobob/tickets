-- Additive invalidation triggers: old and new Worker releases can both use them.
CREATE TRIGGER apple_wallet_order_refresh AFTER UPDATE OF status ON orders
WHEN OLD.status <> NEW.status
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes p JOIN tickets t ON t.id=p.ticket_id WHERE t.order_id=NEW.id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER apple_wallet_holder_refresh AFTER UPDATE OF status,display_name ON attendee_profiles
WHEN OLD.status <> NEW.status OR OLD.display_name <> NEW.display_name
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE attendee_id=NEW.id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE attendee_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER apple_wallet_transfer_refresh AFTER UPDATE OF attendee_id ON ticket_assignments
WHEN OLD.attendee_id <> NEW.attendee_id
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=NEW.ticket_id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ticket_id=NEW.ticket_id;
END;
