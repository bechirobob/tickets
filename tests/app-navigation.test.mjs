import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import "./header-panel-focus.test.mjs";
import "./room-demo-lifecycle.test.mjs";
import "./owner-notification-wiring.test.mjs";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
async function clickNotification(data, windows = [], action = "") {
  const handlers = new Map();
  const opened = [];
  const self = { location: { origin: "https://tickets.becoreops.com" }, addEventListener: (name, handler) => handlers.set(name, handler), clients: { matchAll: async () => windows, openWindow: async (url) => opened.push(url) } };
  vm.runInNewContext(source, { self, URL });
  let complete;
  handlers.get("notificationclick")({ action, notification: { data, close() {} }, waitUntil: (work) => { complete = work; } });
  await complete;
  return opened;
}
test("push navigation keeps external and staff destinations inside the customer inbox", async () => {
  for (const url of ["https://example.com/room/one", "//example.com", "javascript:alert(1)", "/admin", "/api/customer/session"]) {
    assert.deepEqual(await clickNotification({ url }), ["/notifications"]);
  }
  assert.deepEqual(await clickNotification({ url: "/my-nights/one?view=passes" }), ["/my-nights/one?view=passes"]);
  assert.deepEqual(await clickNotification({ eventSlug: "one" }, [], "quiet"), ["/notifications?mute=one"]);
});
test("notification taps preserve staff windows and wait for customer navigation before focus", async () => {
  const staff = { url: "https://tickets.becoreops.com/admin", focus() { throw new Error("Staff window was hijacked"); } };
  assert.deepEqual(await clickNotification({ url: "/notifications" }, [staff]), ["/notifications"]);
  const steps = [];
  const customer = { url: "https://tickets.becoreops.com/my-nights", focus() { steps.push("focus"); }, async navigate(url) { steps.push(url); return this; } };
  await clickNotification({ url: "/room/one" }, [staff, customer]);
  assert.deepEqual(steps, ["/room/one", "focus"]);
});

test('ticket confirmations open My Nights without Room mute actions', async () => {
  for (const kind of ['purchase_confirmation', 'registration_update', 'room_message', 'host_update']) {
    const handlers=new Map();let shown;
    const self={addEventListener:(name,handler)=>handlers.set(name,handler),registration:{showNotification:async(title,options)=>{shown={title,...options};}}};
    vm.runInNewContext(source,{self,URL});let complete;
    handlers.get('push')({data:{json:()=>({kind,eventSlug:'one',title:'Confirmed',url:'/my-nights/one?view=passes'})},waitUntil:work=>{complete=work;}});
    await complete;
    assert.equal(shown.data.url,'/my-nights/one?view=passes');
    assert.equal(shown.actions.some(action=>action.action==='quiet'),['room_message','host_update'].includes(kind));
  }
});

test('host RSVP taps open only the host workspace and preserve guest windows', async () => {
  const url='/organizer/workspace?area=events&event=one&view=rsvp&tab=roster';
  const guest={url:'https://tickets.becoreops.com/my-nights',focus(){throw new Error('Guest window was hijacked');}};
  assert.deepEqual(await clickNotification({kind:'organizer_rsvp',url},[guest]),[url]);
  const steps=[];
  const host={url:'https://tickets.becoreops.com/organizer/workspace',async navigate(target){steps.push(target);return this;},focus(){steps.push('focus');}};
  await clickNotification({kind:'organizer_rsvp',url},[guest,host]);
  assert.deepEqual(steps,[url,'focus']);
  for(const unsafe of ['https://evil.test/organizer/workspace','/api/admin/registrations','/admin','/my-nights','javascript:alert(1)']) {
    assert.deepEqual(await clickNotification({kind:'organizer_rsvp',url:unsafe}),['/organizer/workspace']);
  }
  assert.deepEqual(await clickNotification({kind:'registration_update',url}),['/notifications']);
});


test('worker installation accepts canonical and VPS static offline pages, rejecting failed fallback', async () => {
  for (const statuses of [[200], [404, 200], [404, 404]]) {
    const handlers = new Map(), fetched = [], cached = [], shell = [];
    let activated = false, complete;
    const self = { addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: async () => { activated = true; } };
    const caches = { open: async () => ({ addAll: async urls => shell.push(...urls), put: async (url, response) => cached.push([url, response.status]) }) };
    const fetch = async url => { fetched.push(url); return { ok: statuses[fetched.length - 1] === 200, status: statuses[fetched.length - 1] }; };
    vm.runInNewContext(source, { self, URL, caches, fetch });
    handlers.get('install')({ waitUntil: work => { complete = work; } });
    if (statuses.at(-1) === 404) {
      await assert.rejects(complete, /Offline ticket page is unavailable/);
      assert.equal(activated, false); assert.deepEqual(cached, []);
    } else {
      await complete; assert.equal(activated, true);
      assert.deepEqual(cached, [['/offline-ticket', 200]]);
      assert.ok(shell.includes('/manifest.webmanifest')); assert.ok(!shell.includes('/offline-ticket'));
    }
    assert.deepEqual(fetched, statuses.length === 1 ? ['/offline-ticket'] : ['/offline-ticket', '/offline-ticket.html']);
  }
});

test('host purchase notifications open the event guest desk and reject foreign destinations',async()=>{
 const target='/organizer/workspace?area=events&event=one&view=guests';
 assert.deepEqual(await clickNotification({kind:'organizer_purchase',url:target}),[target]);
 for(const url of ['https://evil.test/organizer/workspace','/admin','/my-nights'])assert.deepEqual(await clickNotification({kind:'organizer_purchase',url}),['/organizer/workspace']);
});
