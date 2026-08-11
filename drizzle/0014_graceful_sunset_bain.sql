CREATE TABLE `ticket_gate_credentials` (
	`ticket_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`issued_at` text NOT NULL,
	`rotated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_gate_credentials_token_unique` ON `ticket_gate_credentials` (`token`);