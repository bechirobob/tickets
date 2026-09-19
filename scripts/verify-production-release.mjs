import { setTimeout as wait } from "node:timers/promises";
const origin = "https://tickets.becoreops.com";
if (!process.env.GITHUB_SHA) throw new Error("Expected release SHA is required");
let version;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(`${origin}/api/version`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  version = await response.json();
  if (response.ok && version.revision === process.env.GITHUB_SHA && version.versionId) break;
  if (attempt === 11) throw new Error(`Live revision does not match the release: ${JSON.stringify(version)}`);
  console.log("Waiting for the published revision to reach this edge.");
  await wait(5000);
}
for (const path of ["/", "/events", "/my-nights", "/notifications", "/event/the-weekend-braai", "/rsvp/access", "/rsvp/the-weekend-braai", "/announcements/unsubscribe"]) {
  const page = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!page.ok) throw new Error(`Production route ${path} returned ${page.status}`);
}
const webhook = await fetch(`${origin}/api/payments/seevplus/webhook`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000),
});
if (![401, 503].includes(webhook.status)) throw new Error(`Unsigned Seev webhook returned ${webhook.status}`);
for (const [path, expected] of [["/api/customer/registrations", 401], ["/api/organizer/reports?eventSlug=the-weekend-braai", 403], ["/api/admin/registrations?eventSlug=the-weekend-braai", 403]]) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15000) });
  if (response.status !== expected) throw new Error(`Registration privacy check ${path} returned ${response.status}`);
}
for (const path of ["audience", "organizer-activity", "registrations?eventSlug=the-weekend-braai&live=1", "events", "events/removal", "operations", "accounts", "orders", "support", "promoters", "rooms"]) {
  const response = await fetch(`${origin}/api/admin/${path}`, { signal: AbortSignal.timeout(15000) });
  if (![401, 403].includes(response.status)) throw new Error(`Operations privacy check ${path} returned ${response.status}`);
}
for (const path of ["/admin/operations", "/admin/accounts", "/admin/events", "/admin/orders", "/admin/support", "/admin/rooms", "/admin/fees"]) {
  const response = await fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (![302, 303, 307, 308].includes(response.status) || !response.headers.get("location")?.includes("/admin/login")) throw new Error(`Operations route guard failed: ${path}`);
}
for (const path of ["/organizer/activate", "/api/admin/organizer-invitations?accountId=release-verification"]) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15000) });
  const expected = path.startsWith("/api/") ? 403 : 200;
  if (response.status !== expected || response.headers.get("cache-control") !== "no-store") throw new Error(`Organiser setup privacy check failed: ${path}`);
  if (path === "/organizer/activate" && response.headers.get("referrer-policy") !== "no-referrer") throw new Error("Organiser setup referrer policy is missing");
}
const invalidSetup = await fetch(`${origin}/api/organizer/activate`, {
  method: "POST", headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ action: "inspect", token: "Z".repeat(43) }), signal: AbortSignal.timeout(15000),
});
if (invalidSetup.status !== 400 || invalidSetup.headers.get("cache-control") !== "no-store" || !(await invalidSetup.json()).error?.includes("invalid, expired")) throw new Error("Organiser invitation validation is not ready");
const catalogueResponse = await fetch(`${origin}/api/public/events`, { signal: AbortSignal.timeout(15000) });
const catalogue = await catalogueResponse.json();
if (!catalogueResponse.ok || !catalogue.events?.length || catalogue.events.some(event => !['paid', 'rsvp', 'interest'].includes(event.registrationMode))) throw new Error('Production registration catalogue is not ready');
console.log(JSON.stringify({ ...version, operationsPrivacy: 'passed', organizerActivation: 'passed', registrationPrivacy: 'passed', registrationCatalogue: 'passed', publicRoutes: "passed", unsignedSeevWebhook: "rejected" }));
