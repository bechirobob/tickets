ALTER TABLE `event_ticket_tiers` ADD `room_badge` text;--> statement-breakpoint
UPDATE `event_ticket_tiers`
SET `room_badge` = 'VIP'
WHERE lower(`code`) IN ('vip', 'v-vip', 'vvip')
   OR lower(`name`) IN ('vip', 'v-vip', 'vvip');--> statement-breakpoint
CREATE TABLE `event_vip_settings` (
	`event_slug` text PRIMARY KEY NOT NULL,
	`bottle_service_enabled` integer DEFAULT false NOT NULL,
	`bottle_menu` text,
	`song_suggestions_enabled` integer DEFAULT false NOT NULL,
	`assistance_enabled` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `vip_concierge_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`attendee_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`location` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`organizer_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `vip_concierge_event_status_idx` ON `vip_concierge_requests` (`event_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `vip_concierge_attendee_idx` ON `vip_concierge_requests` (`attendee_id`,`event_slug`,`created_at`);
