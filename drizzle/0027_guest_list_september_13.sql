-- Publish the approved event on its fixed date. Keep its existing URL and inventory.
UPDATE curated_event_records
SET starts_at = '2026-09-13T14:00:00.000Z',
    ends_at = '2026-09-13T22:00:00.000Z',
    sales_open_at = NULL,
    sales_close_at = '2026-09-13T14:00:00.000Z',
    is_test_event = 0,
    event_state = 'on_sale',
    status = 'published',
    rescheduled_from = NULL,
    curation_note = 'Sunday plans? You are on the guest list. Join Kofi Billz at Asana Restaurant, Kempinski Gold Coast Hotel, from 2 PM to 10 PM. Dress code: white with a touch of golden brown. Tell the group chat.',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'sun-chasers-labadi';
--> statement-breakpoint
UPDATE event_ticket_tiers
SET description = CASE code
      WHEN 'general' THEN 'Your way onto the guest list. One admission.'
      WHEN 'vip' THEN 'VIP admission and your VIP identity in The Room.'
      ELSE description
    END,
    sales_open_at = NULL,
    sales_close_at = '2026-09-13T14:00:00.000Z',
    updated_at = CURRENT_TIMESTAMP
WHERE event_slug = 'sun-chasers-labadi';
--> statement-breakpoint
-- Detach only the seeded placeholder host; other host assignments remain intact.
DELETE FROM event_hosts
WHERE event_slug = 'sun-chasers-labadi' AND host_id = 'host:becore-preview-desk';
--> statement-breakpoint
UPDATE event_questions
SET options_json = '["At 2 PM","Before 5 PM","After 5 PM","Not sure yet"]'
WHERE id = 'question:sun-chasers-labadi:arrival' AND event_slug = 'sun-chasers-labadi';
--> statement-breakpoint
UPDATE event_updates
SET title = 'Sunday is sorted',
    body = 'On The Guest List. Sunday 13 September, 2 PM to 10 PM at Asana Restaurant, Kempinski Gold Coast Hotel. Come in white with a touch of golden brown. Your QR pass is in My Nights.',
    published_by = 'BeCore Tickets'
WHERE id = 'update:sun-chasers-labadi:preview' AND event_slug = 'sun-chasers-labadi';
