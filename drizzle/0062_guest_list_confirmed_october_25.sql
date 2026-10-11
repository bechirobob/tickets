-- Owner-confirmed Pink Edition flyer, date and GMT registration opening.
-- Preserve bookings, inventory, host assignments and registration policies.
UPDATE curated_event_records
SET starts_at = '2026-10-25T14:00:00.000Z',
    ends_at = '2026-10-25T22:00:00.000Z',
    schedule_status = 'confirmed', schedule_label = NULL,
    sales_open_at = '2026-10-12T00:00:00.000Z',
    sales_close_at = '2026-10-25T14:00:00.000Z',
    image_url = '/events/on-the-guest-list-20261025.webp',
    venue = 'Asana Bar & Kitchen', area = 'Kempinski Hotel Gold Coast City, Accra',
    lineup = '',
    curation_note = 'Club House Inc brings the Pink Edition to Asana. Sunday 25 October, 2–10 PM. Light pink and white. Free mimosas till 5 PM. Tell the group chat.',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL;
--> statement-breakpoint
UPDATE event_registration_settings
SET accepting = 1, allow_undated_rsvp = 0, updated_at = CURRENT_TIMESTAMP
WHERE event_slug = 'sun-chasers-labadi' AND mode = 'rsvp'
  AND EXISTS (SELECT 1 FROM curated_event_records WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL);
--> statement-breakpoint
UPDATE party_submissions
SET starts_at = '2026-10-25T14:00:00.000Z', ends_at = '2026-10-25T22:00:00.000Z',
    venue_name = 'Asana Bar & Kitchen', area = 'Kempinski Hotel Gold Coast City, Accra', lineup = '',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT submission_id FROM curated_event_records WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL);
--> statement-breakpoint
UPDATE event_updates
SET title = 'Sunday 25 October is sorted',
    body = 'On The Guest List · Pink Edition. Sunday 25 October, 2 PM to 10 PM GMT at Asana Bar & Kitchen, Kempinski Hotel Gold Coast City, Accra. RSVP opens 12 October at 12 AM GMT. Light pink and white. Free mimosas till 5 PM.',
    published_by = 'BeCore Tickets'
WHERE id = 'update:sun-chasers-labadi:preview' AND event_slug = 'sun-chasers-labadi';
