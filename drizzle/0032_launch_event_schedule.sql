ALTER TABLE `curated_event_records` ADD `schedule_status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `curated_event_records` ADD `is_verified` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Retire preview listings, not their orders, tickets or audit history.
UPDATE curated_event_records SET status = 'unpublished', scheduled_publish_at = NULL,
  updated_at = CURRENT_TIMESTAMP WHERE is_test_event = 1;
--> statement-breakpoint
UPDATE curated_event_records SET schedule_status = 'coming_soon', is_verified = 1,
  sales_open_at = NULL, sales_close_at = NULL, rescheduled_from = NULL,
  curation_note = 'You are on the guest list. Join Kofi Billz at Asana Restaurant for good music, familiar faces and a little pink for a cause close to many hearts. The date is coming soon. Clink early. Free mimosas till 5 PM. Tell the group chat.',
  updated_at = CURRENT_TIMESTAMP WHERE slug = 'sun-chasers-labadi';
--> statement-breakpoint
UPDATE event_ticket_tiers SET status = 'hidden', updated_at = CURRENT_TIMESTAMP
WHERE event_slug = 'sun-chasers-labadi' OR event_slug IN
  (SELECT slug FROM curated_event_records WHERE is_test_event = 1);
--> statement-breakpoint
UPDATE event_updates SET title = 'Your name is still on the list',
  body = 'On The Guest List is coming soon. The date will be announced here. Light pink and white, good music and free mimosas till 5 PM. Keep the outfit ready.',
  published_by = 'BeCore Tickets'
WHERE id = 'update:sun-chasers-labadi:preview';
--> statement-breakpoint
-- The legacy non-null end column uses the start as a storage bound only.
-- end_pending exposes no end time and prevents sales; no closing time is invented.
INSERT INTO curated_event_records (
  id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe,
  price_from_minor, capacity, sales_close_at, venue_map_url, age_restriction, lineup,
  event_state, is_test_event, schedule_status, is_verified, colour_scheme, guest_perk,
  image_url, curation_note, status, published_at, created_at, updated_at
) VALUES (
  'event:the-weekend-braai', 'listing:the-weekend-braai', 'the-weekend-braai',
  'The Weekend Braai — Birthday Edition', 'Number Nineteen',
  'No. 19 Akosombo Street, Airport Residential Area, Accra',
  '2026-09-20T14:00:00.000Z', '2026-09-20T14:00:00.000Z', 'Day party',
  35000, 0, '2026-09-20T14:00:00.000Z',
  'https://www.google.com/maps/search/?api=1&query=19+Akosombo+Street+Airport+Residential+Area+Accra',
  'Confirm entry requirements with the organiser',
  'Hosted by Kofi Billz × Ghadi × Shepherd. With Kofi Kay, MP3 and Accra Mayor.',
  'on_sale', 0, 'end_pending', 0, 'sunset', 'Unlimited grills & drinks · GH₵350',
  '/events/the-weekend-braai.jpeg',
  'The grill is doing overtime. Your Sunday should not. The Weekend Braai is back for a birthday edition: grills, beers, tequila and games at Number Nineteen. Bring your appetite; the group chat can fend for itself. Event enquiries: +233 53 316 3613.',
  'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
