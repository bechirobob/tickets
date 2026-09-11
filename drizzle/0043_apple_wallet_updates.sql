CREATE TABLE `apple_wallet_update_clock` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `value` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
INSERT INTO `apple_wallet_update_clock` (`id`,`value`) VALUES (1,1);
--> statement-breakpoint
CREATE TABLE `apple_wallet_passes` (
  `id` text PRIMARY KEY NOT NULL,
  `ticket_id` text NOT NULL,
  `attendee_id` text NOT NULL,
  `event_slug` text NOT NULL,
  `pass_type_identifier` text NOT NULL,
  `serial_number` text NOT NULL,
  `update_tag` integer DEFAULT 1 NOT NULL,
  `last_pushed_tag` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apple_wallet_pass_identity_unique` ON `apple_wallet_passes` (`pass_type_identifier`,`serial_number`);
--> statement-breakpoint
CREATE INDEX `apple_wallet_ticket_owner_idx` ON `apple_wallet_passes` (`ticket_id`,`attendee_id`);
--> statement-breakpoint
CREATE INDEX `apple_wallet_event_idx` ON `apple_wallet_passes` (`event_slug`,`update_tag`,`last_pushed_tag`);
--> statement-breakpoint
CREATE TABLE `apple_wallet_devices` (
  `device_library_id` text PRIMARY KEY NOT NULL,
  `push_token` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `apple_wallet_registrations` (
  `device_library_id` text NOT NULL,
  `pass_id` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY(`device_library_id`,`pass_id`)
);
--> statement-breakpoint
CREATE INDEX `apple_wallet_registration_pass_idx` ON `apple_wallet_registrations` (`pass_id`);
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_event_refresh` AFTER UPDATE OF `title`,`venue`,`area`,`starts_at`,`ends_at`,`event_state`,`schedule_status`,`removed_at` ON `curated_event_records`
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE event_slug=NEW.slug);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE event_slug=NEW.slug;
END;
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_ticket_refresh` AFTER UPDATE OF `status` ON `tickets`
WHEN OLD.status <> NEW.status
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=NEW.id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE ticket_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_assignment_refresh` AFTER UPDATE OF `status` ON `ticket_assignments`
WHEN OLD.status <> NEW.status
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=NEW.ticket_id AND attendee_id=OLD.attendee_id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE ticket_id=NEW.ticket_id AND attendee_id=OLD.attendee_id;
END;
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_assignment_insert_refresh` AFTER INSERT ON `ticket_assignments`
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=NEW.ticket_id AND attendee_id=NEW.attendee_id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE ticket_id=NEW.ticket_id AND attendee_id=NEW.attendee_id;
END;
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_assignment_delete_refresh` AFTER DELETE ON `ticket_assignments`
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=OLD.ticket_id AND attendee_id=OLD.attendee_id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE ticket_id=OLD.ticket_id AND attendee_id=OLD.attendee_id;
END;
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_gate_update_refresh` AFTER UPDATE OF `token` ON `ticket_gate_credentials`
WHEN OLD.token <> NEW.token
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=NEW.ticket_id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE ticket_id=NEW.ticket_id;
END;
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_gate_insert_refresh` AFTER INSERT ON `ticket_gate_credentials`
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=NEW.ticket_id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE ticket_id=NEW.ticket_id;
END;
--> statement-breakpoint
CREATE TRIGGER `apple_wallet_gate_delete_refresh` AFTER DELETE ON `ticket_gate_credentials`
BEGIN
  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE ticket_id=OLD.ticket_id);
  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=CURRENT_TIMESTAMP WHERE ticket_id=OLD.ticket_id;
END;