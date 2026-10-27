import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('owner prompt and settings use shared account identity in both existing workspaces',()=>{
 assert.match(read('app/admin/page.tsx'),/accountId=\{session.accountId\}/u);
 assert.match(read('app/admin/curation-desk.tsx'),/role === "owner" && accountId \? <HostRsvpAlerts accountId=\{accountId\} owner mode="prompt"/u);
 assert.match(read('app/admin/operations/page.tsx'),/accountId=\{session.accountId\}/u);
 assert.match(read('app/admin/operations/event-operations-hub.tsx'),/role === "owner" && accountId \? <HostRsvpAlerts accountId=\{accountId\} owner mode="prompt"/u);
 assert.match(read('app/admin/account/page.tsx'),/session.role === "owner" && !session.mustChangePassword \? <HostRsvpAlerts accountId=\{session.accountId\} owner/u);
 const suite=read('app/organizer/workspace/organizer-suite.tsx');
 assert.equal((suite.match(/<HostRsvpAlerts owner=\{role==='owner'\} accountId=\{accountId\}/gu)||[]).length,2);
 assert.match(suite,/\(role==='organizer'\|\|role==='owner'\)&&accountId/u);
 assert.match(read('app/organizer/workspace/host-rsvp-alerts.tsx'),/bct:host-notifications:choice:v1:\$\{accountId\}/u);
 assert.match(read('styles/workspace.css'),/host-rsvp-alerts.css/u);
});

test("primary notification action retains explicit hover contrast",()=>{
 assert.match(read("app/organizer/workspace/host-rsvp-alerts.css"),/\.host-notification-prompt button:first-of-type:hover\{background:#3b2942;color:#fff\}/u);
});

function serviceWorkerHarness(windows = []) {
 const handlers = {}, shown = [], opened = [];
 const self = {
  location: { origin: 'https://tickets.becoreops.com' },
  addEventListener: (name, handler) => { handlers[name] = handler; },
  registration: { showNotification: async (title, options) => { shown.push({ title, ...options }); } },
  clients: {
   matchAll: async () => windows,
   openWindow: async target => { opened.push(target); },
  },
 };
 runInNewContext(read('public/sw.js'), { self, URL });
 return {
  shown, opened,
  async push(data) {
   let pending; handlers.push({ data: { json: () => data }, waitUntil: promise => { pending = promise; } });
   await pending;
  },
  async click(data, action = 'open') {
   let pending; handlers.notificationclick({ notification: { data, close() {} }, action, waitUntil: promise => { pending = promise; } });
   await pending;
  },
 };
}
test('Yorke Way owner push offers the audience action and opens its exact private destination', async () => {
 const sw = serviceWorkerHarness();
 await sw.push({ kind: 'yorkeway_owner_signup', title: 'New Yorke Way signup', body: 'Someone joined the early-access list.', url: '/admin/yorkeway-audience' });
 assert.deepEqual(JSON.parse(JSON.stringify(sw.shown[0].actions)), [{ action: 'open', title: 'View audience list' }]);
 await sw.click(sw.shown[0].data);
 assert.deepEqual(sw.opened, ['/admin/yorkeway-audience']);
});
test('owner push cannot be redirected to an external origin or another admin page', async () => {
 for (const url of ['https://evil.example/admin/yorkeway-audience', '//evil.example/admin/yorkeway-audience', '/admin/accounts', '/admin/yorkeway-audience?redirect=https://evil.example', '/notifications']) {
  const sw = serviceWorkerHarness();
  await sw.click({ kind: 'yorkeway_owner_signup', url });
  assert.deepEqual(sw.opened, ['/admin/yorkeway-audience']);
 }
});
test('attendee and host notifications cannot select the owner audience destination', async () => {
 for (const [kind, target] of [['room_message', '/notifications'], ['organizer_rsvp', '/organizer/workspace'], ['organizer_purchase', '/organizer/workspace']]) {
  const sw = serviceWorkerHarness();
  await sw.click({ kind, url: '/admin/yorkeway-audience' });
  assert.deepEqual(sw.opened, [target]);
 }
});
test('owner push reuses an owner window instead of replacing an attendee or host workspace', async () => {
 const navigated = [], focused = [];
 const window = (id, path) => ({
  url: 'https://tickets.becoreops.com' + path,
  focus: async () => { focused.push(id); },
  navigate: async target => { navigated.push([id, target]); return { focus: async () => { focused.push(id); } }; },
 });
 const sw = serviceWorkerHarness([window('guest', '/my-nights'), window('host', '/organizer/workspace'), window('owner', '/admin/yorkeway-audience')]);
 await sw.click({ kind: 'yorkeway_owner_signup', url: '/admin/yorkeway-audience' });
 assert.deepEqual(navigated, [['owner', '/admin/yorkeway-audience']]);
 assert.deepEqual(focused, ['owner']); assert.deepEqual(sw.opened, []);
});
test('owner push opens a new owner destination when only attendee windows exist', async () => {
 let navigated = false;
 const sw = serviceWorkerHarness([{ url: 'https://tickets.becoreops.com/my-nights', focus() {}, navigate() { navigated = true; } }]);
 await sw.click({ kind: 'yorkeway_owner_signup', url: '/admin/yorkeway-audience' }, 'quiet');
 assert.equal(navigated, false); assert.deepEqual(sw.opened, ['/admin/yorkeway-audience']);
});
