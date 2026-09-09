ALTER TABLE `event_registration_settings` ADD `accepting` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_registration_settings` ADD `closes_at` text;--> statement-breakpoint
ALTER TABLE `event_registration_settings` ADD `notify_host` integer DEFAULT 1 NOT NULL;