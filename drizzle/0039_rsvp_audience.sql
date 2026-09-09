CREATE TABLE `event_announcement_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `announcement_queue_idx` ON `event_announcement_campaigns` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `event_announcement_recipients` (
	`campaign_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimed_at` text,
	`delivery_id` text,
	PRIMARY KEY(`campaign_id`, `contact_id`)
);
--> statement-breakpoint
CREATE TABLE `event_audience_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`email` text NOT NULL,
	`guest_name` text NOT NULL,
	`source` text NOT NULL,
	`consented_at` text,
	`unsubscribed_at` text,
	`unsubscribe_token` text NOT NULL,
	`confirmed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_audience_email_unique` ON `event_audience_contacts` (`event_slug`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `audience_unsubscribe_unique` ON `event_audience_contacts` (`unsubscribe_token`);--> statement-breakpoint
CREATE TABLE `owner_activity_reads` (
	`account_id` text PRIMARY KEY NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `event_registrations` ADD `announcements_opt_in` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `announcements_opt_in` integer DEFAULT 0 NOT NULL;