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
for (const path of ["/", "/events", "/my-nights", "/notifications", "/event/the-weekend-braai"]) {
  const page = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!page.ok) throw new Error(`Production route ${path} returned ${page.status}`);
}
const webhook = await fetch(`${origin}/api/payments/seevplus/webhook`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000),
});
if (![401, 503].includes(webhook.status)) throw new Error(`Unsigned Seev webhook returned ${webhook.status}`);
console.log(JSON.stringify({ ...version, publicRoutes: "passed", unsignedSeevWebhook: "rejected" }));
