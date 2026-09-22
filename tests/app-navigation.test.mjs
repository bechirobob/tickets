import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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
