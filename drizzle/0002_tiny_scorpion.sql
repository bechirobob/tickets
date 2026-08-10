CREATE TABLE `attendee_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_email` text NOT NULL,
	`phone` text,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_profiles_email_unique` ON `attendee_profiles` (`normalized_email`);--> statement-breakpoint
CREATE TABLE `attendee_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_sessions_token_unique` ON `attendee_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `attendee_sessions_attendee_idx` ON `attendee_sessions` (`attendee_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `order_access_grants` (
	`order_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`claimed_at` text,
	`claimed_session_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_access_grants_token_unique` ON `order_access_grants` (`token_hash`);--> statement-breakpoint
CREATE TABLE `room_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`blocker_attendee_id` text NOT NULL,
	`blocked_attendee_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_blocks_pair_unique` ON `room_blocks` (`event_slug`,`blocker_attendee_id`,`blocked_attendee_id`);--> statement-breakpoint
CREATE INDEX `room_blocks_blocker_idx` ON `room_blocks` (`blocker_attendee_id`,`event_slug`);--> statement-breakpoint
CREATE TABLE `room_moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`message_id` text,
	`target_attendee_id` text,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `room_moderation_event_idx` ON `room_moderation_actions` (`event_slug`,`created_at`);--> statement-breakpoint
CREATE TABLE `room_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`reporter_attendee_id` text NOT NULL,
	`message_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text
);
--> statement-breakpoint
CREATE INDEX `room_reports_event_status_idx` ON `room_reports` (`event_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `ticket_assignments` (
	`ticket_id` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`assigned_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `ticket_assignments_attendee_idx` ON `ticket_assignments` (`attendee_id`,`status`);--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_name` text;
