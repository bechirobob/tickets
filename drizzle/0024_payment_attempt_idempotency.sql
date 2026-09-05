CREATE TABLE `payment_attempts` (
  `key_hash` text PRIMARY KEY NOT NULL,
  `request_hash` text NOT NULL,
  `order_id` text NOT NULL,
  `response_json` text,
  `response_status` integer,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_attempts_order_idx` ON `payment_attempts` (`order_id`);
