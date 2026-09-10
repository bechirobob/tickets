ALTER TABLE `attendee_recovery_grants` ADD `claimed_session_id` text;--> statement-breakpoint
ALTER TABLE `payment_refunds` ADD `transition_id` text;--> statement-breakpoint
ALTER TABLE `payment_refunds` ADD `previous_order_status` text;--> statement-breakpoint
ALTER TABLE `ticket_transfers` ADD `claimed_session_id` text;