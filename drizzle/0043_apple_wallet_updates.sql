CREATE TABLE `apple_wallet_passes` (
  `id` text PRIMARY KEY NOT NULL,
  `ticket_id` text NOT NULL,
  `attendee_id` text NOT NULL,
  `event_slug` text NOT NULL,
  `pass_type_identifier` text NOT NULL,
  `serial_number` text NOT NULL,
  `update_tag` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apple_wallet_pass_identity_unique` ON `apple_wallet_passes` (`pass_type_identifier`,`serial_number`);
--> statement-breakpoint
CREATE INDEX `apple_wallet_ticket_owner_idx` ON `apple_wallet_passes` (`ticket_id`,`attendee_id`);
--> statement-breakpoint
CREATE INDEX `apple_wallet_event_idx` ON `apple_wallet_passes` (`event_slug`,`update_tag`);
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