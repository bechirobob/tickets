CREATE TABLE `attendee_event_preferences` (
	`attendee_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`attendee_visible` integer DEFAULT false NOT NULL,
	`keep_posted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_event_preferences_unique` ON `attendee_event_preferences` (`attendee_id`,`event_slug`);--> statement-breakpoint
CREATE INDEX `attendee_event_preferences_event_idx` ON `attendee_event_preferences` (`event_slug`,`keep_posted`);--> statement-breakpoint
CREATE TABLE `attendee_host_follows` (
	`attendee_id` text NOT NULL,
	`host_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_host_follows_unique` ON `attendee_host_follows` (`attendee_id`,`host_id`);--> statement-breakpoint
CREATE INDEX `attendee_host_follows_host_idx` ON `attendee_host_follows` (`host_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attendee_privacy_settings` (
	`attendee_id` text PRIMARY KEY NOT NULL,
	`default_attendee_visible` integer DEFAULT false NOT NULL,
	`allow_host_updates` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attendee_question_answers` (
	`question_id` text NOT NULL,
	`attendee_id` text NOT NULL,
	`answer` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_question_answers_unique` ON `attendee_question_answers` (`question_id`,`attendee_id`);--> statement-breakpoint
CREATE INDEX `attendee_question_answers_attendee_idx` ON `attendee_question_answers` (`attendee_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `event_hosts` (
	`event_slug` text NOT NULL,
	`host_id` text NOT NULL,
	`role` text DEFAULT 'Host' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_hosts_unique` ON `event_hosts` (`event_slug`,`host_id`);--> statement-breakpoint
CREATE INDEX `event_hosts_host_idx` ON `event_hosts` (`host_id`,`event_slug`);--> statement-breakpoint
CREATE TABLE `event_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`prompt` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`options_json` text,
	`required` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_questions_event_idx` ON `event_questions` (`event_slug`,`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `event_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_updates_event_idx` ON `event_updates` (`event_slug`,`published_at`);--> statement-breakpoint
CREATE TABLE `hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`bio` text NOT NULL,
	`city` text DEFAULT 'Accra' NOT NULL,
	`verification_status` text DEFAULT 'reviewed' NOT NULL,
	`profile_image_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_slug_unique` ON `hosts` (`slug`);
--> statement-breakpoint
INSERT INTO `hosts` (`id`, `slug`, `name`, `bio`, `city`, `verification_status`, `profile_image_url`, `created_at`, `updated_at`)
VALUES (
	'host:becore-preview-desk',
	'becore-preview-desk',
	'BeCore Preview Desk',
	'The team behind BeCore Tickets working previews. These listings exist so customers and organisers can test the complete journey before the live calendar opens.',
	'Accra',
	'verified',
	NULL,
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `event_hosts` (`event_slug`, `host_id`, `role`, `is_primary`, `created_at`)
SELECT `slug`, 'host:becore-preview-desk', 'Preview host', true, CURRENT_TIMESTAMP
FROM `curated_event_records`
WHERE `is_test_event` = true;
--> statement-breakpoint
INSERT INTO `event_questions` (`id`, `event_slug`, `prompt`, `kind`, `options_json`, `required`, `sort_order`, `status`, `created_at`)
SELECT 'question:' || `slug` || ':arrival', `slug`, 'When do you expect to arrive?', 'choice', '["At doors","Before midnight","After midnight","Not sure yet"]', false, 0, 'active', CURRENT_TIMESTAMP
FROM `curated_event_records`
WHERE `is_test_event` = true;
--> statement-breakpoint
INSERT INTO `event_questions` (`id`, `event_slug`, `prompt`, `kind`, `options_json`, `required`, `sort_order`, `status`, `created_at`)
SELECT 'question:' || `slug` || ':access', `slug`, 'Anything the event team should know about access or assistance?', 'text', NULL, false, 1, 'active', CURRENT_TIMESTAMP
FROM `curated_event_records`
WHERE `is_test_event` = true;
--> statement-breakpoint
INSERT INTO `event_updates` (`id`, `event_slug`, `title`, `body`, `pinned`, `published_at`, `published_by`)
SELECT 'update:' || `slug` || ':preview', `slug`, 'Your night is ready', 'This is a working preview. Your QR pass, Before the Night answers and Room access are all safe to test.', true, CURRENT_TIMESTAMP, 'BeCore Preview Desk'
FROM `curated_event_records`
WHERE `is_test_event` = true;
