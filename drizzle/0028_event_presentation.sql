ALTER TABLE `curated_event_records` ADD `dress_code` text;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `colour_scheme` text;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `awareness_note` text;
--> statement-breakpoint
UPDATE curated_event_records
SET starts_at = '2026-10-04T14:00:00.000Z', ends_at = '2026-10-04T22:00:00.000Z',
    sales_close_at = '2026-10-04T14:00:00.000Z',
    dress_code = 'Light pink & white', colour_scheme = 'blush',
    awareness_note = 'In support of Breast Cancer Awareness Month',
    rescheduled_from = '2026-09-13T14:00:00.000Z',
    curation_note = 'The first Sunday in October belongs to the guest list. Join Kofi Billz at Asana Restaurant for an afternoon of good music, familiar faces and a little pink for a cause close to many hearts. Tell the group chat.',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'sun-chasers-labadi';
--> statement-breakpoint
UPDATE event_ticket_tiers
SET sales_close_at = '2026-10-04T14:00:00.000Z', updated_at = CURRENT_TIMESTAMP
WHERE event_slug = 'sun-chasers-labadi';
--> statement-breakpoint
UPDATE event_updates
SET title = 'October looks good on you',
    body = 'On The Guest List is now Sunday 4 October, 2 PM to 10 PM at Asana Restaurant, Kempinski Gold Coast Hotel. Dress code: light pink and white, in support of Breast Cancer Awareness Month. Your QR pass is in My Nights.',
    published_by = 'BeCore Tickets'
WHERE id = 'update:sun-chasers-labadi:preview' AND event_slug = 'sun-chasers-labadi';
