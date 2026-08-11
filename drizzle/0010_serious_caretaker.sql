CREATE TABLE `room_flash_moderation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`attendee_id` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `room_flash_moderation_event_idx` ON `room_flash_moderation_events` (`event_slug`,`created_at`);--> statement-breakpoint
CREATE TABLE `room_flash_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`flash_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`reporter_attendee_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_flash_reports_reporter_unique` ON `room_flash_reports` (`flash_id`,`reporter_attendee_id`);--> statement-breakpoint
CREATE INDEX `room_flash_reports_event_status_idx` ON `room_flash_reports` (`event_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `room_flashes` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`attendee_id` text NOT NULL,
	`object_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`moderation_result` text DEFAULT 'allowed' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_flashes_object_unique` ON `room_flashes` (`object_key`);--> statement-breakpoint
CREATE INDEX `room_flashes_event_status_idx` ON `room_flashes` (`event_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `room_flashes_expiry_idx` ON `room_flashes` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `room_flashes_attendee_idx` ON `room_flashes` (`attendee_id`,`event_slug`,`status`);