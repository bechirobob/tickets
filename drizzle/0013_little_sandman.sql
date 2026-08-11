CREATE TABLE `attendee_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`event_slug` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`source_id` text,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE INDEX `attendee_notifications_inbox_idx` ON `attendee_notifications` (`attendee_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_notifications_source_unique` ON `attendee_notifications` (`attendee_id`,`kind`,`source_id`);--> statement-breakpoint
CREATE TABLE `gate_checkin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`action` text NOT NULL,
	`gate` text NOT NULL,
	`actor_account_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`device_id` text,
	`client_scan_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gate_checkin_events_client_scan_unique` ON `gate_checkin_events` (`client_scan_id`);--> statement-breakpoint
CREATE INDEX `gate_checkin_events_ticket_idx` ON `gate_checkin_events` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `gate_checkin_events_event_idx` ON `gate_checkin_events` (`event_slug`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`attendee_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`room_messages` integer DEFAULT true NOT NULL,
	`host_updates` integer DEFAULT true NOT NULL,
	`muted_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_attendee_event_unique` ON `notification_preferences` (`attendee_id`,`event_slug`);--> statement-breakpoint
CREATE INDEX `notification_preferences_event_idx` ON `notification_preferences` (`event_slug`,`room_messages`,`muted_until`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_success_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_attendee_idx` ON `push_subscriptions` (`attendee_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `ticket_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`sender_attendee_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text,
	`cancelled_at` text,
	`recipient_attendee_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_transfers_token_unique` ON `ticket_transfers` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ticket_transfers_ticket_status_idx` ON `ticket_transfers` (`ticket_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `ticket_transfers_sender_idx` ON `ticket_transfers` (`sender_attendee_id`,`status`,`created_at`);