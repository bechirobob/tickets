import { execFileSync } from 'node:child_process';
// This fixture only modifies the isolated local database, never a remote binding.
const now = new Date().toISOString();
const start = new Date(Date.now() + 7 * 86400000).toISOString();
const end = new Date(Date.now() + 8 * 86400000).toISOString();
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/state', '--command',
  // Preserve the historical non-null storage dates: coming_soon deliberately
  // hides them and makes this an undated interest fixture, not a reopened event.
  `UPDATE curated_event_records SET schedule_status='coming_soon', schedule_label=NULL, sales_open_at=NULL, sales_close_at=NULL WHERE slug='sun-chasers-labadi';
   UPDATE curated_event_records SET starts_at='${start}', ends_at='${end}', sales_open_at=NULL, sales_close_at='${start}', is_test_event=0, schedule_status='confirmed', status='published', event_state='on_sale' WHERE slug='after-dark-osu';
   INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, accepting, allow_undated_rsvp, updated_at) VALUES ('after-dark-osu', 'rsvp', 10, 3, 1, 0, '${now}') ON CONFLICT(event_slug) DO UPDATE SET mode='rsvp', capacity=10, max_party_size=3, accepting=1, closes_at=NULL, allow_undated_rsvp=0;
   INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, accepting, allow_undated_rsvp, updated_at) VALUES ('sun-chasers-labadi', 'interest', 100, 1, 1, 0, '${now}') ON CONFLICT(event_slug) DO UPDATE SET mode='interest', capacity=100, max_party_size=1, accepting=1, closes_at=NULL, allow_undated_rsvp=0;`], { stdio: 'inherit' });
