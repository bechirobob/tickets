CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`event_slug` text,
	`target_id` text,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text NOT NULL,
	`requested_by_email` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_by` text,
	`decided_by_email` text,
	`decided_at` text,
	`decision_note` text,
	`completed_at` text,
	`failure_reason` text
);
--> statement-breakpoint
CREATE INDEX `approval_requests_status_idx` ON `approval_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`policy` text NOT NULL,
	`version` text NOT NULL,
	`actor_email` text,
	`ip_hash` text,
	`user_agent_hash` text,
	`accepted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consent_records_subject_policy_unique` ON `consent_records` (`subject_type`,`subject_id`,`policy`,`version`);--> statement-breakpoint
CREATE INDEX `consent_records_subject_idx` ON `consent_records` (`subject_type`,`subject_id`,`accepted_at`);--> statement-breakpoint
CREATE TABLE `event_readiness_checks` (
	`event_slug` text NOT NULL,
	`check_key` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`checked_by` text,
	`checked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_readiness_checks_unique` ON `event_readiness_checks` (`event_slug`,`check_key`);--> statement-breakpoint
CREATE TABLE `gate_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`gate` text NOT NULL,
	`account_id` text NOT NULL,
	`account_email` text NOT NULL,
	`pending_offline_scans` integer DEFAULT 0 NOT NULL,
	`manifest_generated_at` text,
	`last_sync_at` text,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gate_devices_event_idx` ON `gate_devices` (`event_slug`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `guest_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`guest_name` text NOT NULL,
	`guest_email` text,
	`guest_phone` text,
	`admission_count` integer DEFAULT 1 NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'expected' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`checked_in_at` text,
	`checked_in_by` text
);
--> statement-breakpoint
CREATE INDEX `guest_entries_event_idx` ON `guest_entries` (`event_slug`,`status`,`guest_name`);--> statement-breakpoint
CREATE TABLE `operational_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text
);
--> statement-breakpoint
CREATE INDEX `operational_incidents_event_idx` ON `operational_incidents` (`event_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `organizer_payout_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`account_name` text NOT NULL,
	`recipient_type` text NOT NULL,
	`bank_code` text NOT NULL,
	`account_number_masked` text NOT NULL,
	`recipient_code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`verified_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organizer_payout_accounts_event_idx` ON `organizer_payout_accounts` (`event_slug`,`status`);--> statement-breakpoint
CREATE TABLE `payout_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_id` text NOT NULL,
	`event_slug` text NOT NULL,
	`payout_account_id` text NOT NULL,
	`approval_request_id` text,
	`reference` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`status` text NOT NULL,
	`provider_transfer_code` text,
	`failure_reason` text,
	`initiated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`paid_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_transfers_reference_unique` ON `payout_transfers` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `payout_transfers_settlement_unique` ON `payout_transfers` (`settlement_id`);--> statement-breakpoint
CREATE INDEX `payout_transfers_event_idx` ON `payout_transfers` (`event_slug`,`status`);--> statement-breakpoint
CREATE TABLE `policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`policy` text NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`content_hash` text NOT NULL,
	`effective_at` text NOT NULL,
	`retired_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policy_versions_policy_version_unique` ON `policy_versions` (`policy`,`version`);--> statement-breakpoint
CREATE TABLE `refund_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`approval_request_id` text,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`total_orders` integer DEFAULT 0 NOT NULL,
	`processed_orders` integer DEFAULT 0 NOT NULL,
	`failed_orders` integer DEFAULT 0 NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `refund_batches_status_idx` ON `refund_batches` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `staff_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`purpose` text NOT NULL,
	`challenge` text NOT NULL,
	`exchange_token_hash` text NOT NULL,
	`return_to` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_auth_challenges_exchange_unique` ON `staff_auth_challenges` (`exchange_token_hash`);--> statement-breakpoint
CREATE INDEX `staff_auth_challenges_account_idx` ON `staff_auth_challenges` (`account_id`,`purpose`,`expires_at`);--> statement-breakpoint
CREATE TABLE `staff_passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` blob NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports_json` text,
	`label` text DEFAULT 'Passkey' NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_passkeys_credential_unique` ON `staff_passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `staff_passkeys_account_idx` ON `staff_passkeys` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE INDEX `staff_recovery_codes_account_idx` ON `staff_recovery_codes` (`account_id`,`used_at`);--> statement-breakpoint
ALTER TABLE `delivery_events` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_events` ADD `next_attempt_at` text;--> statement-breakpoint
ALTER TABLE `delivery_events` ADD `provider_event_at` text;--> statement-breakpoint
ALTER TABLE `delivery_events` ADD `payload_json` text;--> statement-breakpoint
ALTER TABLE `payment_refunds` ADD `ticket_ids_json` text;--> statement-breakpoint
ALTER TABLE `payment_refunds` ADD `batch_id` text;--> statement-breakpoint
CREATE INDEX `payment_refunds_batch_idx` ON `payment_refunds` (`batch_id`,`status`);--> statement-breakpoint
ALTER TABLE `staff_accounts` ADD `mfa_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_sessions` ADD `device_label` text;--> statement-breakpoint
ALTER TABLE `staff_sessions` ADD `mfa_verified_at` text;