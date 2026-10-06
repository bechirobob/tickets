import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createCustomerEmailHarness, previewData, previewNow, renderCustomerEmailPreviews } from '../scripts/customer-email-previews.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const actionLinks = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)].map(([, url, label]) => ({ url: url.replaceAll('&amp;', '&'), label: label.replace(/<[^>]*>/gu, '').trim() }));

test('all eight production customer paths produce branded HTML and usable plain text without outbound email', async () => {
  const previews = await renderCustomerEmailPreviews();
  assert.deepEqual(previews.map(item => item.name), ['purchase-confirmation', 'rsvp-confirmed', 'email-verification', 'ticket-recovery', 'ticket-transfer', 'waitlist-offer', 'abandoned-checkout', 'support-update']);
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

test('purchase confirmation includes truthful receipt, event timing, admissions and one-time access', async () => {
  const fixture = createCustomerEmailHarness();
  await fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin);
  const message = fixture.deliveries[0];
  const grant = fixture.grants[0].values;
  assert.equal(message.subject, `${previewData.event.title}: payment confirmed and tickets ready`);
  assert.equal(message.id, 'payment-confirmation/preview-order');
  assert.equal(message.idempotencyKey, `payment_confirmation/preview-order/${grant[0]}`);
  assert.equal(message.orderId, 'preview-order');
  assert.equal(message.recoveryGrantId, grant[0]);
  assert.equal(Date.parse(grant[3]) - Date.parse(previewNow), 7 * 24 * 60 * 60 * 1000);
  for (const content of ['BCT-PREVIEW-2401', 'Admissions: 2', 'Ticket subtotal: GH₵400.00', 'Booking fee: GH₵20.00', 'Total paid: GH₵420.00', '24 October 2026', 'The Courtyard', 'Osu, Accra', 'Accra time', 'QR', 'one-time']) assert.ok(message.text.includes(content), content);
  assert.match(message.html, /Ticket subtotal|Booking fee/u);
  assert.doesNotMatch(message.html, /data:image\/[a-z]+;base64|BCT:[A-Z0-9]{16}/u);
  const duplicate = await fixture.delivery.sendOrderConfirmation(fixture.db, fixture.data.order, fixture.data.origin);
  assert.equal(duplicate.duplicate, true);
  assert.equal(fixture.deliveries.length, 1);
  assert.equal(fixture.grants.length, 1, 'A repeat confirmation must not create another access grant.');
  assert.equal(fixture.networkCalls, 0);
});

test('complimentary and undated confirmations never describe a payment or invent an event date', async () => {
  const fixture = createCustomerEmailHarness({ event: { startsAt: null }, order: { paymentProvider: 'complimentary', faceAmountMinor: 0, bookingFeeMinor: 0, totalAmountMinor: 0 } });
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
  assert.match(message.html, /Guests confirmed/u);
  assert.match(message.html, /RSVP · No payment required/u);
  assert.ok(message.text.includes(`${data.origin}/my-nights/${data.registration.eventSlug}?view=passes`));
  for (const content of [data.event.venue, 'Accra time', '2']) assert.ok(message.text.includes(content), content);
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
    assert.doesNotMatch(message.html, /Guests confirmed|RSVP · No payment required|\?view=passes|See you on the guest list/u);
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
  assert.equal(transfer.text, `Kojo & Friends sent you a ticket for ${previewData.event.title}.\nSaturday, 24 October 2026 at 7:00 pm (Accra time)\nThe Courtyard, Osu, Accra\n\nAccept it: ${previewData.origin}/transfers/claim?token=synthetic-transfer\n\nThe private link expires in 48 hours.`);
  assert.match(transfer.html, /sender’s old QR stops working/u);
  const waitlist = byName['waitlist-offer'];
  assert.equal(waitlist.idempotencyKey, `waitlist/preview-waitlist/${previewData.expiresAt}`);
  assert.equal(waitlist.text, `${previewData.event.title}: Early Bird is available.\n\nTake the ticket before ${previewData.expiresAt}: ${previewData.origin}/waitlist/claim?token=synthetic-waitlist`);
  assert.match(waitlist.html, /Payment still has to complete/u);
  const checkout = byName['abandoned-checkout'];
  assert.equal(checkout.idempotencyKey, 'payment-recovery/preview-abandoned');
  assert.equal(checkout.orderId, 'preview-abandoned');
  assert.equal(checkout.text, `${previewData.event.title}: Paystack confirmed the checkout was abandoned. No ticket was issued. Start again: ${previewData.origin}/event/${previewData.order.eventSlug}`);
  const support = byName['support-update'];
  assert.equal(support.idempotencyKey, `support/preview-case/${hash(previewData.supportBody)}`);
  assert.equal(support.text, `${previewData.supportBody}\n\n${previewData.origin}/support/preview-case`);
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
