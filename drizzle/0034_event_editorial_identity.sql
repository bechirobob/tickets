ALTER TABLE `curated_event_records` ADD `tagline` text;--> statement-breakpoint
CREATE UNIQUE INDEX `curated_events_tagline_unique` ON `curated_event_records` (lower(trim("tagline")));--> statement-breakpoint
ALTER TABLE `party_submissions` ADD `tagline` text;
--> statement-breakpoint
UPDATE curated_event_records SET tagline = 'Grills on. You’re off duty.' WHERE slug = 'the-weekend-braai';
--> statement-breakpoint
UPDATE curated_event_records SET tagline = 'A little pink. A very good excuse.' WHERE slug = 'sun-chasers-labadi';
--> statement-breakpoint
UPDATE party_submissions SET tagline = (SELECT tagline FROM curated_event_records WHERE slug = party_submissions.event_slug) WHERE event_slug IN ('the-weekend-braai', 'sun-chasers-labadi');
