CREATE TABLE `attendee_recovery_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	`requested_ip_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_recovery_token_unique` ON `attendee_recovery_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `attendee_recovery_email_idx` ON `attendee_recovery_grants` (`normalized_email`,`expires_at`);--> statement-breakpoint
CREATE TABLE `delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`recovery_grant_id` text,
	`kind` text NOT NULL,
	`recipient` text NOT NULL,
	`provider_id` text,
	`status` text NOT NULL,
	`failure_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delivery_events_order_idx` ON `delivery_events` (`order_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `delivery_events_recipient_idx` ON `delivery_events` (`recipient`,`created_at`);--> statement-breakpoint
CREATE TABLE `event_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`gross_minor` integer NOT NULL,
	`booking_fees_minor` integer NOT NULL,
	`refunds_minor` integer NOT NULL,
	`net_ticket_sales_minor` integer NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_settlements_run_event_unique` ON `event_settlements` (`run_id`,`event_slug`);--> statement-breakpoint
CREATE INDEX `event_settlements_event_idx` ON `event_settlements` (`event_slug`,`period_end`);--> statement-breakpoint
CREATE TABLE `event_ticket_tiers` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`price_minor` integer NOT NULL,
	`admissions_per_unit` integer DEFAULT 1 NOT NULL,
	`capacity_admissions` integer NOT NULL,
	`max_units_per_order` integer DEFAULT 10 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`sales_open_at` text,
	`sales_close_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_ticket_tiers_event_code_unique` ON `event_ticket_tiers` (`event_slug`,`code`);--> statement-breakpoint
CREATE INDEX `event_ticket_tiers_event_idx` ON `event_ticket_tiers` (`event_slug`,`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `inventory_reservations` (
	`order_id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`ticket_tier_id` text NOT NULL,
	`unit_quantity` integer NOT NULL,
	`admission_count` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_reservations_capacity_idx` ON `inventory_reservations` (`ticket_tier_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `payment_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`paystack_dispute_id` text,
	`reference` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`category` text,
	`amount_minor` integer,
	`due_at` text,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_disputes_paystack_unique` ON `payment_disputes` (`paystack_dispute_id`);--> statement-breakpoint
CREATE INDEX `payment_disputes_reference_idx` ON `payment_disputes` (`reference`,`status`);--> statement-breakpoint
CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`paystack_refund_id` text,
	`amount_minor` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`failure_reason` text
);
--> statement-breakpoint
CREATE INDEX `payment_refunds_order_idx` ON `payment_refunds` (`order_id`,`status`);--> statement-breakpoint
CREATE TABLE `reconciliation_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`order_id` text,
	`reference` text NOT NULL,
	`local_status` text,
	`provider_status` text,
	`local_amount_minor` integer,
	`provider_amount_minor` integer,
	`result` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reconciliation_entries_run_idx` ON `reconciliation_entries` (`run_id`,`result`);--> statement-breakpoint
CREATE TABLE `reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`mismatch_count` integer DEFAULT 0 NOT NULL,
	`missing_count` integer DEFAULT 0 NOT NULL,
	`initiated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `reconciliation_period_idx` ON `reconciliation_runs` (`period_start`,`period_end`);--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `capacity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `sales_open_at` text;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `sales_close_at` text;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `venue_map_url` text;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `age_restriction` text DEFAULT '18+' NOT NULL;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `lineup` text DEFAULT 'Line-up to be announced' NOT NULL;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `event_state` text DEFAULT 'on_sale' NOT NULL;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `rescheduled_from` text;--> statement-breakpoint
UPDATE `curated_event_records`
SET `capacity` = COALESCE((
      SELECT `capacity` FROM `party_submissions`
      WHERE `party_submissions`.`id` = `curated_event_records`.`submission_id`
    ), `capacity`),
    `age_restriction` = COALESCE((
      SELECT `age_restriction` FROM `party_submissions`
      WHERE `party_submissions`.`id` = `curated_event_records`.`submission_id`
    ), `age_restriction`),
    `lineup` = COALESCE((
      SELECT `lineup` FROM `party_submissions`
      WHERE `party_submissions`.`id` = `curated_event_records`.`submission_id`
    ), `lineup`);--> statement-breakpoint
INSERT INTO `event_ticket_tiers` (
  `id`, `event_slug`, `code`, `name`, `description`, `price_minor`,
  `admissions_per_unit`, `capacity_admissions`, `max_units_per_order`,
  `status`, `sort_order`, `created_at`, `updated_at`
)
SELECT
  `id` || ':general', `slug`, 'general', 'General admission',
  'One admission to the event', `price_from_minor`, 1, `capacity`, 10,
  CASE WHEN `capacity` > 0 THEN 'available' ELSE 'hidden' END,
  0, `created_at`, `updated_at`
FROM `curated_event_records`;--> statement-breakpoint
ALTER TABLE `orders` ADD `paystack_transaction_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `paystack_status` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `ticket_tier_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `unit_quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `reservation_expires_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_updated_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_verified_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `failure_reason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `refund_status` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `refunded_amount_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `dispute_status` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `admission_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_order_admission_unique` ON `tickets` (`order_id`,`admission_number`);
