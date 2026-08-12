CREATE TABLE `product_metrics_daily` (
	`day` text NOT NULL,
	`event_slug` text DEFAULT '' NOT NULL,
	`metric` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_metrics_daily_unique` ON `product_metrics_daily` (`day`,`event_slug`,`metric`);
--> statement-breakpoint
CREATE INDEX `product_metrics_daily_event_idx` ON `product_metrics_daily` (`event_slug`,`day`);
