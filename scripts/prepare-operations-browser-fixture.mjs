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
const organizerToken=randomBytes(32).toString('base64url'), registrationToken=randomBytes(32).toString('base64url');
const email = 'operations-audit@example.com';
const start = new Date(Date.now() + 7 * 86400000).toISOString();
const end = new Date(Date.now() + 8 * 86400000).toISOString();
const sql = `
INSERT OR REPLACE INTO staff_accounts (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
VALUES ('rsvp-host','rsvp-host@example.com','RSVP Host','organizer','test','test',1,0,'active','${stamp}','${stamp}','fixture','${stamp}');
INSERT OR REPLACE INTO staff_sessions(id,account_id,token_hash,expires_at,created_at,last_seen_at) VALUES('rsvp-host-session','rsvp-host','${digest(organizerToken)}','${new Date(Date.now()+3600000).toISOString()}','${stamp}','${stamp}');
INSERT OR REPLACE INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,age_restriction,lineup,image_url,curation_note,status,created_at,updated_at,is_test_event,schedule_status,event_state)
VALUES('rsvp-browser','rsvp-browser','rsvp-browser','RSVP browser gathering','Test Venue','Accra','${start}','${end}','Night',10000,25,'18+','Test DJ','/events/the-weekend-braai.jpeg','A complete private browser fixture for RSVP registration.','published','${stamp}','${stamp}',0,'end_pending','on_sale');
INSERT OR REPLACE INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES('rsvp-host','rsvp-browser','operations-audit','${stamp}');
INSERT OR REPLACE INTO event_registration_settings(event_slug,mode,capacity,max_party_size,updated_at) VALUES('rsvp-browser','rsvp',25,2,'${stamp}');
INSERT OR REPLACE INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,announcements_opt_in,created_at,updated_at) VALUES('rsvp-browser-guest','rsvp-browser','rsvp-browser@example.com','Live RSVP Guest',1,'rsvp','unverified',1,'${stamp}','${stamp}');
INSERT OR REPLACE INTO registration_access_grants(id,registration_id,token_hash,expires_at,created_at) VALUES('rsvp-browser-grant','rsvp-browser-guest','${createHash('sha256').update(registrationToken).digest('hex')}','${new Date(Date.now()+3600000).toISOString()}','${stamp}');

INSERT OR REPLACE INTO party_submissions (id,organizer_name,contact_name,contact_email,contact_phone,title,concept,venue_name,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,age_restriction,status,created_at,updated_at)
VALUES ('operations-review','Audit Organiser','Audit Contact','review-audit@example.com','233000000000','Queue audit submission','A complete event pitch for local review.','Audit Venue','Accra','${start}','${end}','Late night','Audit DJ',20,10000,'18+','in_review','${stamp}','${stamp}');
INSERT OR REPLACE INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,age_restriction,lineup,image_url,curation_note,status,created_at,updated_at,is_test_event)
VALUES ('operations-remove','operations-remove','operations-remove','Obsolete audit preview','Audit Venue','Accra','${start}','${end}','Late night',0,20,'18+','Audit DJ','https://example.com/art.jpg','A disposable local event used to verify removal.','unpublished','${stamp}','${stamp}',1);

INSERT OR REPLACE INTO staff_accounts (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations, must_change_password, status, password_changed_at, created_at, created_by, updated_at)
VALUES ('operations-audit', '${email}', 'Operations Audit Owner', 'owner', 'client-pbkdf2-sha256-v1.${digest(proof)}', '${salt.toString('base64url')}', 600000, 0, 'active', '${stamp}', '${stamp}', 'isolated-browser-fixture', '${stamp}');
INSERT OR REPLACE INTO staff_sessions (id, account_id, token_hash, expires_at, created_at, last_seen_at) VALUES ('operations-audit-session', 'operations-audit', '${digest(token)}', '${new Date(Date.now()+3600000).toISOString()}', '${stamp}', '${stamp}');
UPDATE curated_event_records SET is_test_event = 0, starts_at = '${start}', ends_at = '${end}', status = 'published', schedule_status = 'confirmed', event_state = 'on_sale', sales_close_at = '${start}', sales_open_at = NULL WHERE slug = 'after-dark-osu';
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
writeFileSync('.wrangler/operations-fixture.json', JSON.stringify({ email, password, token, organizerToken, registrationToken }), { mode: 0o600 });
