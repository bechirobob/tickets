CREATE TABLE `staff_password_recoveries` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`account_updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text,
	`claim_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_password_recoveries_token_unique` ON `staff_password_recoveries` (`token_hash`);--> statement-breakpoint
CREATE INDEX `staff_password_recoveries_account_idx` ON `staff_password_recoveries` (`account_id`);