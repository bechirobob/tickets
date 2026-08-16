CREATE TABLE `ticket_return_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`attendee_id` text NOT NULL,
	`order_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`ticket_tier_id` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`face_value_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`waitlist_demand_at_request` integer DEFAULT 0 NOT NULL,
	`requested_at` text NOT NULL,
	`cancelled_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_return_requests_ticket_unique` ON `ticket_return_requests` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `ticket_return_requests_queue_idx` ON `ticket_return_requests` (`event_slug`,`status`,`requested_at`);
