import { execFileSync } from 'node:child_process';
// This fixture only modifies the isolated local database, never a remote binding.
const now = new Date().toISOString();
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/state', '--command',
  `INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, updated_at) VALUES ('after-dark-osu', 'rsvp', 10, 3, '${now}') ON CONFLICT(event_slug) DO UPDATE SET mode = 'rsvp', capacity = 10, max_party_size = 3;`], { stdio: 'inherit' });
