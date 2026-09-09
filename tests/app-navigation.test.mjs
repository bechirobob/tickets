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
