import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Render the production send paths, capturing the durable outbox before delivery.
// No provider credentials, fetch, real customer data or live database are used.
const root = fileURLToPath(new URL('../', import.meta.url));
export const previewNow = '2026-10-06T12:00:00.000Z';
export const previewData = {
  origin: 'https://tickets.example.invalid',
  // The public event identity and unchanged flyer belong together. Customer,
  // order, payment, transfer and support data below are fictional scenarios.
  event: { title: 'On The Guest List', venue: 'Asana Restaurant', area: 'Kempinski Gold Coast Hotel, Accra', startsAt: null, scheduleStatus: 'coming_soon', scheduleLabel: 'October · Coming soon', imageUrl: '/events/on-the-guest-list.webp', imageContentType: 'image/webp', publicArtwork: 1 },
  order: { id: 'preview-order', reference: 'BCT-PREVIEW-2401', eventSlug: 'sun-chasers-labadi', customerEmail: 'guest@example.invalid', customerName: 'Ama Mensah', faceAmountMinor: 40000, bookingFeeMinor: 2000, totalAmountMinor: 42000, currency: 'GHS', quantity: 2, paidAt: previewNow },
  registration: { id: 'preview-registration', eventSlug: 'sun-chasers-labadi', email: 'guest@example.invalid', guestName: 'Ama Mensah', phone: '', partySize: 2, kind: 'rsvp', status: 'confirmed', attendeeId: null, orderId: 'rsvp_preview-registration', version: 3, eventSignature: null },
  expiresAt: '2026-10-06T12:30:00.000Z',
  supportBody: 'Hi Ama,\n\nYour booking is confirmed for two guests. Open My Nights to see each pass before you leave for the venue.\n\nIf you need anything else, reply in the conversation and we’ll help.',
};

const compiledModules = new Map();
export function createCustomerEmailHarness(overrides = {}) {
  const data = { ...previewData, ...overrides, event: { ...previewData.event, ...overrides.event }, order: { ...previewData.order, ...overrides.order }, registration: { ...previewData.registration, ...overrides.registration } };
  const deliveries = [], calls = [], grants = [], confirmation = new Map();
  let notifiedVersion = 0, serial = 0, networkCalls = 0;
  const db = {
    prepare(sql) {
      const query = sql.replace(/\s+/gu, ' ').trim();
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          calls.push({ query, values: this.values });
          if (query.includes('FROM delivery_events') && query.includes('order_id = ?')) return deliveries.find(item => item.orderId === this.values[0]) ?? null;
          if (query.includes('FROM delivery_events') && query.includes('json_extract')) return deliveries.find(item => item.idempotencyKey === this.values[0]) ? { found: 1 } : null;
          if (query.includes('FROM registration_access_grants')) return { count: grants.filter(item => item.kind === 'registration').length };
          if (query.includes('FROM curated_event_records') && query.includes('event_registration_settings')) return { ...data.event, eventSlug: data.order.eventSlug, mode: 'rsvp', eventState: 'scheduled', publication: 'published', capacity: 100, maxPartySize: 4, approvalRequired: 0, roomAccess: 1, endsAt: null, ...overrides.settings };
          if (query.includes('FROM curated_event_records')) return data.event;
          if (query.includes('FROM confirmation_deliveries')) return { status: confirmation.get(this.values[0]) };
          throw new Error(`Unhandled preview read: ${query}`);
        },
        async all() {
          calls.push({ query, values: this.values });
          if (query.includes('FROM event_registrations')) return { results: notifiedVersion < data.registration.version ? [data.registration] : [] };
          throw new Error(`Unhandled preview list: ${query}`);
        },
        async run() {
          calls.push({ query, values: this.values });
          let changes = 1;
          if (query.startsWith('INSERT OR IGNORE INTO delivery_events')) {
            const [id, orderId, recoveryGrantId, kind, recipient, payload] = this.values;
            changes = Number(!deliveries.some(item => item.id === id));
            if (changes) deliveries.push({ id, orderId, recoveryGrantId, kind, recipient, ...JSON.parse(payload) });
          } else if (query.startsWith('INSERT INTO attendee_recovery_grants')) {
            grants.push({ kind: 'recovery', values: this.values });
          } else if (query.startsWith('INSERT INTO registration_access_grants')) {
            grants.push({ kind: 'registration', values: this.values });
          } else if (query.startsWith('INSERT OR IGNORE INTO confirmation_deliveries')) {
            if (!confirmation.has(this.values[0])) confirmation.set(this.values[0], 'pending');
          } else if (query.startsWith("UPDATE confirmation_deliveries SET status='processing'")) {
            changes = Number(confirmation.get(this.values[2]) === 'pending');
            if (changes) confirmation.set(this.values[2], 'processing');
          } else if (query.startsWith('UPDATE confirmation_deliveries SET status=?')) {
            confirmation.set(this.values[2], this.values[0]);
          } else if (query.startsWith('UPDATE event_registrations SET notified_version')) {
            notifiedVersion = this.values[0];
          } else if (!query.startsWith('UPDATE delivery_events')) {
            throw new Error(`Unhandled preview write: ${query}`);
          }
          return { meta: { changes }, success: true };
        },
      };
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
  const env = { DB: db }; // Deliberately no RESEND_API_KEY or EMAIL_FROM.
  const unavailable = () => { throw new Error('This dependency must not be called by an email preview.'); };
  const mocks = {
    'cloudflare:workers': { env },
    './organizer-team': { validTeamInvite: '' },
    './organizer-reports': { reportDeliveryAllowed: unavailable },
    './event-audience': { rememberEventContact: unavailable, notifyRegistrationHosts: unavailable },
    './policies': { recordPolicyConsents: unavailable },
    './notifications': { confirmationNotice: unavailable },
  };
  const cache = new Map();
  class PreviewDate extends Date {
    constructor(...args) { super(...(args.length ? args : [previewNow])); }
    static now() { return Date.parse(previewNow); }
  }
  const sandbox = {
    Date: PreviewDate, URL, Intl, TextEncoder, Uint8Array, btoa, console,
    crypto: {
      subtle: webcrypto.subtle,
      randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
      getRandomValues: bytes => bytes.fill(++serial),
    },
    fetch: () => { networkCalls += 1; throw new Error('Network access is forbidden in customer email previews.'); },
  };
  function load(name, directory = resolve(root, 'lib')) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.match(name, /^\.\//u, 'Only local production modules may load in the email harness.');
    const path = resolve(directory, `${name}.ts`);
    assert.ok(path.startsWith(`${resolve(root, 'lib')}/`));
    if (cache.has(path)) return cache.get(path).exports;
    if (!compiledModules.has(path)) compiledModules.set(path, transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code);
    const compiledModule = { exports: {} };
    cache.set(path, compiledModule);
    runInNewContext(compiledModules.get(path), { ...sandbox, module: compiledModule, exports: compiledModule.exports, require: dependency => load(dependency, dirname(path)) }, { filename: path });
    return compiledModule.exports;
  }
  return { data, db, env, deliveries, calls, grants, delivery: load('./email-delivery'), registrations: load('./registrations'), helpers: load('./customer-email'), get networkCalls() { return networkCalls; } };
}

export async function renderCustomerEmailPreviews(overrides = {}) {
  const fixture = createCustomerEmailHarness(overrides);
  const { data, db, env, delivery, registrations, deliveries } = fixture;
  const previews = [];
  async function capture(name, actionLabel, action) {
    const before = deliveries.length;
    await action();
    assert.equal(deliveries.length, before + 1, `${name} must capture exactly one real production delivery.`);
    previews.push({ name, actionLabel, ...deliveries.at(-1) });
  }
  await capture('purchase-confirmation', 'Open My Nights', () => delivery.sendOrderConfirmation(db, data.order, data.origin));
  await capture('rsvp-confirmed', 'View your passes', () => registrations.processRegistrations(env, data.origin, data.registration.id));
  await capture('email-verification', 'Confirm my email', () => registrations.sendRegistrationAccess(db, data.registration, data.event.title, data.origin));
  await capture('ticket-recovery', 'Open My Nights', () => delivery.issueRecoveryGrant({ db, normalizedEmail: data.order.customerEmail, origin: data.origin, kind: 'ticket_recovery' }));
  await capture('ticket-transfer', 'Accept my ticket', () => delivery.sendTicketTransferEmail({ db, transferId: 'preview-transfer', recipientEmail: data.order.customerEmail, recipientName: data.order.customerName, senderName: 'Kojo & Friends', eventTitle: data.event.title, eventDate: data.event.startsAt ? `${new Intl.DateTimeFormat('en-GH', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Accra' }).format(new Date(data.event.startsAt))} (Accra time)` : data.event.scheduleLabel || 'Date to be announced', venue: `${data.event.venue}, ${data.event.area}`, claimUrl: `${data.origin}/transfers/claim?token=synthetic-transfer` }));
  await capture('waitlist-offer', 'Take the ticket', () => delivery.sendWaitlistOfferEmail({ db, entryId: 'preview-waitlist', recipient: data.order.customerEmail, eventTitle: data.event.title, tierName: 'Early Bird', expiresAt: data.expiresAt, claimUrl: `${data.origin}/waitlist/claim?token=synthetic-waitlist` }));
  await capture('abandoned-checkout', 'Try the night again', () => delivery.sendAbandonedCheckoutEmail({ db, orderId: 'preview-abandoned', recipient: data.order.customerEmail, eventTitle: data.event.title, eventUrl: `${data.origin}/event/${data.order.eventSlug}` }));
  await capture('support-update', 'Open the conversation', () => delivery.sendSupportUpdateEmail({ db, caseId: 'preview-case', recipient: data.order.customerEmail, subject: 'Your booking question', body: data.supportBody, url: `${data.origin}/support/preview-case` }));
  assert.equal(fixture.networkCalls, 0, 'No preview may contact an email provider.');
  return previews;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = resolve(process.argv[2] ?? resolve(root, 'outputs/customer-emails'));
  const previews = await renderCustomerEmailPreviews();
  await mkdir(output, { recursive: true });
  for (const { name, html, text } of previews) {
    await writeFile(resolve(output, `${name}.html`), html);
    await writeFile(resolve(output, `${name}.txt`), text);
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ synthetic: true, outboundEmail: false, source: 'Production delivery payloads captured before provider dispatch; public event identity, fictional customer and transaction scenarios', previews: previews.map(({ name, subject, kind, actionLabel, idempotencyKey }) => ({ name, subject, kind, actionLabel, idempotencyKey })) }, null, 2));
  await writeFile(resolve(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer email previews</title><body style="font:16px system-ui;padding:24px"><h1>Customer email previews</h1><p>Exact production HTML with the public On The Guest List identity and flyer. Customer, payment and registration scenarios are fictional, not current event availability or prices. No emails sent; action links use inert preview addresses.</p><ul>${previews.map(({ name }) => `<li><a href="${name}.html">${name}</a> · <a href="${name}.txt">plain text</a></li>`).join('')}</ul></body></html>`);
  console.log(`Saved ${previews.length} synthetic customer email previews to ${output}. No email was sent.`);
}
