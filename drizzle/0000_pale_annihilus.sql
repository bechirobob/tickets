CREATE TABLE `booking_fee_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`percentage_basis_points` integer NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`effective_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `booking_fee_scope_idx` ON `booking_fee_rules` (`scope`,`scope_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`event_slug` text NOT NULL,
	`quantity` integer NOT NULL,
	`face_amount_minor` integer NOT NULL,
	`booking_fee_minor` integer NOT NULL,
	`total_amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text NOT NULL,
	`payment_channel` text NOT NULL,
	`status` text NOT NULL,
	`paystack_reference` text,
	`created_at` text NOT NULL,
	`paid_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_reference_unique` ON `orders` (`reference`);--> statement-breakpoint
CREATE INDEX `orders_event_status_idx` ON `orders` (`event_slug`,`status`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`reference` text NOT NULL,
	`received_at` text NOT NULL,
	`payload_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_payload_unique` ON `payment_events` (`payload_hash`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`ticket_type` text NOT NULL,
	`qr_token_hash` text NOT NULL,
	`status` text NOT NULL,
	`issued_at` text NOT NULL,
	`checked_in_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_qr_token_unique` ON `tickets` (`qr_token_hash`);--> statement-breakpoint
CREATE INDEX `tickets_order_idx` ON `tickets` (`order_id`);