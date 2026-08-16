CREATE INDEX `orders_analytics_event_status_date_idx`
ON `orders` (`event_slug`, `status`, COALESCE(`paid_at`, `created_at`));
--> statement-breakpoint
CREATE INDEX `tickets_analytics_event_status_checkin_idx`
ON `tickets` (`event_slug`, `status`, `checked_in_at`);
