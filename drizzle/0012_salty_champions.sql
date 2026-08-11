DROP INDEX `attendee_profiles_email_unique`;--> statement-breakpoint
ALTER TABLE `attendee_profiles` ADD `email_verified_at` text;--> statement-breakpoint
UPDATE `attendee_sessions` SET `revoked_at` = CURRENT_TIMESTAMP WHERE `revoked_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_profiles_verified_email_unique` ON `attendee_profiles` (`normalized_email`) WHERE "attendee_profiles"."email_verified_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `attendee_profiles_email_idx` ON `attendee_profiles` (`normalized_email`,`email_verified_at`);
