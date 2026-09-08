ALTER TABLE `curated_event_records` ADD `guest_perk` text;
--> statement-breakpoint
UPDATE curated_event_records
SET guest_perk = 'Clink early. Free mimosas till 5 PM.',
    curation_note = 'The first Sunday in October belongs to the guest list. Join Kofi Billz at Asana Restaurant for good music, familiar faces and a little pink for a cause close to many hearts. Free mimosas till 5 PM. Fashionably late has consequences. Tell the group chat.',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'sun-chasers-labadi';
--> statement-breakpoint
UPDATE event_updates
SET body = 'On The Guest List is now Sunday 4 October, 2 PM to 10 PM at Asana Restaurant, Kempinski Gold Coast Hotel. Dress code: light pink and white, in support of Breast Cancer Awareness Month. Free mimosas till 5 PM. You know what to do. Your QR pass is in My Nights.'
WHERE id = 'update:sun-chasers-labadi:preview' AND event_slug = 'sun-chasers-labadi';
