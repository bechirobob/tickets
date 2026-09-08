-- Adapt only the existing day-party test listing; keep its identity and inventory.
UPDATE curated_event_records
SET title = 'On The Guest List',
    venue = 'Asana Restaurant',
    area = 'Kempinski Gold Coast Hotel, Accra',
    venue_map_url = 'https://www.google.com/maps/search/?api=1&query=Asana+Restaurant+Kempinski+Gold+Coast+Hotel+Accra',
    image_url = '/events/on-the-guest-list.webp',
    lineup = 'Kofi Billz',
    curation_note = 'A Sunday day party at Asana Restaurant, Kempinski Gold Coast Hotel. From 2 PM to 10 PM, with Kofi Billz. Event artwork and venue are shown as a preview; dates and tickets are for testing.',
    starts_at = substr(starts_at, 1, 10) || 'T14:00:00.000Z',
    ends_at = substr(starts_at, 1, 10) || 'T22:00:00.000Z',
    sales_close_at = substr(starts_at, 1, 10) || 'T14:00:00.000Z',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'sun-chasers-labadi' AND is_test_event = 1;
--> statement-breakpoint
UPDATE event_ticket_tiers
SET name = 'VIP admission', description = 'VIP access for the preview event', updated_at = CURRENT_TIMESTAMP
WHERE event_slug = 'sun-chasers-labadi' AND code = 'vip'
AND EXISTS (SELECT 1 FROM curated_event_records WHERE slug = 'sun-chasers-labadi' AND is_test_event = 1);
