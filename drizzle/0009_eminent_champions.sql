ALTER TABLE `curated_event_records` ADD `is_test_event` integer DEFAULT false NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `curated_event_records` (
  `id`, `submission_id`, `slug`, `title`, `venue`, `area`, `starts_at`, `ends_at`,
  `vibe`, `price_from_minor`, `capacity`, `sales_open_at`, `sales_close_at`,
  `venue_map_url`, `age_restriction`, `lineup`, `event_state`, `is_test_event`,
  `image_url`, `curation_note`, `status`, `published_at`, `created_at`, `updated_at`
) VALUES
  (
    'preview:event:after-dark-osu', 'preview:submission:after-dark-osu', 'after-dark-osu',
    'After Dark: Osu', 'The Treehouse', 'Osu', '2026-08-14T22:00:00.000Z', '2026-08-15T04:00:00.000Z',
    'Late night', 12000, 350, NULL, '2026-08-14T22:00:00.000Z',
    'https://www.google.com/maps/search/?api=1&query=Osu%2C%20Accra%2C%20Ghana', '18+',
    'Resident set · Guest selector · Closing set', 'on_sale', 1,
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=88',
    'A compact room, a sharp DJ line-up and zero space for standing like you were forced to attend. Come early.',
    'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'preview:event:noir-room-labone', 'preview:submission:noir-room-labone', 'noir-room-labone',
    'The Noir Room', 'The Glass House', 'Labone', '2026-08-15T21:30:00.000Z', '2026-08-16T03:00:00.000Z',
    'Alté', 18000, 300, NULL, '2026-08-15T21:30:00.000Z',
    'https://www.google.com/maps/search/?api=1&query=Labone%2C%20Accra%2C%20Ghana', '18+',
    'Alté set · R&B set · Late-night guest', 'on_sale', 1,
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1500&q=88',
    'For a dressed-up crowd that wants discovery, not the same playlist on repeat. Your everyday black T-shirt needs a convincing argument.',
    'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'preview:event:sun-chasers-labadi', 'preview:submission:sun-chasers-labadi', 'sun-chasers-labadi',
    'Sun Chasers', 'The Cove', 'Labadi', '2026-08-16T15:00:00.000Z', '2026-08-16T23:00:00.000Z',
    'Day party', 15000, 400, NULL, '2026-08-16T15:00:00.000Z',
    'https://www.google.com/maps/search/?api=1&query=Labadi%2C%20Accra%2C%20Ghana', '18+',
    'Afrobeats set · Sunset set · Amapiano close', 'on_sale', 1,
    'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1500&q=88',
    'Sunset timing, open air and enough space to make a full Sunday of it. Sunglasses may become emotional support by 7 PM.',
    'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'preview:event:longitude-spintex', 'preview:submission:longitude-spintex', 'longitude-spintex',
    'Longitude 05', 'Untamed Empire', 'Spintex', '2026-08-21T23:00:00.000Z', '2026-08-22T05:00:00.000Z',
    'Amapiano', 10000, 500, NULL, '2026-08-21T23:00:00.000Z',
    'https://www.google.com/maps/search/?api=1&query=Spintex%2C%20Accra%2C%20Ghana', '18+',
    'Amapiano open · Live percussion · Warehouse close', 'on_sale', 1,
    'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1500&q=88',
    'A focused dance floor with production that earns the warehouse. Sensible shoes were considered, then respectfully declined.',
    'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );--> statement-breakpoint

INSERT OR IGNORE INTO `event_ticket_tiers` (
  `id`, `event_slug`, `code`, `name`, `description`, `price_minor`,
  `admissions_per_unit`, `capacity_admissions`, `max_units_per_order`,
  `status`, `sort_order`, `created_at`, `updated_at`
) VALUES
  ('preview:tier:after-dark-osu:general', 'after-dark-osu', 'general', 'General admission', 'One admission to the preview event', 12000, 1, 200, 6, 'available', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:after-dark-osu:vip', 'after-dark-osu', 'vip', 'Priority admission', 'Priority entry and reserved lounge access', 22000, 1, 100, 6, 'available', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:after-dark-osu:table', 'after-dark-osu', 'table-for-5', 'Table for 5', 'One table package admitting five people', 85000, 5, 50, 2, 'available', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:noir-room-labone:general', 'noir-room-labone', 'general', 'General admission', 'One admission to the preview event', 18000, 1, 180, 6, 'available', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:noir-room-labone:vip', 'noir-room-labone', 'vip', 'Priority admission', 'Priority entry and reserved lounge access', 30000, 1, 80, 6, 'available', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:noir-room-labone:table', 'noir-room-labone', 'table-for-4', 'Table for 4', 'One table package admitting four people', 95000, 4, 40, 2, 'available', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:sun-chasers-labadi:general', 'sun-chasers-labadi', 'general', 'General admission', 'One admission to the preview event', 15000, 1, 260, 6, 'available', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:sun-chasers-labadi:vip', 'sun-chasers-labadi', 'vip', 'Deck admission', 'Priority entry and access to the raised deck', 26000, 1, 100, 6, 'available', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:sun-chasers-labadi:table', 'sun-chasers-labadi', 'table-for-5', 'Table for 5', 'One table package admitting five people', 90000, 5, 40, 2, 'available', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:longitude-spintex:general', 'longitude-spintex', 'general', 'General admission', 'One admission to the preview event', 10000, 1, 320, 6, 'available', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:longitude-spintex:vip', 'longitude-spintex', 'vip', 'Fast-lane admission', 'Dedicated entry lane and raised-floor access', 20000, 1, 120, 6, 'available', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('preview:tier:longitude-spintex:table', 'longitude-spintex', 'table-for-5', 'Table for 5', 'One table package admitting five people', 75000, 5, 60, 2, 'available', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
