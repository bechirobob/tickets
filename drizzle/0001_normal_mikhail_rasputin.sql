CREATE TABLE `curated_event_records` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`venue` text NOT NULL,
	`area` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`vibe` text NOT NULL,
	`price_from_minor` integer NOT NULL,
	`image_url` text NOT NULL,
	`curation_note` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_publish_at` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curated_events_submission_unique` ON `curated_event_records` (`submission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `curated_events_slug_unique` ON `curated_event_records` (`slug`);--> statement-breakpoint
CREATE INDEX `curated_events_publication_idx` ON `curated_event_records` (`status`,`scheduled_publish_at`);--> statement-breakpoint
CREATE TABLE `curation_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`action` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `curation_audit_submission_idx` ON `curation_audit_events` (`submission_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `party_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`organizer_name` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_phone` text NOT NULL,
	`title` text NOT NULL,
	`concept` text NOT NULL,
	`venue_name` text NOT NULL,
	`area` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`vibe` text NOT NULL,
	`lineup` text NOT NULL,
	`capacity` integer NOT NULL,
	`price_from_minor` integer NOT NULL,
	`age_restriction` text NOT NULL,
	`social_url` text,
	`poster_object_key` text,
	`poster_content_type` text,
	`status` text NOT NULL,
	`review_note` text,
	`curation_note` text,
	`scheduled_publish_at` text,
	`published_at` text,
	`event_slug` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `party_submissions_status_idx` ON `party_submissions` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `party_submissions_event_slug_unique` ON `party_submissions` (`event_slug`);