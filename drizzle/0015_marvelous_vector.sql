CREATE TABLE `attendee_event_decisions` (
	`attendee_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`decision` text NOT NULL,
	`decided_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_event_decisions_unique` ON `attendee_event_decisions` (`attendee_id`,`event_slug`);--> statement-breakpoint
CREATE INDEX `attendee_event_decisions_event_idx` ON `attendee_event_decisions` (`event_slug`,`decision`);--> statement-breakpoint
CREATE TABLE `event_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`image_url` text,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_memories_event_idx` ON `event_memories` (`event_slug`,`published_at`);--> statement-breakpoint
CREATE TABLE `event_promoter_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_promoter_codes_event_code_unique` ON `event_promoter_codes` (`event_slug`,`code`);--> statement-breakpoint
CREATE INDEX `event_promoter_codes_event_status_idx` ON `event_promoter_codes` (`event_slug`,`status`);--> statement-breakpoint
CREATE TABLE `event_waitlist_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`ticket_tier_id` text,
	`normalized_email` text NOT NULL,
	`phone` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`offer_token_hash` text,
	`offered_at` text,
	`offer_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_waitlist_active_email_unique` ON `event_waitlist_entries` (`event_slug`,`normalized_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_waitlist_offer_token_unique` ON `event_waitlist_entries` (`offer_token_hash`);--> statement-breakpoint
CREATE INDEX `event_waitlist_queue_idx` ON `event_waitlist_entries` (`event_slug`,`ticket_tier_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_recovery_events` (
	`order_id` text PRIMARY KEY NOT NULL,
	`provider_status` text NOT NULL,
	`delivery_status` text NOT NULL,
	`attempted_at` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `room_settings` (
	`event_slug` text PRIMARY KEY NOT NULL,
	`emergency_read_only` integer DEFAULT false NOT NULL,
	`slow_mode_seconds` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_suspensions` (
	`event_slug` text NOT NULL,
	`attendee_id` text NOT NULL,
	`reason` text NOT NULL,
	`suspended_at` text NOT NULL,
	`suspended_by` text NOT NULL,
	`restored_at` text,
	`restored_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_suspensions_event_attendee_unique` ON `room_suspensions` (`event_slug`,`attendee_id`);--> statement-breakpoint
CREATE INDEX `room_suspensions_active_idx` ON `room_suspensions` (`event_slug`,`restored_at`);--> statement-breakpoint
CREATE TABLE `support_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`order_id` text,
	`kind` text DEFAULT 'general' NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `support_cases_attendee_idx` ON `support_cases` (`attendee_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `support_cases_queue_idx` ON `support_cases` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `support_cases_event_idx` ON `support_cases` (`event_slug`,`status`);--> statement-breakpoint
CREATE TABLE `support_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `support_messages_case_idx` ON `support_messages` (`case_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `promoter_code` text;