CREATE TABLE `operational_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_account_id` text,
	`actor_email` text,
	`actor_role` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`outcome` text NOT NULL,
	`detail` text,
	`request_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operational_audit_actor_idx` ON `operational_audit_events` (`actor_account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `operational_audit_target_idx` ON `operational_audit_events` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `organizer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`requested_by` text NOT NULL,
	`kind` text NOT NULL,
	`order_id` text,
	`detail` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reviewed_by` text,
	`review_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organizer_requests_event_status_idx` ON `organizer_requests` (`event_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_hash` text,
	`path` text NOT NULL,
	`request_id` text,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_events_kind_idx` ON `security_events` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`password_changed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_accounts_email_unique` ON `staff_accounts` (`normalized_email`);--> statement-breakpoint
CREATE INDEX `staff_accounts_role_status_idx` ON `staff_accounts` (`role`,`status`);--> statement-breakpoint
CREATE TABLE `staff_event_assignments` (
	`account_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`assigned_by` text NOT NULL,
	`assigned_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_event_assignments_unique` ON `staff_event_assignments` (`account_id`,`event_slug`);--> statement-breakpoint
CREATE INDEX `staff_event_assignments_event_idx` ON `staff_event_assignments` (`event_slug`,`account_id`);--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	`ip_hash` text,
	`user_agent_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_sessions_token_unique` ON `staff_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `staff_sessions_account_idx` ON `staff_sessions` (`account_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `system_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text
);
--> statement-breakpoint
CREATE INDEX `system_alerts_status_idx` ON `system_alerts` (`status`,`created_at`);