import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { createCustomerEmailHarness, previewData, previewNow, renderCustomerEmailPreviews } from '../scripts/customer-email-previews.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const actionLinks = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)].map(([, url, label]) => ({ url: url.replaceAll('&amp;', '&'), label: label.replace(/<[^>]*>/gu, '').trim() }));

test('all eight customer paths and both consent variants produce branded HTML and usable plain text without outbound email', async () => {
  const previews = await renderCustomerEmailPreviews();
  assert.deepEqual(previews.map(item => item.name), ['purchase-confirmation', 'rsvp-confirmed', 'email-verification', 'ticket-recovery', 'ticket-transfer', 'waitlist-offer', 'abandoned-checkout', 'support-update', 'purchase-announcement-verification', 'rsvp-announcement-verification']);
  assert.equal(new Set(previews.map(item => item.kind)).size, 8);
  for (const preview of previews) {
    assert.match(preview.html, /<!doctype html>/iu, preview.name);
    assert.match(preview.html, /<html[^>]*lang="en"/iu, preview.name);
    assert.match(preview.html, /name="viewport"/iu, preview.name);
    for (const color of ['#301d2c', '#f8f4ec', '#d6f075']) assert.ok(preview.html.includes(color), `${preview.name}: ${color}`);
    assert.match(preview.html, /role="presentation"/u, preview.name);
    assert.match(preview.html, /becore-ticket\.png\?v=5/u, preview.name);
    assert.match(preview.html, /<h1\b/u, preview.name);
    assert.match(preview.html, /mailto:tickets@becoreops\.com/u, preview.name);
    assert.doesNotMatch(preview.html, /<script\b|<iframe\b|onerror=|box-shadow:|text-shadow:/iu, preview.name);
    const action = actionLinks(preview.html).find(link => link.label === preview.actionLabel);
    assert.ok(action, `${preview.name} should retain its clear primary action.`);
    assert.equal(new URL(action.url).origin, previewData.origin);
    assert.ok(preview.text.includes(action.url), `${preview.name} plain text must carry the same action URL.`);
    assert.equal(preview.recipient, 'guest@example.invalid');
  }
});

test('token-bound disclosure is the only change to genuine verification and stays inside the approved body', async () => {
  const disclosure = 'Confirming this link also confirms the BeCore Tickets email updates you chose. You can unsubscribe at any time.';
  const paths = [
    { grantType: 'recovery', source: 'checkout', sourceId: previewData.order.id, send: fixture => fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin) },
    { grantType: 'registration', source: 'rsvp', sourceId: previewData.registration.id, send: fixture => fixture.registrations.sendRegistrationAccess(fixture.db, fixture.data.registration, fixture.data.event.title, fixture.data.origin) },
    { grantType: 'recovery', explicit: true, source: 'checkout', sourceId: '', send: fixture => fixture.delivery.issueRecoveryGrant({ db: fixture.db, normalizedEmail: fixture.data.order.customerEmail, origin: fixture.data.origin, kind: 'ticket_recovery', confirmPlatformAnnouncements: true }) },
    { grantType: 'registration', explicit: true, source: 'rsvp', sourceId: '', send: fixture => fixture.registrations.sendRegistrationAccess(fixture.db, fixture.data.registration, fixture.data.event.title, fixture.data.origin, true) },
  ];
  for (const path of paths) {
    const ordinary = createCustomerEmailHarness({ registration: { status: 'unverified' } });
    const optedIn = createCustomerEmailHarness({ registration: { status: 'unverified' }, platformAnnouncementsOptIn: true });
    await path.send(ordinary);
    await path.send(optedIn);
    const original = ordinary.deliveries[0], message = optedIn.deliveries[0];
    const paragraph = optedIn.helpers.emailParagraph(disclosure);
    assert.equal(message.html.split(disclosure).length - 1, 1);
    assert.equal(message.text.split(disclosure).length - 1, 1);
    assert.equal(message.html.replace(paragraph, ''), original.html, 'Consent must not alter the approved email identity or access action.');
    assert.equal(message.text.replace(`\n\n${disclosure}`, ''), original.text);
    assert.ok(message.html.indexOf(disclosure) < message.html.indexOf('<a href='), 'Disclosure must precede the primary access action inside the body.');
    assert.match(message.html, /<\/body><\/html>$/u, 'No disclosure may be appended after the complete HTML shell.');
    assert.equal(ordinary.verifications.length, 0);
    assert.equal(optedIn.verifications.length, 1);
    const { values } = optedIn.verifications[0];
    assert.equal(values[0], path.grantType);
    assert.equal(values[2], previewData.order.customerEmail);
    assert.equal(values[3], optedIn.grants[0].values[0]);
    assert.equal(values[5], Number(path.explicit === true));
    assert.equal(values[6], path.source);
    assert.equal(values[7], path.sourceId);
    assert.equal(ordinary.networkCalls + optedIn.networkCalls, 0);
  }
});

test('proof for an already saved RSVP is optional updates confirmation, never a booking prerequisite', async () => {
  for (const status of ['confirmed', 'waitlisted', 'requested', 'cancelled', 'declined']) {
    const fixture = createCustomerEmailHarness({ registration: { status }, platformAnnouncementsOptIn: true });
    await fixture.registrations.sendRegistrationAccess(fixture.db, fixture.data.registration, fixture.data.event.title, fixture.data.origin);
    const message = fixture.deliveries[0];
    assert.equal(message.subject, 'Confirm your BeCore Tickets email updates');
    for (const body of [message.html, message.text]) {
      assert.ok(body.includes('Your RSVP is already saved.'));
      assert.ok(body.includes('Email updates are optional and aren’t needed for your RSVP.'));
      assert.ok(body.includes('You can unsubscribe at any time.'));
      assert.ok(body.includes('expires in 20 minutes'));
      assert.equal(body.split('Confirm the BeCore Tickets email updates you chose.').length - 1, 1);
      assert.doesNotMatch(body, /continue your registration|place is only reserved|also confirms/u);
    }
    const url = actionLinks(message.html).find(link => link.label === 'Confirm my email').url;
    const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
    assert.equal(new URL(url).pathname, '/rsvp/access');
    assert.equal(fixture.grants[0].values[2], hash(token));
    assert.equal(message.idempotencyKey, `registration-access/${hash(token)}`);
    assert.equal(fixture.verifications.length, 1);
    assert.equal(fixture.networkCalls, 0);
  }
});

test('genuine RSVP and interest verification retain the original subject and full approved HTML', async () => {
  for (const kind of ['rsvp', 'interest']) {
    const fixture = createCustomerEmailHarness({ registration: { kind, status: 'unverified' } });
    await fixture.registrations.sendRegistrationAccess(fixture.db, fixture.data.registration, fixture.data.event.title, fixture.data.origin);
    const message = fixture.deliveries[0];
    const url = actionLinks(message.html).find(link => link.label === 'Confirm my email').url;
    const { customerEmail, emailParagraph, emailGreeting, emailEvent } = fixture.helpers;
    assert.equal(message.subject, `Confirm your email · ${fixture.data.event.title}`);
    assert.equal(message.html, customerEmail({
      title: 'One quick check.',
      preheader: `Confirm your email to continue with ${fixture.data.event.title}.`,
      body: emailParagraph(`${emailGreeting(fixture.data.registration.guestName)} Confirm this is your email to continue your registration. One tap, then back to the plan.`) + emailEvent({ title: fixture.data.event.title }),
      action: { label: 'Confirm my email', url },
      note: 'This private link expires in 20 minutes. A place is only reserved after your RSVP is confirmed. If you did not request this, you can ignore it.',
    }));
    assert.equal(message.text, `Hi ${fixture.data.registration.guestName},\n\nConfirm your email to view your registration for ${fixture.data.event.title}. One tap, then back to the plan:\n${url}\n\nThis link expires in 20 minutes. A place is only reserved after your RSVP is confirmed. If you did not request this, you can ignore it.`);
    assert.doesNotMatch(message.html + message.text, /Your RSVP is already saved|This is optional/u);
  }
});

test('ordinary recovery never binds or discloses announcement consent without a source or explicit preference', async () => {
  const fixture = createCustomerEmailHarness({ platformAnnouncementsOptIn: true });
  await fixture.delivery.issueRecoveryGrant({ db: fixture.db, normalizedEmail: fixture.data.order.customerEmail, origin: fixture.data.origin, kind: 'ticket_recovery' });
  assert.equal(fixture.verifications.length, 0);
  assert.equal(fixture.calls.some(({ query }) => query.startsWith('INSERT INTO platform_announcement_verifications')), false);
  assert.doesNotMatch(fixture.deliveries[0].html + fixture.deliveries[0].text, /also confirms the BeCore Tickets email updates/u);
});

test('purchase confirmation includes truthful receipt, event timing, admissions and one-time access', async () => {
  const fixture = createCustomerEmailHarness({ event: { startsAt: '2026-10-24T19:00:00.000Z', scheduleStatus: 'confirmed', imageUrl: null } });
  await fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin);
  const message = fixture.deliveries[0];
  const grant = fixture.grants[0].values;
  assert.equal(message.subject, `${previewData.event.title}: payment confirmed and tickets ready`);
  assert.equal(message.id, 'payment-confirmation/preview-order');
  assert.equal(message.idempotencyKey, `payment_confirmation/preview-order/${grant[0]}`);
  assert.equal(message.orderId, 'preview-order');
  assert.equal(message.recoveryGrantId, grant[0]);
  assert.equal(Date.parse(grant[3]) - Date.parse(previewNow), 7 * 24 * 60 * 60 * 1000);
  for (const content of ['BCT-PREVIEW-2401', 'Admissions: 2', 'Ticket subtotal: GH₵400.00', 'Booking fee: GH₵20.00', 'Total paid: GH₵420.00', '24 October 2026', previewData.event.venue, previewData.event.area, 'Accra time', 'QR', 'one-time']) assert.ok(message.text.includes(content), content);
  assert.match(message.html, /Ticket subtotal|Booking fee/u);
  assert.doesNotMatch(message.html, /data:image\/[a-z]+;base64|BCT:[A-Z0-9]{16}/u);
  const duplicate = await fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin);
  assert.equal(duplicate.duplicate, true);
  assert.equal(fixture.deliveries.length, 1);
  assert.equal(fixture.grants.length, 1, 'A repeat confirmation must not create another access grant.');
  assert.equal(fixture.networkCalls, 0);
});

test('complimentary and undated confirmations never describe a payment or invent an event date', async () => {
  const fixture = createCustomerEmailHarness({ event: { startsAt: null, scheduleLabel: null }, order: { paymentProvider: 'complimentary', faceAmountMinor: 0, bookingFeeMinor: 0, totalAmountMinor: 0 } });
  await fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin);
  const message = fixture.deliveries[0];
  assert.match(message.subject, /complimentary passes/u);
  assert.match(message.html, /Date to be announced/u);
  assert.match(message.text, /Date to be announced/u);
  assert.match(message.text, /Complimentary total:/u);
  assert.doesNotMatch(message.html + message.text, /Total paid|Payment confirmed/u);
});

test('RSVP confirmation retains its delivery key and gives passes, date, venue and party size', async () => {
  const fixture = createCustomerEmailHarness();
  const { registrations, db, env, data } = fixture;
  await registrations.processRegistrations(env, data.origin, data.registration.id);
  const message = fixture.deliveries[0];
  assert.equal(message.subject, `${data.event.title} · RSVP confirmed`);
  assert.equal(message.idempotencyKey, 'registration-update/preview-registration/3');
  assert.match(message.html, /We’ve confirmed 2 places for you\. No payment required\./u);
  assert.ok(message.text.includes(`${data.origin}/my-nights/${data.registration.eventSlug}?view=passes`));
  for (const content of [data.event.venue, data.event.scheduleLabel, '2 places', 'No payment required']) assert.ok(message.text.includes(content), content);
  await registrations.processRegistrations(env, data.origin, data.registration.id);
  assert.equal(fixture.deliveries.length, 1);
  assert.ok(fixture.calls.some(call => call.query.startsWith('UPDATE event_registrations SET notified_version')));
  assert.equal(db, env.DB);
});

for (const status of ['waitlisted', 'cancelled', 'declined']) {
  test(`RSVP ${status} updates do not imply confirmed admission`, async () => {
    const fixture = createCustomerEmailHarness({ registration: { status } });
    await fixture.registrations.processRegistrations(fixture.env, fixture.data.origin, fixture.data.registration.id);
    const message = fixture.deliveries[0];
    assert.equal(message.subject, `${previewData.event.title} · Registration update`);
    const state = { waitlisted: 'You’re on the waitlist.', cancelled: 'Your RSVP is cancelled.', declined: 'The host couldn’t fit you in this time.' }[status];
    assert.ok(message.html.includes(state), `${status} must remain explicit.`);
    assert.doesNotMatch(message.html, /Guests confirmed|places for you|No payment required|\?view=passes|See you on the guest list/u);
    assert.ok(message.text.includes(`${previewData.origin}/event/${previewData.registration.eventSlug}`));
  });
}

test('verification keeps its expiring fragment token, grant hash, throttle and pre-confirmation warning', async () => {
  const fixture = createCustomerEmailHarness();
  const send = () => fixture.registrations.sendRegistrationAccess(fixture.db, fixture.data.registration, fixture.data.event.title, fixture.data.origin);
  await send();
  const message = fixture.deliveries[0];
  const url = actionLinks(message.html).find(link => link.label === 'Confirm my email').url;
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  assert.equal(new URL(url).pathname, '/rsvp/access');
  assert.equal(new URL(url).search, '');
  assert.ok(token);
  assert.equal(message.idempotencyKey, `registration-access/${hash(token)}`);
  assert.equal(fixture.grants[0].values[2], hash(token));
  assert.equal(Date.parse(fixture.grants[0].values[3]) - Date.parse(previewNow), 20 * 60 * 1000);
  assert.match(message.html, /place is only reserved after your RSVP is confirmed/u);
  assert.match(message.text, /expires in 20 minutes/u);
  await send(); await send(); await send();
  assert.equal(fixture.deliveries.length, 3, 'The existing three-grant throttle must still apply.');
});

test('recovery, transfers, waitlist, checkout and support preserve their existing delivery semantics', async () => {
  const previews = await renderCustomerEmailPreviews();
  const byName = Object.fromEntries(previews.map(item => [item.name, item]));
  const recovery = byName['ticket-recovery'];
  assert.equal(recovery.subject, 'Your Nights are ready to come back');
  assert.equal(recovery.idempotencyKey, `ticket_recovery/${recovery.recoveryGrantId}/${recovery.recoveryGrantId}`);
  assert.match(recovery.text, /one-time/u);
  assert.doesNotMatch(recovery.html, /Booking reference|Total paid/u);
  const transfer = byName['ticket-transfer'];
  assert.equal(transfer.idempotencyKey, 'ticket-transfer/preview-transfer');
  assert.equal(transfer.recoveryGrantId, 'preview-transfer');
  for (const content of ['Kojo & Friends', previewData.event.title, previewData.event.scheduleLabel, previewData.event.venue, previewData.event.area, '48 hours', `${previewData.origin}/transfers/claim?token=synthetic-transfer`]) assert.ok(transfer.text.includes(content), content);
  assert.match(transfer.html, /sender’s QR stops working only after you accept/u);
  const waitlist = byName['waitlist-offer'];
  assert.equal(waitlist.idempotencyKey, `waitlist/preview-waitlist/${previewData.expiresAt}`);
  for (const content of [previewData.event.title, 'Early Bird', previewData.expiresAt, `${previewData.origin}/waitlist/claim?token=synthetic-waitlist`]) assert.ok(waitlist.text.includes(content), content);
  assert.match(waitlist.html, /[Pp]ayment|[Pp]ay /u);
  const checkout = byName['abandoned-checkout'];
  assert.equal(checkout.idempotencyKey, 'payment-recovery/preview-abandoned');
  assert.equal(checkout.orderId, 'preview-abandoned');
  for (const content of [previewData.event.title, 'Paystack', 'abandoned', 'No ticket was issued', `${previewData.origin}/event/${previewData.order.eventSlug}`]) assert.ok(checkout.text.includes(content), content);
  const support = byName['support-update'];
  assert.equal(support.idempotencyKey, `support/preview-case/${hash(previewData.supportBody)}`);
  assert.ok(support.text.includes(previewData.supportBody));
  assert.ok(support.text.includes(`${previewData.origin}/support/preview-case`));
  assert.match(support.html, /Hi Ama,<br><br>Your booking/u);
});

test('untrusted event, customer, receipt and support fields cannot become HTML', async () => {
  const attack = '<img src=x onerror="alert(1)"> & \'test\'';
  const previews = await renderCustomerEmailPreviews({ event: { title: attack, venue: attack, area: attack }, order: { customerName: attack, reference: attack }, registration: { guestName: attack }, supportBody: attack });
  for (const preview of previews) {
    assert.doesNotMatch(preview.html, /<img src=x|<script\b/iu, preview.name);
    if (preview.name !== 'ticket-recovery') assert.ok(preview.html.includes(escape(attack)), preview.name);
  }
});

test('shared shell escapes fields and preserves only explicitly trusted body markup', () => {
  const { helpers } = createCustomerEmailHarness();
  const attack = '<script>alert("x")</script> & \'test\'';
  const body = helpers.emailParagraph('<strong>Trusted emphasis</strong>') + helpers.emailEvent({ title: attack, when: attack, venue: attack }) + helpers.emailDetails([{ label: attack, value: attack }]);
  const html = helpers.customerEmail({ title: attack, preheader: attack, body, action: { label: attack, url: 'https://tickets.example.invalid/my-nights?a=1&b=2' }, note: attack });
  assert.doesNotMatch(html, /<script\b/iu);
  assert.match(html, /<strong>Trusted emphasis<\/strong>/u);
  assert.ok(html.includes(escape(attack)));
  assert.match(html, /href="https:\/\/tickets\.example\.invalid\/my-nights\?a=1&amp;b=2"/u);
});

test('unsafe primary URLs fail closed before an email is queued', async () => {
  const fixture = createCustomerEmailHarness();
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'mailto:guest@example.invalid', 'ftp://example.invalid/file', '//example.invalid/path', '/my-nights', 'https://user:password@example.invalid/', 'https://example.invalid/\nunsafe', 'not a URL']) {
    assert.throws(() => fixture.helpers.customerEmail({ title: 'Test', preheader: 'Test', body: '', action: { label: 'Open', url } }), undefined, url);
    await assert.rejects(fixture.delivery.sendSupportUpdateEmail({ db: fixture.db, caseId: 'preview-unsafe', recipient: 'guest@example.invalid', subject: 'Test', body: 'Test', url }), undefined, url);
  }
  for (const url of ['https://tickets.example.invalid/my-nights#token=synthetic', 'http://localhost:8788/my-nights']) assert.ok(fixture.helpers.customerEmail({ title: 'Test', preheader: 'Test', body: '', action: { label: 'Open', url } }).includes(url));
  assert.equal(fixture.deliveries.length, 0);
  assert.equal(fixture.networkCalls, 0);
});

test('public email flyers allow only canonical JPEG/PNG artwork and the verified Guest List derivative', () => {
  const { helpers } = createCustomerEmailHarness();
  const title = 'On The Guest List';
  for (const url of ['/events/on-the-guest-list.webp', 'https://tickets.becoreops.com/events/on-the-guest-list.webp']) {
    const html = helpers.emailFlyer({ url, title, isPublic: true });
    assert.match(html, /src="https:\/\/tickets\.becoreops\.com\/events\/on-the-guest-list-email\.jpg"/u);
    assert.match(html, /alt="[^"]*On The Guest List[^"]*"/u);
    assert.match(html, /height:auto/u, 'The full original artwork must retain its aspect ratio.');
    assert.doesNotMatch(html, /object-fit:cover|background-image/u);
  }
  for (const suffix of ['jpg', 'jpeg', 'png']) {
    assert.match(helpers.emailFlyer({ url: `/events/preview.${suffix}`, title, isPublic: true }), /<img\b/u);
  }
  for (const contentType of ['image/jpeg', 'image/png']) {
    assert.match(helpers.emailFlyer({ url: '/api/media/preview-poster', title, isPublic: true, contentType }), /<img\b/u);
  }
});

test('private, absent, unsupported or untrusted artwork is omitted without leaking a URL', () => {
  const { helpers } = createCustomerEmailHarness();
  const input = { title: 'On The Guest List', isPublic: true };
  for (const url of [null, undefined, '', '/events/unknown.webp', '/events/preview.svg', '/events/preview.gif', '/fallbacks/event.jpg', '/events/../private.jpg', '//external.example.invalid/preview.jpg', 'http://tickets.becoreops.com/events/preview.jpg', 'https://external.example.invalid/events/preview.jpg', 'https://tickets.becoreops.com.evil.example.invalid/events/preview.jpg', 'https://user:password@tickets.becoreops.com/events/preview.jpg', '/events/preview.jpg?token=private', '/events/preview.jpg#private', '/events/preview.jpg\n', 'data:image/jpeg;base64,dGVzdA==', 'javascript:alert(1)']) {
    assert.equal(helpers.emailFlyer({ ...input, url }), '', String(url));
  }
  assert.equal(helpers.emailFlyer({ ...input, url: '/events/on-the-guest-list.webp', isPublic: false }), '');
  for (const contentType of [null, undefined, 'image/webp', 'image/svg+xml', 'text/html']) {
    assert.equal(helpers.emailFlyer({ ...input, url: '/api/media/preview-poster', contentType }), '', String(contentType));
  }
});

test('flyer alt text cannot inject markup or attributes', () => {
  const { helpers } = createCustomerEmailHarness();
  const html = helpers.emailFlyer({ url: '/events/on-the-guest-list.webp', title: '" onerror="alert(1)<script>x</script>', isPublic: true });
  assert.match(html, /&quot;/u);
  assert.doesNotMatch(html, /" onerror=|<script>/u);
});

test('the email JPEG retains the full original public flyer without cropping or redesign', async () => {
  const source = await sharp(new URL('../public/events/on-the-guest-list.webp', import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = sharp(new URL('../public/events/on-the-guest-list-email.jpg', import.meta.url).pathname);
  assert.equal((await image.metadata()).format, 'jpeg');
  const derivative = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(derivative.info.width, source.info.width);
  assert.equal(derivative.info.height, source.info.height);
  assert.equal(derivative.data.length, source.data.length);
  const difference = derivative.data.reduce((sum, channel, index) => sum + Math.abs(channel - source.data[index]), 0) / source.data.length;
  assert.ok(difference < 10, `JPEG conversion must preserve the original artwork (mean channel difference ${difference}).`);
});

test('purchase and RSVP deliveries include only public artwork and retain all text when artwork is unavailable', async () => {
  const previews = await renderCustomerEmailPreviews();
  for (const name of ['purchase-confirmation', 'rsvp-confirmed']) {
    const preview = previews.find(item => item.name === name);
    assert.match(preview.html, /on-the-guest-list-email\.jpg/u, name);
    assert.ok(preview.text.includes(previewData.event.title));
  }
  for (const event of [{ imageUrl: null }, { publicArtwork: 0 }, { imageUrl: '/events/unknown.webp' }, { imageUrl: 'https://external.example.invalid/events/poster.jpg' }]) {
    const previews = await renderCustomerEmailPreviews({ event });
    for (const name of ['purchase-confirmation', 'rsvp-confirmed']) {
      const preview = previews.find(item => item.name === name);
      assert.doesNotMatch(preview.html, /<img\b[^>]*src="[^"]*(?:\/events\/|\/api\/media\/)/u, name);
      assert.ok(preview.html.includes(previewData.event.title));
      assert.ok(preview.text.includes(previewData.event.venue));
    }
  }
  const fixture = createCustomerEmailHarness();
  await fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin);
  await fixture.registrations.processRegistrations(fixture.env, fixture.data.origin, fixture.data.registration.id);
  const reads = fixture.calls.filter(({ query }) => query.includes('AS publicArtwork'));
  assert.equal(reads.length, 2);
  for (const { query, values } of reads) {
    assert.match(query, /removed_at IS NULL/u);
    assert.match(query, /is_test_event\s*=\s*0/u);
    assert.match(query, /status\s*=\s*'published'/u);
    assert.match(query, /scheduled_publish_at\s*<=\s*\?/u);
    assert.ok(values.includes(previewNow));
    assert.ok(values.includes(previewData.order.eventSlug));
  }
});

test('short customer emails retain useful information without placeholders or empty names', async () => {
  const previews = await renderCustomerEmailPreviews({ order: { customerName: '   ' }, registration: { guestName: '   ' } });
  for (const { name, html, text } of previews) {
    const visible = html.replace(/<head>[\s\S]*?<\/head>/iu, '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
    assert.doesNotMatch(visible, /\{[^}]+\}|Hi\s*,|Hi\s+(?:undefined|null),/u, name);
    assert.doesNotMatch(text, /\{[^}]+\}|Hi\s*,|Hi\s+(?:undefined|null),/u, `${name}: plain text`);
    assert.ok(visible.split(' ').length <= 240, `${name} should stay concise.`);
    if (['purchase-confirmation', 'rsvp-confirmed', 'email-verification', 'ticket-recovery', 'ticket-transfer'].includes(name)) assert.match(visible, /Hi there,/u, name);
  }
});

test('missing customer names use a neutral greeting and supplied names remain escaped', () => {
  const { helpers } = createCustomerEmailHarness();
  for (const name of [null, undefined, '', '   ']) assert.equal(helpers.emailGreeting(name), 'Hi there,<br>');
  assert.equal(helpers.emailGreeting('  Ama Mensah  '), 'Hi Ama Mensah,<br>');
  assert.equal(helpers.emailGreeting('<img src=x>'), 'Hi &lt;img src=x&gt;,<br>');
});

test('host attribution preserves the recorded host or co-host role without inventing another identity', () => {
  const { helpers } = createCustomerEmailHarness();
  assert.equal(helpers.emailHostLine({ name: '  Kofi Bills  ', role: 'Host' }), 'Kofi Bills is your host.');
  for (const role of ['Co-host', 'Co host', 'Cohost']) assert.equal(helpers.emailHostLine({ name: 'Kofi Bills', role }), 'Kofi Bills is your co-host.');
  for (const host of [null, undefined, { name: '', role: 'Host' }, { name: '   ', role: 'Host' }, ...['', ' ', 'DJ', 'Special Guest DJ', 'Guest', 'Staff', 'Organiser', 'Host / DJ'].map(role => ({ name: 'Kofi Bills', role }))]) {
    assert.equal(helpers.emailHostLine(host), '', JSON.stringify(host));
  }
});

test('public purchase and confirmed RSVP emails open with the real host in HTML and plain text', async () => {
  const fixture = createCustomerEmailHarness();
  await fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin);
  await fixture.registrations.processRegistrations(fixture.env, fixture.data.origin, fixture.data.registration.id);
  assert.equal(fixture.deliveries.length, 2);
  for (const message of fixture.deliveries) {
    assert.ok(message.html.includes('Kofi Bills is your host.'));
    assert.ok(message.text.includes('Kofi Bills is your host.'));
    assert.ok(message.html.indexOf('Kofi Bills is your host.') < message.html.indexOf('on-the-guest-list-email.jpg'), 'Host introduction belongs before the event flyer.');
    assert.doesNotMatch(message.html + message.text, /I(?:’|')m Kofi|I(?:’|')ll see you|Yours,\s*Kofi|(?:—|–)\s*Kofi Bills/u);
    assert.ok(message.text.includes(fixture.data.origin));
  }
  const hostReads = fixture.calls.filter(({ query }) => query.includes('FROM event_hosts'));
  assert.equal(hostReads.length, 2);
  for (const { query, values } of hostReads) {
    assert.match(query, /JOIN hosts/u);
    assert.match(query, /ORDER BY link\.is_primary DESC, host\.name/u);
    assert.deepEqual(values, [previewData.order.eventSlug]);
  }
  assert.equal(fixture.networkCalls, 0);
});

test('missing, blank and non-host primary identities are omitted while co-host attribution stays accurate', async () => {
  for (const host of [null, { ...previewData.host, name: '   ' }, { ...previewData.host, role: '' }, { ...previewData.host, role: 'Special Guest DJ' }, { ...previewData.host, role: 'Staff' }, { ...previewData.host, role: 'Co-host' }]) {
    const previews = await renderCustomerEmailPreviews({ host });
    for (const name of ['purchase-confirmation', 'rsvp-confirmed']) {
      const message = previews.find(item => item.name === name);
      if (host?.role === 'Co-host') {
        assert.ok(message.html.includes('Kofi Bills is your co-host.'));
        assert.ok(message.text.includes('Kofi Bills is your co-host.'));
        assert.doesNotMatch(message.html + message.text, /Kofi Bills is your host\./u);
      } else {
        assert.doesNotMatch(message.html + message.text, /Kofi Bills is your|is your (?:co-)?host\.|undefined|null/u);
      }
      assert.ok(message.text.includes(previewData.event.title));
    }
  }
});

test('host names are escaped at the HTML boundary while plain text keeps the literal public name', async () => {
  const name = 'Kofi <img src=x onerror="alert(1)"> & Friends';
  const previews = await renderCustomerEmailPreviews({ host: { ...previewData.host, name } });
  for (const scenario of ['purchase-confirmation', 'rsvp-confirmed']) {
    const message = previews.find(item => item.name === scenario);
    assert.ok(message.html.includes(`${escape(name)} is your host.`));
    assert.doesNotMatch(message.html, /<img src=x/u);
    assert.ok(message.text.includes(`${name} is your host.`));
  }
});

test('private confirmations, unconfirmed RSVP and recovery never look up or disclose a host', async () => {
  const fixtures = [];
  const privateFixture = createCustomerEmailHarness({ event: { publicArtwork: 0 } });
  await privateFixture.delivery.sendOrderConfirmation(privateFixture.db, privateFixture.data.order, privateFixture.data.origin);
  await privateFixture.registrations.processRegistrations(privateFixture.env, privateFixture.data.origin, privateFixture.data.registration.id);
  fixtures.push(privateFixture);
  for (const status of ['waitlisted', 'cancelled', 'declined', 'interested']) {
    const fixture = createCustomerEmailHarness({ registration: { status, ...(status === 'interested' ? { kind: 'interest' } : {}) } });
    await fixture.registrations.processRegistrations(fixture.env, fixture.data.origin, fixture.data.registration.id);
    fixtures.push(fixture);
  }
  const access = createCustomerEmailHarness();
  await access.registrations.sendRegistrationAccess(access.db, access.data.registration, access.data.event.title, access.data.origin);
  for (const order of [undefined, access.data.order]) {
    await access.delivery.issueRecoveryGrant({ db: access.db, normalizedEmail: access.data.order.customerEmail, origin: access.data.origin, kind: 'ticket_recovery', order });
  }
  fixtures.push(access);
  for (const fixture of fixtures) {
    assert.equal(fixture.calls.filter(({ query }) => query.includes('FROM event_hosts')).length, 0);
    assert.ok(fixture.deliveries.length > 0);
    for (const message of fixture.deliveries) assert.doesNotMatch(message.html + message.text, /Kofi Bills|is your (?:co-)?host\./u);
  }
});
