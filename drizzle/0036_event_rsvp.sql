CREATE TABLE `event_registration_settings` (
	`event_slug` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'paid' NOT NULL,
	`capacity` integer DEFAULT 0 NOT NULL,
	`max_party_size` integer DEFAULT 1 NOT NULL,
	`approval_required` integer DEFAULT false NOT NULL,
	`room_access` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`normalized_email` text NOT NULL,
	`guest_name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`party_size` integer DEFAULT 1 NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`attendee_id` text,
	`order_id` text,
	`verified_at` text,
	`approved_at` text,
	`event_signature` text,
	`version` integer DEFAULT 0 NOT NULL,
	`notified_version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registrations_event_email_unique` ON `event_registrations` (`event_slug`,`normalized_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `registrations_order_unique` ON `event_registrations` (`order_id`);--> statement-breakpoint
CREATE INDEX `registrations_queue_idx` ON `event_registrations` (`event_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `registration_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`registration_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`claimed_session_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_access_token_unique` ON `registration_access_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `registration_access_recent_idx` ON `registration_access_grants` (`registration_id`,`created_at`);