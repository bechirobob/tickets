import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);
const roomUrl = new URL("../app/room/[slug]/room-client.tsx", import.meta.url);
const homeUrl = new URL("../app/page.tsx", import.meta.url);
const organizerUrl = new URL("../app/organizer/page.tsx", import.meta.url);
const submissionUrl = new URL("../app/organizer/submit/page.tsx", import.meta.url);
const adminSubmissionsUrl = new URL("../app/api/admin/submissions/route.ts", import.meta.url);
const scrollRevealUrl = new URL("../app/scroll-reveal.tsx", import.meta.url);

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
  const roomMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 640px)"));

  assert.match(css, /\.room-composer textarea\s*\{[^}]*font-size:\s*16px/su);
  assert.match(roomMobileBlock, /\.room-stream\s*\{[^}]*min-height:\s*0/su);
  assert.match(roomMobileBlock, /\.room-modal select,\s*\.room-modal textarea\s*\{[^}]*font-size:\s*16px/su);
  assert.doesNotMatch(css, /maximum-scale\s*=\s*1|user-scalable\s*=\s*no/u);
});

test("the final mobile cascade keeps the homepage hero inside the viewport", async () => {
  const css = await readFile(cssUrl, "utf8");
  const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(finalMobileBlock, /\.night-featured\s*\{[^}]*width:\s*calc\(100% - 32px\)/su);
  assert.match(finalMobileBlock, /\.night-hero__copy\s*\{[^}]*top:\s*178px/su);
  assert.match(finalMobileBlock, /\.night-ticker\s*\{[^}]*overflow:\s*hidden/su);
});

test("customer actions are editorial links and the mobile event list is a smooth snap rail", async () => {
  const css = await readFile(cssUrl, "utf8");
  const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(css, /\.night-submit\s*\{[^}]*border-bottom:[^}]*color:\s*white/su);
  assert.match(css, /\.night-shuffle\s*\{[^}]*background:\s*transparent[^}]*color:\s*var\(--signal\)/su);
  assert.match(css, /\.vibe-filter button\.active\s*\{[^}]*background:\s*transparent/su);
  assert.match(finalMobileBlock, /\.curated-grid\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory[^}]*scroll-behavior:\s*smooth/su);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
});

test("The Room is promoted as a ticket-locked preview without exposing a public chat", async () => {
  const [css, home] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(homeUrl, "utf8"),
  ]);
  const finalMobileBlock = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(home, /id="the-room"/u);
  assert.match(home, /The chat your.*ticket gets.*you into\./su);
  assert.match(home, /No ticket\. No lurking\./u);
  assert.match(home, /Ticket-holder mobile preview/u);
  assert.match(home, /aria-label="A preview of The Room conversation inside a mobile device"/u);
  assert.match(home, /ticket holders only/u);
  assert.match(home, /Organiser update/u);
  assert.match(home, /Main entrance · Gate 2/u);
  assert.match(home, /Message The Room/u);
  assert.match(home, /Preview locked · your ticket opens this Room/u);
  assert.doesNotMatch(home, /href="\/room\//u);
  assert.match(css, /\.night-room-device\s*\{[^}]*border-radius:\s*43px[^}]*linear-gradient/su);
  assert.match(css, /\.night-room-device__status\s*\{[^}]*display:\s*grid/su);
  assert.match(css, /\.night-room-peek__stream::after\s*\{[^}]*linear-gradient/su);
  assert.match(css, /\.night-room-peek__composer\s*\{[^}]*grid-template-columns:/su);
  assert.match(finalMobileBlock, /\.night-room-tease\s*\{[^}]*grid-template-columns:\s*1fr/su);
  assert.match(css, /\.night-room-message\s*\{\s*animation:\s*none/su);
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
  assert.match(finalMobileBlock, /input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px/su);
});

test("checkout conversion actions look and behave like primary controls", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /\.event-page \.checkout-link\s*\{[^}]*background:\s*var\(--ink\)[^}]*font-weight:\s*600/su);
  assert.match(css, /\.event-page \.checkout-link:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/su);
  assert.match(css, /\.pay-button\s*\{[^}]*min-height:\s*53px[^}]*background:\s*#f0ecdf[^}]*font-weight:\s*600/su);
  assert.match(css, /\.pay-button:hover:not\(:disabled\)\s*\{[^}]*transform:\s*translateY\(-2px\)/su);
  assert.match(css, /\.pay-button:focus-visible\s*\{[^}]*outline:/su);
});

test("public organiser actions keep submission public and named workspaces protected", async () => {
  const [home, organizer, submission, adminSubmissions] = await Promise.all([
    readFile(homeUrl, "utf8"),
    readFile(organizerUrl, "utf8"),
    readFile(submissionUrl, "utf8"),
    readFile(adminSubmissionsUrl, "utf8"),
  ]);

  assert.doesNotMatch(home, /href="\/organizer"/u);
  assert.ok(home.match(/href="\/organizer\/submit"/gu)?.length >= 4);
  assert.match(home, />Submit your party\s*</u);
  assert.match(organizer, /redirect\("\/organizer\/workspace"\)/u);
  assert.doesNotMatch(organizer, /ops-shell|Ticket sales|Gross sales|Attendees/u);
  assert.match(submission, /href="\/"[^>]*>.*Back to events/su);
  assert.match(submission, /Organiser sign in/u);
  assert.match(adminSubmissions, /readAdminSession\(request\.headers\.get\("cookie"\)\)/u);
  assert.match(adminSubmissions, /if \(!actor\) return Response\.json\([^;]+status: 401/su);
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
