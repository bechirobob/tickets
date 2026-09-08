CREATE TABLE `seev_checkout_sessions` (
	`order_id` text PRIMARY KEY NOT NULL,
	`request_json` text,
	`checkout_url` text,
	`created_at` text NOT NULL,
	`checked_at` text,
	`lease_until` text,
	`last_error` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_provider` text DEFAULT 'paystack' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `provider_reference` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `provider_transaction_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `provider_status` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_environment` text;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_provider_reference_unique` ON `orders` (`payment_provider`,`provider_reference`);