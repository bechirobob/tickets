CREATE TABLE `room_flash_views` (
	`flash_id` text NOT NULL,
	`attendee_id` text NOT NULL,
	`view_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`view_until` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_flash_views_guest_unique` ON `room_flash_views` (`flash_id`,`attendee_id`);