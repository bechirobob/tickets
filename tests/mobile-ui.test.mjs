import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);
const roomUrl = new URL("../app/room/[slug]/room-client.tsx", import.meta.url);
const homeUrl = new URL("../app/page.tsx", import.meta.url);
const organizerUrl = new URL("../app/organizer/page.tsx", import.meta.url);
const submissionUrl = new URL("../app/organizer/submit/page.tsx", import.meta.url);
const adminSubmissionsUrl = new URL("../app/api/admin/submissions/route.ts", import.meta.url);
const organizerWorkspaceUrl = new URL("../app/organizer/workspace/organizer-workspace.tsx", import.meta.url);
const organizerWorkspaceApiUrl = new URL("../app/api/organizer/workspace/route.ts", import.meta.url);
const scrollRevealUrl = new URL("../app/scroll-reveal.tsx", import.meta.url);
const workerUrl = new URL("../worker/index.ts", import.meta.url);

test("message controls cannot inherit a full-page footer layout", async () => {
  const [css, room] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(roomUrl, "utf8"),
  ]);

  assert.doesNotMatch(css, /(?:^|\n)footer\s*\{/u);
  assert.match(room, /className="room-message__actions"/u);
  assert.doesNotMatch(room, /<footer>\s*<button/u);
  assert.match(css, /\.room-bubble\s*\{[^}]*border-radius:/su);
});

test("Room text controls keep iOS at the existing page scale", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.room-composer textarea\s*\{[^}]*font-size:\s*16px/su);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.room-stream\s*\{[^}]*min-height:\s*0/su);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.room-modal select,\s*\.room-modal textarea\s*\{[^}]*font-size:\s*16px/su);
  assert.doesNotMatch(css, /maximum-scale\s*=\s*1|user-scalable\s*=\s*no/u);
});

test("the compact homepage hero stays within a deliberate desktop and mobile height", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.compact-hero\s*\{[^}]*height:\s*min\(64vh, 640px\)[^}]*min-height:\s*520px/su);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.compact-hero\s*\{[^}]*height:\s*560px[^}]*min-height:\s*560px/su);
  assert.match(css, /\.compact-hero__copy h1\s*\{[^}]*font-size:\s*clamp\(55px, 7\.4vw, 104px\)/su);
});

test("The Drop uses compact filters, bounded cards and a dedicated full page", async () => {
  const [css, explorer, home] = await Promise.all([readFile(cssUrl, "utf8"), readFile(new URL("../app/event-explorer.tsx", import.meta.url), "utf8"), readFile(homeUrl, "utf8")]);
  assert.match(explorer, />Tonight</u);
  assert.match(explorer, />This weekend</u);
  assert.match(explorer, />Next up</u);
  assert.match(explorer, /const pageSize = full \? 9 : 6/u);
  assert.match(home, /events\.slice\(0, 6\)/u);
  assert.match(home, /href="\/events"/u);
  assert.match(css, /\.drop-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/su);
  assert.match(css, /\.drop-grid--rail\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto/su);
  assert.match(explorer, /label: "Alté"/u);
  assert.match(explorer, /label: "Amapiano"/u);
  assert.match(explorer, /event\.quip/u);
  assert.match(explorer, /event\.note/u);
  assert.match(explorer, /event\.lineup/u);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
});

test("The Room is promoted as a ticket-locked preview without exposing a public chat", async () => {
  const [css, home] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(homeUrl, "utf8"),
  ]);
  assert.match(home, /id="the-room"/u);
  assert.match(home, /The night has a Room\./u);
  assert.match(home, /drop Flashes into the same conversation/u);
  assert.match(home, /The chat remembers\. The photos know when to leave\./u);
  assert.match(home, /No ticket, no lurking\. Very civilised\./u);
  assert.match(home, /HOST UPDATE/u);
  assert.match(home, /😂 4/u);
  assert.match(home, /😭 2/u);
  assert.match(home, /🔥 3/u);
  assert.doesNotMatch(home, /href="\/room\//u);
  assert.match(css, /\.room-product-scene\s*\{[^}]*grid-template-columns:/su);
  assert.match(css, /\.room-product-scene__crop\s*\{[^}]*overflow:\s*hidden/su);
  assert.match(css, /\.scene-message\s*\{[^}]*max-width:\s*62%/su);
  assert.match(css, /\.room-bubble\s*\{[^}]*padding:\s*8px 11px/su);
  assert.match(css, /\.room-message__actions\s*\{[^}]*min-height:\s*29px/su);
  assert.doesNotMatch(home, /device|phone mock/iu);
});

test("The Room reconnects when a ticket holder returns to the page", async () => {
  const [room, durableObject] = await Promise.all([
    readFile(roomUrl, "utf8"),
    readFile(new URL("../worker/the-room.ts", import.meta.url), "utf8"),
  ]);

  assert.match(room, /addEventListener\("online", reconnectIfNeeded\)/u);
  assert.match(room, /addEventListener\("pageshow", reconnectIfNeeded\)/u);
  assert.match(room, /addEventListener\("visibilitychange", onVisibility\)/u);
  assert.match(room, /Math\.min\(15_000, 750 \* \(2 \*\* Math\.min\(attempt, 5\)\)\)/u);
  assert.match(room, /JSON\.stringify\(\{ type: "ping" \}\)/u);
  assert.match(room, /Date\.now\(\) - lastSocketActivityRef\.current > 60_000/u);
  assert.match(room, /Finding the signal/u);
  assert.match(room, /type: "flash" as const/u);
  assert.match(room, /className="room-camera"/u);
  assert.match(durableObject, /input\.type === "ping"/u);
  assert.match(durableObject, /type: "pong"/u);
});

test("homepage sections reveal once without overriding reduced-motion preferences", async () => {
  const [css, home, reveal] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(homeUrl, "utf8"),
    readFile(scrollRevealUrl, "utf8"),
  ]);

  assert.match(reveal, /new IntersectionObserver/u);
  assert.match(reveal, /prefers-reduced-motion: reduce/u);
  assert.match(reveal, /observer\.unobserve\(entry\.target\)/u);
  assert.match(home, /data-scroll-reveal/u);
  assert.match(css, /\.scroll-reveal-ready \[data-scroll-reveal\]/u);
  assert.match(css, /opacity\s+\.68s/u);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.scroll-reveal-ready \[data-scroll-reveal\][^{]*\{[^}]*opacity:\s*1[^}]*transform:\s*none[^}]*transition:\s*none/su);
});

test("mobile customers retain wallet access and form controls do not trigger iOS zoom", async () => {
  const css = await readFile(cssUrl, "utf8");
  const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(finalMobileBlock, /\.night-ticket-link\s*\{[^}]*display:\s*flex[^}]*font-size:\s*0/su);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px/su);
});

test("checkout conversion actions look and behave like primary controls", async () => {
  const [css, checkout, turnstile, layout] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(new URL("../app/checkout/[slug]/checkout-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/turnstile.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.event-page \.checkout-link\s*\{[^}]*background:\s*var\(--ink\)[^}]*font-weight:\s*600/su);
  assert.match(css, /\.event-page \.checkout-link:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/su);
  assert.match(css, /\.pay-button\s*\{[^}]*min-height:\s*53px[^}]*background:\s*#f0ecdf[^}]*font-weight:\s*600/su);
  assert.match(css, /\.pay-button:hover:not\(:disabled\)\s*\{[^}]*transform:\s*translateY\(-2px\)/su);
  assert.match(css, /\.pay-button:focus-visible\s*\{[^}]*outline:/su);
  assert.match(checkout, /payment-providers\/mtn-momo\.svg/u);
  assert.match(checkout, /payment-providers\/telecel-cash\.svg/u);
  assert.match(checkout, /payment-providers\/at-money\.svg/u);
  assert.doesNotMatch(checkout, /Smartphone/u);
  assert.match(checkout, /controller\.abort\(\), 15_000/u);
  assert.match(turnstile, /Security check is taking too long\./u);
  assert.match(turnstile, /Try the security check again/u);
  assert.match(turnstile, /"refresh-timeout": "auto"/u);
  assert.match(layout, /preconnect" href="https:\/\/challenges\.cloudflare\.com"/u);
});

test("public organiser actions keep submission public and named workspaces protected", async () => {
  const [home, organizer, submission, adminSubmissions] = await Promise.all([
    readFile(homeUrl, "utf8"),
    readFile(organizerUrl, "utf8"),
    readFile(submissionUrl, "utf8"),
    readFile(adminSubmissionsUrl, "utf8"),
  ]);

  assert.doesNotMatch(home, /href="\/organizer"/u);
  assert.ok(home.match(/href="\/organizer\/submit"/gu)?.length >= 2);
  assert.match(home, />Submit a night\s*</u);
  assert.match(organizer, /redirect\("\/organizer\/workspace"\)/u);
  assert.doesNotMatch(organizer, /ops-shell|Ticket sales|Gross sales|Attendees/u);
  assert.match(submission, /href="\/"[^>]*>.*Back to events/su);
  assert.match(submission, /Organiser sign in/u);
  assert.match(adminSubmissions, /readAdminSession\(request\.headers\.get\("cookie"\)\)/u);
  assert.match(adminSubmissions, /if \(!actor\) return Response\.json\([^;]+status: 401/su);
});

test("approved Hosts and ticket-holder preparation reach only the assigned organiser workspace", async () => {
  const [adminSubmissions, organizerWorkspace, organizerWorkspaceApi, css] = await Promise.all([
    readFile(adminSubmissionsUrl, "utf8"),
    readFile(organizerWorkspaceUrl, "utf8"),
    readFile(organizerWorkspaceApiUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(adminSubmissions, /db\.select\(\{ id: hosts\.id \}\).*eq\(hosts\.slug, hostSlug\)/su);
  assert.match(adminSubmissions, /db\.insert\(hosts\)/u);
  assert.match(adminSubmissions, /db\.insert\(eventHosts\)/u);
  assert.match(organizerWorkspaceApi, /WHERE question\.event_slug IN \(\$\{placeholders\}\)/u);
  assert.match(organizerWorkspaceApi, /INSERT INTO event_updates/u);
  assert.match(organizerWorkspace, />Before the Night</u);
  assert.match(organizerWorkspace, /data\.attendeeAnswers\.filter\(\(item\) => item\.eventSlug === selectedSlug\)/u);
  assert.match(css, /\.organizer-answers\s*\{[^}]*grid-template-columns:\s*repeat\(2/su);
});

test("ticket entry uses a protected real scanner and printable QR receipt", async () => {
  const [scanPage, scanner, wallet, receiptCss] = await Promise.all([
    readFile(new URL("../app/scan/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/scan/scanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tickets/ticket-wallet.tsx", import.meta.url), "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(scanPage, /requireAdminSession\("\/scan", "gate\.scan"\)/u);
  assert.match(scanPage, /staff_event_assignments/u);
  assert.match(scanner, /new QrScanner/u);
  assert.match(scanner, /\/api\/admin\/check-in/u);
  assert.doesNotMatch(scanner, /code\.trim\(\)\.length\s*>\s*5/u);
  assert.match(wallet, /<QrPass/u);
  assert.match(wallet, /Payment receipt/u);
  assert.match(receiptCss, /@media print/u);
});

test("launch inventory is database-backed and public defects stay closed", async () => {
  const [events, eventPage, privacy, home, wallet, previewMigration, paymentRoute] = await Promise.all([
    readFile(new URL("../app/events.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/event/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(homeUrl, "utf8"),
    readFile(new URL("../app/tickets/ticket-wallet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0009_eminent_champions.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payments/initialize/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(events, /after-dark-osu|noir-room-labone|sun-chasers-labadi|longitude-spintex/u);
  assert.match(events, /FROM curated_event_records/u);
  assert.match(events, /FROM event_ticket_tiers/u);
  assert.match(events, /is_test_event AS isTestEvent/u);
  assert.match(previewMigration, /'after-dark-osu'/u);
  assert.match(previewMigration, /'noir-room-labone'/u);
  assert.match(previewMigration, /'sun-chasers-labadi'/u);
  assert.match(previewMigration, /'longitude-spintex'/u);
  assert.match(previewMigration, /`is_test_event`/u);
  assert.match(paymentRoute, /event\.isTestEvent && !env\.PAYSTACK_SECRET_KEY\.startsWith\("sk_test_"\)/u);
  assert.match(eventPage, /if \(!event\) notFound\(\)/u);
  assert.match(eventPage, /<EventActions/u);
  assert.match(eventPage, /event\.venueMapUrl/u);
  assert.match(privacy, /Privacy notice/u);
  assert.match(home, /featured\?\.image/u);
  assert.match(wallet, /\/api\/customer\/recovery/u);
});

test("public browsing is edge-cached without caching private customer journeys", async () => {
  const worker = await readFile(workerUrl, "utf8");
  assert.match(worker, /path === "\/" \|\| path === "\/events" \|\| path === "\/hosts"/u);
  assert.match(worker, /\^\\\/event\\\//u);
  assert.match(worker, /headers\.delete\("set-cookie"\)/u);
  assert.match(worker, /ctx\.waitUntil\(edgeCache\.put\(cacheKey, secured\.clone\(\)\)\)/u);
  assert.match(worker, /x-becore-edge-cache/u);
  assert.doesNotMatch(worker, /eligible[^;]+(?:checkout|payment|tickets|my-nights|room)/su);
});
