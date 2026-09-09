import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, pbkdf2Sync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
// No remote option: all identities and bookings are isolated in local D1.
const stamp = new Date().toISOString();
const password = `Audit9!${randomBytes(20).toString('hex')}`;
const salt = randomBytes(16);
const proof = pbkdf2Sync(password, salt, 600000, 32, 'sha256');
const token = randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('base64url');
const email = 'operations-audit@example.com';
const start = new Date(Date.now() + 7 * 86400000).toISOString();
const end = new Date(Date.now() + 8 * 86400000).toISOString();
const sql = `
INSERT OR REPLACE INTO staff_accounts (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations, must_change_password, status, password_changed_at, created_at, created_by, updated_at)
VALUES ('operations-audit', '${email}', 'Operations Audit Owner', 'owner', 'client-pbkdf2-sha256-v1.${digest(proof)}', '${salt.toString('base64url')}', 600000, 0, 'active', '${stamp}', '${stamp}', 'isolated-browser-fixture', '${stamp}');
INSERT OR REPLACE INTO staff_sessions (id, account_id, token_hash, expires_at, created_at, last_seen_at) VALUES ('operations-audit-session', 'operations-audit', '${digest(token)}', '${new Date(Date.now()+3600000).toISOString()}', '${stamp}', '${stamp}');
UPDATE curated_event_records SET starts_at = '${start}', ends_at = '${end}', status = 'published', schedule_status = 'confirmed', event_state = 'on_sale', sales_close_at = '${start}', sales_open_at = NULL WHERE slug = 'after-dark-osu';
UPDATE event_ticket_tiers SET status = 'available', sales_open_at = NULL, sales_close_at = '${start}' WHERE event_slug = 'after-dark-osu';
INSERT OR REPLACE INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, payment_provider, status, created_at, paid_at)
VALUES ('operations-rsvp', 'BCT-AUDIT-RSVP', 'after-dark-osu', 'rsvp', 1, 0, 0, 0, 'GHS', 'rsvp-audit@example.com', '233000000000', 'rsvp', 'rsvp', 'paid', '${stamp}', '${stamp}');
INSERT OR REPLACE INTO attendee_profiles (id, normalized_email, display_name, status, created_at, updated_at) VALUES ('operations-guest', 'support-audit@example.com', 'Audit Guest', 'active', '${stamp}', '${stamp}');
INSERT OR REPLACE INTO support_cases (id, attendee_id, event_slug, order_id, kind, subject, status, created_at, updated_at) VALUES ('operations-support', 'operations-guest', 'after-dark-osu', 'operations-rsvp', 'general', 'Need help with my RSVP', 'waiting_support', '${stamp}', '${stamp}');
INSERT OR REPLACE INTO support_messages (id, case_id, author_type, author_id, body, created_at) VALUES ('operations-support-message', 'operations-support', 'attendee', 'operations-guest', 'Where can I find my guest pass?', '${stamp}');
`;
mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/operations-fixture.sql', sql, { mode: 0o600 });
execFileSync('npx', ['wrangler','d1','execute','DB','--local','--persist-to','.wrangler/state','--file','.wrangler/operations-fixture.sql'], { stdio: 'inherit' });
writeFileSync('.wrangler/operations-fixture.json', JSON.stringify({ email, password, token }), { mode: 0o600 });
