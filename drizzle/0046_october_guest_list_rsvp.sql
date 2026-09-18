-- Owner-approved RSVP before the exact October date is announced.
-- This opt-in does not unlock paid checkout or invent a start time.
ALTER TABLE event_registration_settings ADD COLUMN allow_undated_rsvp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE curated_event_records ADD COLUMN schedule_label TEXT;

UPDATE curated_event_records SET schedule_status = 'coming_soon', schedule_label = 'October · Coming soon',
  curation_note = 'October plans? Get your name in early. Join Kofi Bills at Asana Restaurant for good music, familiar faces and a little pink for a cause close to many hearts. The exact date is still under wraps. RSVP spots are limited. Light pink and white, free mimosas till 5 PM. Tell the group chat.',
  sales_open_at = NULL, sales_close_at = NULL, updated_at = CURRENT_TIMESTAMP
WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL;

INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, approval_required, room_access, accepting, closes_at, notify_host, allow_undated_rsvp, updated_at)
SELECT e.slug, 'rsvp', COALESCE(NULLIF(s.capacity,0),100), COALESCE(s.max_party_size,1),
  COALESCE(s.approval_required,0), COALESCE(s.room_access,0), 1,
  CASE WHEN s.closes_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN s.closes_at ELSE NULL END,
  COALESCE(s.notify_host,1),1,CURRENT_TIMESTAMP
FROM curated_event_records e LEFT JOIN event_registration_settings s ON s.event_slug=e.slug
WHERE e.slug='sun-chasers-labadi' AND e.status='published' AND e.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM orders WHERE event_slug=e.slug AND payment_provider<>'rsvp' AND status IN ('paid','payment_pending'))
ON CONFLICT(event_slug) DO UPDATE SET mode='rsvp', capacity=excluded.capacity, accepting=1,
  closes_at=excluded.closes_at, allow_undated_rsvp=1, updated_at=CURRENT_TIMESTAMP;

-- Published event copy already identifies Kofi Bills as the host.
INSERT INTO event_hosts (event_slug,host_id,role,is_primary,created_at)
SELECT e.slug,h.id,'Host',NOT EXISTS (SELECT 1 FROM event_hosts WHERE event_slug=e.slug AND is_primary=1),CURRENT_TIMESTAMP
FROM curated_event_records e JOIN hosts h ON h.slug='kofi-bills'
WHERE e.slug='sun-chasers-labadi' AND e.removed_at IS NULL
ON CONFLICT(event_slug,host_id) DO NOTHING;
