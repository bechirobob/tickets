import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);
const discoveryUrl = new URL("../app/discovery.css", import.meta.url);
const accessPolishUrl = new URL("../app/access-polish.css", import.meta.url);
const roomUrl = new URL("../app/room/[slug]/room-client.tsx", import.meta.url);
const homeUrl = new URL("../app/page.tsx", import.meta.url);
const activeNightUrl = new URL("../app/active-night-experience.tsx", import.meta.url);
const aboutUrl = new URL("../app/about/page.tsx", import.meta.url);
const mobileNavigationUrl = new URL("../app/mobile-navigation.tsx", import.meta.url);
const roomPreviewCarouselUrl = new URL("../app/room-preview-carousel.tsx", import.meta.url);
const organizerUrl = new URL("../app/organizer/page.tsx", import.meta.url);
const submissionUrl = new URL("../app/organizer/submit/page.tsx", import.meta.url);
const adminSubmissionsUrl = new URL("../app/api/admin/submissions/route.ts", import.meta.url);
const organizerWorkspaceUrl = new URL("../app/organizer/workspace/organizer-workspace.tsx", import.meta.url);
const organizerWorkspaceApiUrl = new URL("../app/api/organizer/workspace/route.ts", import.meta.url);
const helpCentreUrl = new URL("../app/help/help-centre.tsx", import.meta.url);
const scrollRevealUrl = new URL("../app/scroll-reveal.tsx", import.meta.url);
const workerUrl = new URL("../worker/index.ts", import.meta.url);
const customerDockUrl = new URL("../app/customer-dock.tsx", import.meta.url);
const myNightsUrl = new URL("../app/my-nights/my-nights-client.tsx", import.meta.url);
const nightHubUrl = new URL("../app/my-nights/[slug]/night-hub.tsx", import.meta.url);
const scannerUrl = new URL("../app/scan/scanner.tsx", import.meta.url);
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url);
const roomNotificationsUrl = new URL("../app/room/[slug]/room-notifications.tsx", import.meta.url);
const supportCentreUrl = new URL("../app/my-nights/[slug]/support-centre.tsx", import.meta.url);
const waitlistUrl = new URL("../app/event/[slug]/waitlist-control.tsx", import.meta.url);
const roomOperationsUrl = new URL("../app/admin/rooms/room-operations.tsx", import.meta.url);
const eventOperationsUrl = new URL("../app/admin/operations/event-operations-hub.tsx", import.meta.url);
const ownerBootstrapUrl = new URL("../app/admin/bootstrap/page.tsx", import.meta.url);
const ownerBootstrapFormUrl = new URL("../app/admin/bootstrap/bootstrap-form.tsx", import.meta.url);
const staffPasswordClientUrl = new URL("../lib/staff-password-client.ts", import.meta.url);
const adminSessionUrl = new URL("../app/api/admin/session/route.ts", import.meta.url);
const feeSettingsUrl = new URL("../app/admin/fee-settings.tsx", import.meta.url);
const staffAccountsUrl = new URL("../app/admin/accounts/staff-accounts.tsx", import.meta.url);
const staffRolesUrl = new URL("../lib/staff-roles.ts", import.meta.url);
const workspaceJumpUrl = new URL("../app/admin/workspace-jump.tsx", import.meta.url);
const operationsNavUrl = new URL("../app/admin/operations-nav.tsx", import.meta.url);
const accountPageUrl = new URL("../app/admin/account/page.tsx", import.meta.url);
const orderOperationsUrl = new URL("../app/admin/orders/order-operations.tsx", import.meta.url);
const orderOperationsApiUrl = new URL("../app/api/admin/orders/route.ts", import.meta.url);

test("message controls cannot inherit a full-page footer layout", async () => {
  const [css, room] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(roomUrl, "utf8"),
  ]);

  assert.doesNotMatch(css, /(?:^|\n)footer\s*\{/u);
  assert.match(room, /className="room-message-menu"/u);
  assert.match(room, /label="Message actions"/u);
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
  const css = await readFile(discoveryUrl, "utf8");
  assert.match(css, /\.discovery-home \.compact-hero\s*\{[^}]*height:\s*450px[^}]*min-height:\s*450px/su);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.compact-hero\s*\{[^}]*height:\s*430px/su);
  assert.match(css, /\.compact-hero__copy h1\s*\{[^}]*font-size:\s*clamp\(46px, 6\.3vw, 86px\)/su);
});

test("The Drop uses compact filters, bounded cards and a dedicated full page", async () => {
  const [css, explorer, home] = await Promise.all([readFile(cssUrl, "utf8"), readFile(new URL("../app/event-explorer.tsx", import.meta.url), "utf8"), readFile(activeNightUrl, "utf8")]);
  assert.match(explorer, />Tonight</u);
  assert.match(explorer, />This weekend</u);
  assert.match(explorer, />Next up</u);
  assert.match(explorer, /const pageSize = full \? 12 : 6/u);
  assert.match(home, /<EventExplorer events=\{events\}/u);
  assert.match(home, /href="\/events"/u);
  assert.match(css, /\.drop-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/su);
  assert.match(css, /\.drop-grid--rail\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto/su);
  assert.match(explorer, /label: "Alté"/u);
  assert.match(explorer, /label: "Amapiano"/u);
  assert.match(explorer, /type="search"/u);
  assert.match(explorer, /role="status"/u);
  assert.match(explorer, /aria-pressed=\{windowFilter/u);
  assert.doesNotMatch(explorer, /drop-grid--rail|scrollIntoView|event\.note/u);
  const discovery = await readFile(discoveryUrl, "utf8");
  assert.match(discovery, /\.discovery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/su);
  assert.match(discovery, /@media \(max-width: 700px\)[\s\S]*?\.discovery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/su);
  assert.match(explorer, /event\.lineup/u);
  assert.match(css, /:root\s*\{[^}]*--night:\s*#090a09[^}]*--signal:\s*#bd3f11[^}]*--acid:\s*#d7f45b/su);
  assert.match(css, /\.drop-vibes button\[aria-selected="true"\]\s*\{[^}]*background:\s*transparent[^}]*color:\s*#090a09/su);
  assert.match(css, /\.drop-card__image > span\s*\{[^}]*background:\s*#090a09[^}]*color:\s*#d7f45b/su);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
});

test("notification history stays behind the verified My Nights entrance", async () => {
  const [home, dock, myNights, hub, polish] = await Promise.all([
    readFile(homeUrl, "utf8"),
    readFile(customerDockUrl, "utf8"),
    readFile(myNightsUrl, "utf8"),
    readFile(nightHubUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);
  assert.doesNotMatch(home, /href="\/notifications"/u);
  assert.doesNotMatch(dock, /href="\/notifications"/u);
  assert.doesNotMatch(dock, /MobileNavigation|PublicNavigation/u);
  assert.match(home, /<PublicNavigation \/>/u);
  assert.match(myNights, /<Link className="notification-bell" href="\/notifications"/u);
  assert.doesNotMatch(myNights, /payload \? <Link className="notification-bell"/u);
  assert.match(hub, /className="notification-bell" href="\/notifications"/u);
  assert.ok(hub.indexOf('href={`/room/${event.slug}`}') < hub.indexOf('className="notification-bell"'), "The Room action must precede the notification bell so the bell owns the far-right edge");
  assert.match(polish, /\.my-nights-header-actions,[\s\S]*?\.night-hub__header-actions\s*\{[^}]*justify-self:\s*end/su);
  assert.match(polish, /@media \(max-width: 700px\)[\s\S]*?\.my-nights-page \.directory-header\s*\{[^}]*padding-right:\s*16px/su);
  assert.match(polish, /@media \(max-width: 700px\)[\s\S]*?\.night-hub__header\s*\{[^}]*padding-right:\s*13px/su);
});

test("The Room is promoted as a ticket-locked preview without exposing a public chat", async () => {
  const [css, home, polish, carousel] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(activeNightUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
    readFile(roomPreviewCarouselUrl, "utf8"),
  ]);
  assert.match(home, /id="the-room"/u);
  assert.match(home, /The night has a Room\./u);
  assert.match(home, /Flashes that disappear when the Room closes/u);
  assert.match(home, /Private to verified ticket holders/u);
  assert.match(home, />Preview</u);
  assert.doesNotMatch(home, /Illustrative preview|Demo chat/u);
  assert.match(home, /HOST UPDATE/u);
  assert.match(home, /title="Gate change\."/u);
  assert.match(home, /Have your ticket ready at entry/u);
  assert.match(home, /title="Gate change\."/u);
  assert.match(home, /className="scene-host__mark"/u);
  assert.match(home, /className="scene-host__content"/u);
  assert.match(home, /aria-label="4 laughing reactions"/u);
  assert.match(home, /aria-label="2 crying reactions"/u);
  assert.match(home, /aria-label="3 fire reactions"/u);
  assert.match(home, /className="sr-only">VIP ticket holder/u);
  assert.doesNotMatch(home, /scene-vip-badge" aria-label=/u);
  assert.doesNotMatch(home, /href="\/room\//u);
  assert.match(css, /\.room-product-scene\s*\{[^}]*grid-template-columns:/su);
  assert.equal(home.match(/<RoomPhone /gu)?.length, 2);
  assert.match(home, /<RoomPreviewCarousel>/u);
  assert.match(home, /aria-roledescription="slide"/u);
  assert.match(css, /\.room-product-scene__phones\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 268px\)\)[^}]*justify-content:\s*end/su);
  assert.match(css, /\.room-product-phone\s*\{[^}]*aspect-ratio:\s*71\.9 \/ 150[^}]*height:\s*auto[^}]*border-radius:\s*38px/su);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.room-product-scene__phones\s*\{[^}]*grid-auto-flow:\s*column[^}]*grid-auto-columns:\s*min\(calc\(100vw - 72px\), 268px\)[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory/su);
  assert.match(css, /\.room-product-phone\s*\{[^}]*scroll-snap-align:\s*start[^}]*scroll-snap-stop:\s*always/su);
  assert.match(carousel, /aria-roledescription="carousel"/u);
  assert.match(carousel, /className="room-product-scene__phones"[^>]*tabIndex=\{0\}/u);
  assert.match(carousel, /Swipe or use the arrow keys to see both views/u);
  assert.doesNotMatch(carousel, /Show previous Room preview|Show next Room preview|room-product-preview__controls/u);
  assert.doesNotMatch(carousel, /setInterval|setTimeout/u);
  assert.doesNotMatch(css, /\.room-product-phone__stream > article\s*\{[^}]*animation:/su);
  assert.match(css, /\.room-product-phone__stream > article:nth-child\(6\)\s*\{[^}]*--queue-order:\s*5/su);
  assert.match(home, /className="scene-message__bubble"/u);
  assert.match(home, /className="scene-message__meta"/u);
  assert.doesNotMatch(home, /className="scene-message__bubble"><small/u);
  assert.match(home, /<Gem size=\{10\}/u);
  assert.match(home, /<Signal size=\{9\}/u);
  assert.match(home, /<Wifi size=\{10\}/u);
  assert.match(home, /<BatteryFull size=\{13\}/u);
  assert.match(home, /className="scene-message__reactions"/u);
  assert.match(polish, /\.scene-message\s*\{[^}]*width:\s*fit-content[^}]*max-width:\s*66%/su);
  assert.match(polish, /\.scene-message__reactions\s*\{[^}]*margin:\s*2px 3px 0[^}]*display:\s*flex/su);
  assert.match(polish, /\.scene-host\s*\{[^}]*width:\s*100%[^}]*border-top:\s*1px solid #c9c5bb[^}]*border-bottom:\s*1px solid #c9c5bb[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/su);
  assert.match(polish, /\.scene-host__content > header\s*\{[^}]*justify-content:\s*space-between/su);
  assert.match(polish, /\.scene-host__content strong\s*\{[^}]*font-size:\s*11px/su);
  assert.match(polish, /\.scroll-reveal-ready \.room-product-scene\.is-revealed \.room-product-phone__stream > article\s*\{[^}]*animation:\s*room-phone-message-in 360ms var\(--ease-arrive\) both[^}]*animation-delay:\s*calc\(var\(--queue-order\) \* 320ms\)/su);
  assert.match(polish, /\.room-product-preview\[data-active="0"\] \.room-product-phone:nth-child\(2\)\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translate3d\(-5px, 15px, -18px\) rotateY\(-3\.5deg\) scale\(\.97\)/su);
  assert.match(polish, /\.room-product-preview\[data-active="1"\] \.room-product-phone:nth-child\(1\)\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translate3d\(5px, 15px, -18px\) rotateY\(3\.5deg\) scale\(\.97\)/su);
  assert.doesNotMatch(polish, /\.room-product-preview\[data-active="[01]"\] \.room-product-phone:nth-child\([12]\)[^{]*\{[^}]*opacity:\s*\.[0-9]+/su);
  assert.match(polish, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.scroll-reveal-ready \.room-product-scene\.is-revealed \.room-product-phone__stream > article,[\s\S]*?animation:\s*none[^}]*opacity:\s*1[^}]*transform:\s*none/su);
  assert.match(polish, /@media \(max-width: 700px\)[\s\S]*?\.room-product-preview\[data-active="0"\] \.room-product-phone:nth-child\(2\) \.room-product-phone__stream > article,[\s\S]*?animation-play-state:\s*paused/su);
  assert.match(polish, /\.scene-flash\s*\{[^}]*border-radius:\s*0/su);
  assert.match(polish, /\.room-product-phone__composer\s*\{[^}]*border-bottom:\s*1px solid[^}]*border-radius:\s*0[^}]*background:\s*transparent/su);
  assert.match(css, /\.room-bubble\s*\{[^}]*padding:\s*8px 11px/su);
  assert.match(css, /\.room-message__actions\s*\{[^}]*min-height:\s*29px/su);
  assert.doesNotMatch(home, />[^<]*(?:device|phone mock)[^<]*</iu);
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
  assert.match(room, /Reconnecting…/u);
  assert.match(room, /type: "flash" as const/u);
  assert.match(room, /className="room-camera"/u);
  assert.match(durableObject, /input\.type === "ping"/u);
  assert.match(durableObject, /type: "pong"/u);
});

test("VIP value is visible at decision points without duplicating the interface", async () => {
  const [home, eventPage, checkout, about, help, organizerWorkspace, nightHub, ticketsApi, events, css] = await Promise.all([
    readFile(activeNightUrl, "utf8"),
    readFile(new URL("../app/event/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/checkout/[slug]/checkout-form.tsx", import.meta.url), "utf8"),
    readFile(aboutUrl, "utf8"),
    readFile(helpCentreUrl, "utf8"),
    readFile(organizerWorkspaceUrl, "utf8"),
    readFile(nightHubUrl, "utf8"),
    readFile(new URL("../app/api/customer/tickets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/events.ts", import.meta.url), "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(home, /className="scene-concierge" aria-label="VIP concierge"/u);
  assert.match(home, /aria-label="VIP concierge"/u);
  assert.match(eventPage, /tier\.roomBadge === "VIP"/u);
  assert.match(eventPage, /private Host concierge when enabled/u);
  assert.match(checkout, /checkout-tier__vip/u);
  assert.match(about, /bottle service, song suggestions or assistance when the Host enables them/u);
  assert.match(help, /How VIP works inside The Room/u);
  assert.match(organizerWorkspace, /everything stays off by default/u);
  assert.match(nightHub, /order\.roomBadge === "VIP"/u);
  assert.match(ticketsApi, /tier\.room_badge AS roomBadge/u);
  assert.match(events, /tier\.room_badge AS roomBadge/u);
  assert.match(css, /\.scene-concierge\s*\{[^}]*display:\s*inline-flex[^}]*font-style:\s*normal/su);
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
  assert.match(css, /translateY\(26px\)[^}]*opacity\s+\.58s/su);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.scroll-reveal-ready \[data-scroll-reveal\][^{]*\{[^}]*opacity:\s*1[^}]*transform:\s*none[^}]*transition:\s*none/su);
});

test("Polished Nightlife motion stays purposeful, scoped and accessibility-aware", async () => {
  const [css, polish, carousel] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
    readFile(roomPreviewCarouselUrl, "utf8"),
  ]);

  assert.match(polish, /--motion-press:\s*120ms[^}]*--motion-panel:\s*320ms[^}]*--motion-scene:\s*520ms[^}]*--motion-scene-cycle:\s*4500ms/su);
  assert.match(polish, /\.compact-hero__image--active\s*\{[^}]*animation:\s*night-hero-settle var\(--motion-scene-cycle\)/su);
  assert.match(polish, /\.compact-hero__image--outgoing\s*\{[^}]*animation:\s*night-hero-exit 900ms/su);
  assert.match(polish, /\.compact-hero__shade\s*\{[^}]*animation:\s*night-shade-arrive/su);
  assert.match(polish, /\.drop-card__image::before\s*\{[^}]*opacity:\s*\.38[^}]*linear-gradient\(180deg/su);
  assert.match(polish, /\.drop-explorer\.is-revealed \.drop-card__image img\s*\{[^}]*animation:\s*card-image-arrive/su);
  assert.match(polish, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.drop-card:hover \.drop-card__image::before/su);
  assert.match(polish, /\.payment-method-detail\s*\{[^}]*animation:\s*room-item-arrive/su);
  assert.match(polish, /\.payment-option\.selected::before\s*\{[^}]*scaleY\(1\)/su);
  assert.match(polish, /\.compact-hero__copy > div,[\s\S]*?animation-name:\s*night-actions-arrive/su);
  assert.match(polish, /\.payment-option:not\(\.selected\) \.payment-method-choice\s*\{[^}]*opacity:\s*1/su);
  assert.doesNotMatch(polish, /\.payment-option:not\(\.selected\) \.payment-method-choice\s*\{[^}]*opacity:\s*\.[0-9]/su);
  assert.match(polish, /\.wallet-pass\s*\{[^}]*animation:\s*pass-arrive/su);
  assert.match(polish, /\.room-message,[\s\S]*?animation:\s*room-item-arrive/su);
  assert.match(polish, /\.analytics-bar-list i b\s*\{[^}]*animation:\s*data-resolve/su);
  assert.match(polish, /@media \(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.night-mobile-menu__panel\s*\{[^}]*backdrop-filter:\s*none/su);
  assert.match(polish, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.compact-hero > img,[\s\S]*?animation:\s*none/su);
  assert.match(carousel, /data-active=\{active\}/u);
  assert.doesNotMatch(`${css}\n${polish}`, /animation:\s*[^;]*(?:infinite)[^;]*compact-hero/iu);
});

test("featured nights coordinate the hero, Drop and Room without moving content under readers", async () => {
  const [experience, explorer, css, polish] = await Promise.all([
    readFile(activeNightUrl, "utf8"),
    readFile(new URL("../app/event-explorer.tsx", import.meta.url), "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);

  assert.match(experience, /const sceneInterval = 4_500/u);
  assert.match(experience, /events\.filter\([^;]+\.slice\(0, 4\)/u);
  assert.match(experience, /new IntersectionObserver/u);
  assert.match(experience, /setSceneVisible\(visible\.size > 0\)/u);
  assert.match(experience, /document\.visibilityState !== "visible"/u);
  assert.match(experience, /prefers-reduced-motion: reduce/u);
  assert.match(experience, /<EventExplorer events=\{events\} featuredSlug=\{active\?\.slug\}/u);
  assert.match(experience, /<RoomPreviewCarousel>/u);
  assert.match(experience, /data-active-night=\{active\?\.slug/u);
  assert.match(experience, /className="active-night-autoplay-toggle"/u);
  assert.match(experience, /aria-label=\{manualPause \? "Resume featured nights" : "Pause featured nights"/u);
  assert.doesNotMatch(experience, /active-night-controls|Previous featured night|Next featured night|Show \$\{event\.title\}/u);
  assert.match(experience, /className="compact-hero__image compact-hero__image--outgoing"/u);
  assert.match(experience, /className="compact-hero__image compact-hero__image--active"/u);
  assert.match(explorer, /data-featured=\{event\.slug === featuredSlug \? "true"/u);
  assert.doesNotMatch(css, /\.drop-card\[data-featured="true"\][^{]*\{[^}]*border/su);
  assert.match(css, /\.drop-card__body\s*\{[^}]*padding-top:\s*15px[^}]*\}/su);
  const discovery = await readFile(discoveryUrl, "utf8");
  assert.match(discovery, /\.active-night-autoplay-toggle:focus-visible\s*\{[^}]*height:\s*44px[^}]*clip-path:\s*none/su);
  assert.doesNotMatch(experience, /onMouseEnter|setLeftHero|Motion on|Motion off/u);
  assert.match(polish, /\.active-night-experience \.night-drop,[\s\S]*?transition:\s*background-color var\(--motion-scene\)/su);
  assert.match(polish, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.active-night-experience \.night-drop,[\s\S]*?transition:\s*none/su);
});

test("mobile customers retain wallet access and form controls do not trigger iOS zoom", async () => {
  const [css, dock] = await Promise.all([readFile(cssUrl, "utf8"), readFile(customerDockUrl, "utf8")]);

  assert.match(css, /\.customer-dock\s*\{[^}]*display:\s*none/su);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.customer-dock\s*\{[^}]*position:\s*fixed/su);
  assert.match(dock, /label: "My Nights"/u);
  assert.match(dock, /pathname\.startsWith\("\/my-nights"\)/u);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px/su);
});

test("public navigation belongs to each header on mobile and desktop", async () => {
  const [css, polish, home, about, events, help, privacy, mobileNavigation, dock] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
    readFile(homeUrl, "utf8"),
    readFile(aboutUrl, "utf8"),
    readFile(new URL("../app/events/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/help/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(mobileNavigationUrl, "utf8"),
    readFile(customerDockUrl, "utf8"),
  ]);

  for (const page of [home, about, events, help, privacy]) assert.match(page, /<PublicNavigation \/>/u);
  assert.doesNotMatch(dock, /MobileNavigation|PublicNavigation/u);
  assert.match(mobileNavigation, /href: "\/events", label: "The Drop"/u);
  assert.match(mobileNavigation, /href: "\/my-nights", label: "My Nights"/u);
  assert.match(mobileNavigation, /href: "\/organizer\/submit", label: "Organisers"/u);
  assert.match(mobileNavigation, /href: "\/about", label: "About us"/u);
  assert.match(mobileNavigation, /href: "\/help", label: "Help"/u);
  assert.match(dock, /href: "\/events", label: "The Drop"/u);
  assert.match(dock, /href: "\/my-nights", label: "My Nights"/u);
  assert.match(mobileNavigation, /aria-expanded=\{open\}/u);
  assert.match(mobileNavigation, /event\.key === "Escape"/u);
  for (const icon of ["CalendarDays", "Ticket", "UsersRound", "CalendarPlus", "Info", "LifeBuoy"]) assert.match(mobileNavigation, new RegExp(icon, "u"));
  assert.match(css, /\.night-mobile-menu\s*\{[^}]*position:\s*relative[^}]*display:\s*block/su);
  assert.match(css, /\.night-mobile-menu__trigger\s*\{[^}]*position:\s*static/su);
  assert.doesNotMatch(css, /\.night-mobile-menu__trigger\s*\{[^}]*position:\s*fixed/su);
  assert.match(css, /\.night-mobile-menu__panel\s*\{[^}]*position:\s*absolute[^}]*border-radius:\s*12px[^}]*background:\s*rgba\(18,19,17,\.68\)[^}]*box-shadow:\s*none/su);
  assert.match(css, /\.night-mobile-menu__panel\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(18px\) saturate\(\.9\)[^}]*backdrop-filter:\s*blur\(18px\) saturate\(\.9\)/su);
  assert.match(css, /\.night-mobile-menu\.is-open \.night-mobile-menu__panel\s*\{[^}]*opacity:\s*1[^}]*visibility:\s*visible/su);
  assert.match(css, /\.night-mobile-menu__panel-header\s*\{[^}]*min-height:\s*40px[^}]*display:\s*flex[^}]*border-bottom:\s*1px solid/su);
  assert.match(css, /\.night-mobile-menu__links\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*padding-top:\s*4px/su);
  assert.match(css, /\.night-mobile-menu\.is-open \.night-mobile-menu__close\s*\{[^}]*opacity:\s*1[^}]*rotate\(0\) scale\(1\)/su);
  assert.match(css, /\.night-mobile-menu \.night-mobile-menu__panel a\s*\{[^}]*min-height:\s*44px[^}]*border-radius:\s*0[^}]*color:\s*rgba\(255,255,255,\.76\)/su);
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*?\.night-mobile-menu__panel\s*\{[^}]*width:\s*min\(276px, calc\(100vw - 24px\)\)[^}]*padding:\s*5px[^}]*right:\s*0/su);
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*?\.night-mobile-menu \.night-mobile-menu__panel a\s*\{[^}]*min-height:\s*42px[^}]*font-size:\s*13px/su);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.night-mobile-menu__trigger, \.night-mobile-menu__panel, \.night-mobile-menu__close, \.night-mobile-menu__links\s*\{[^}]*transition:\s*none/su);
  assert.match(mobileNavigation, /const links = \[[\s\S]*?aria-hidden=\{!open\}[\s\S]*?tabIndex=\{open \? undefined : -1\}/su);
  assert.doesNotMatch(mobileNavigation, /night-mobile-menu__group|night-mobile-menu__label/u);
  assert.match(mobileNavigation, /night-mobile-menu__panel-header[\s\S]*?<span>Menu<\/span>[\s\S]*?night-mobile-menu__close[\s\S]*?<X size=\{19\}/su);
  assert.match(polish, /secondary customer menu[\s\S]*?\.night-mobile-menu__panel a\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/su);
  assert.match(polish, /\.night-mobile-menu__panel\s*\{[^}]*box-shadow:\s*none/su);
});

test("the program-wide type scale never returns to ant-sized visible text", async () => {
  const [css, accessPolish] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);
  const declarations = `${css}\n${accessPolish}`.matchAll(/font-size:\s*([0-9.]+)px/gu);
  const undersized = [...declarations]
    .map((match) => Number(match[1]))
    .filter((size) => size > 0 && size < 10);

  assert.deepEqual(undersized, []);
  assert.match(css, /\.main-nav\s*\{[^}]*font-size:\s*16px/su);
  assert.match(css, /\.drop-controls button\s*\{[^}]*font-size:\s*14px/su);
  assert.match(css, /\.drop-card__note\s*\{[^}]*font-size:\s*14px/su);
  assert.match(css, /\.room-message__body > header span\s*\{[^}]*font-size:\s*10px/su);
  assert.match(css, /\.room-bubble > p\s*\{[^}]*font-size:\s*16px/su);
});

test("returning buyers recover and manage the whole purchase through My Nights", async () => {
  const [myNights, hub, recoveryClaim, paymentReturn] = await Promise.all([
    readFile(myNightsUrl, "utf8"),
    readFile(nightHubUrl, "utf8"),
    readFile(new URL("../app/api/customer/recovery/claim/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/payment/return/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(myNights, /Bring back my Nights/u);
  assert.match(myNights, /Same checkout email\. One private link/u);
  assert.match(myNights, /Ticket &amp; perks/u);
  assert.match(myNights, /Enter the live Room/u);
  assert.match(hub, />Ticket \(\{tickets\.length\}\)</u);
  assert.match(hub, />Perks</u);
  assert.match(hub, />Details</u);
  assert.match(hub, />Purchase</u);
  assert.match(hub, /tierDescription/u);
  assert.match(hub, /Payment reference, totals and support/u);
  assert.match(recoveryClaim, /\/my-nights\?recovered=1/u);
  assert.match(paymentReturn, /\/my-nights\/\$\{encodeURIComponent/u);
});

test("event-day journeys remain available beyond the open browser tab", async () => {
  const [dock, hub, roomNotifications, serviceWorker, scanner] = await Promise.all([
    readFile(customerDockUrl, "utf8"),
    readFile(nightHubUrl, "utf8"),
    readFile(roomNotificationsUrl, "utf8"),
    readFile(serviceWorkerUrl, "utf8"),
    readFile(scannerUrl, "utf8"),
  ]);
  assert.doesNotMatch(dock, /href="\/notifications"/u);
  assert.match(hub, /notification-bell/u);
  assert.match(hub, /Open offline door pass/u);
  assert.match(hub, /TicketTransfer/u);
  assert.match(roomNotifications, /Notification\.requestPermission\(\)/u);
  assert.match(roomNotifications, /role="switch" aria-checked=\{enabled\}/u);
  assert.match(roomNotifications, /JSON\.stringify\(\{ enabled: next \}\)/u);
  assert.doesNotMatch(roomNotifications, /<select|Mute for|Send me a test notification|notifications\/test/u);
  assert.match(serviceWorker, /addEventListener\("push"/u);
  assert.match(serviceWorker, /showNotification/u);
  assert.match(serviceWorker, /notificationclick/u);
  assert.match(scanner, /Saved offline/u);
  assert.match(scanner, /clientScanId/u);
  assert.match(scanner, /Find a guest or purchase/u);
  assert.match(scanner, /Supervisor undo/u);
});

test("roadmap 5–7 stays inside compact existing journeys", async () => {
  const [css, support, waitlist, roomOperations, hub] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(supportCentreUrl, "utf8"),
    readFile(waitlistUrl, "utf8"),
    readFile(roomOperationsUrl, "utf8"),
    readFile(nightHubUrl, "utf8"),
  ]);
  assert.match(roomOperations, /Emergency read-only/u);
  assert.match(roomOperations, /Slow mode/u);
  assert.match(roomOperations, /Official memory/u);
  assert.match(waitlist, /private 30-minute offer/u);
  assert.match(support, /Questions, returns and event changes\./u);
  assert.match(support, /Accept new date/u);
  assert.match(support, /Request refund/u);
  assert.match(hub, /<SupportCentre slug=\{event\.slug\}/u);
  assert.match(css, /\.event-waitlist\s*\{[^}]*display:\s*grid[^}]*gap:\s*7px/su);
  assert.match(css, /\.night-support\s*\{[^}]*max-width:\s*820px/su);
});

test("checkout conversion actions look and behave like primary controls", async () => {
  const [css, checkout, layout, paymentRoute] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(new URL("../app/checkout/[slug]/checkout-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payments/initialize/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.event-page \.checkout-link\s*\{[^}]*background:\s*var\(--ink\)[^}]*font-weight:\s*600/su);
  assert.doesNotMatch(css, /\.event-page \.checkout-link(?::hover|:active)?\s*\{[^}]*box-shadow/su);
  assert.match(css, /\.pay-button\s*\{[^}]*min-height:\s*53px[^}]*background:\s*#f0ecdf[^}]*font-weight:\s*600/su);
  assert.doesNotMatch(css, /\.pay-button(?::hover:not\(:disabled\)|:active:not\(:disabled\))?\s*\{[^}]*box-shadow/su);
  assert.match(css, /\.pay-button:focus-visible\s*\{[^}]*outline:/su);
  assert.match(checkout, /payment-providers\/mtn-momo\.svg/u);
  assert.match(checkout, /payment-providers\/telecel-cash\.svg/u);
  assert.match(checkout, /payment-providers\/at-money\.svg/u);
  assert.match(checkout, /Let’s make it official\./u);
  assert.match(checkout, /Mobile Money<small>MTN MoMo, Telecel Cash or AT Money/u);
  assert.match(checkout, /Card<small>Visa or Mastercard through Paystack/u);
  assert.match(checkout, /useState<"mobile_money" \| "card" \| null>\(null\)/u);
  assert.match(checkout, /<fieldset className="payment-methods">/u);
  assert.match(checkout, /type="radio" name="paymentMethod"/u);
  assert.match(checkout, /paymentMethod === "mobile_money" \? <div className="payment-method-detail">/u);
  assert.match(checkout, /Paystack to enter your card details securely/u);
  assert.match(checkout, /payment-providers\/visa\.svg/u);
  assert.match(checkout, /payment-providers\/mastercard\.svg/u);
  assert.match(css, /\.accepted-card-brands img\s*\{[^}]*height:\s*28px/su);
  assert.doesNotMatch(checkout, /cardNumber|card_number|cvv|expiry/iu);
  assert.doesNotMatch(checkout, /Smartphone checkout/u);
  assert.match(checkout, /controller\.abort\(\), 15_000/u);
  assert.doesNotMatch(checkout, /Turnstile|turnstileToken|browser security/iu);
  assert.doesNotMatch(paymentRoute, /Turnstile|turnstileToken|browser security/iu);
  assert.match(paymentRoute, /https:\/\/api\.paystack\.co\/charge/u);
  assert.match(paymentRoute, /https:\/\/api\.paystack\.co\/transaction\/initialize/u);
  assert.match(paymentRoute, /mtn: "mtn", telecel: "vod", at: "atl"/u);
  assert.match(paymentRoute, /channels: \[paymentMethod\]/u);
  assert.match(paymentRoute, /paymentMethod === "card" \? "card" : `mobile_money:/u);
  assert.match(css, /\.payment-methods\s*\{[^}]*border:\s*0/su);
  assert.match(css, /\.payment-option\s*\{[^}]*border-top:\s*1px solid/su);
  assert.match(css, /\.card-payment-detail\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/su);
  assert.match(checkout, /authorizationUrl \?\? data\.nextUrl/u);
  assert.doesNotMatch(layout, /challenges\.cloudflare\.com/u);
});

test("customer and staff journeys do not load Cloudflare challenges", async () => {
  const paths = [
    "../app/checkout/[slug]/checkout-form.tsx",
    "../app/tickets/ticket-wallet.tsx",
    "../app/organizer/submit/submission-form.tsx",
    "../app/admin/login/login-form.tsx",
    "../app/admin/bootstrap/bootstrap-form.tsx",
    "../app/api/payments/initialize/route.ts",
    "../app/api/customer/recovery/route.ts",
    "../app/api/submissions/route.ts",
    "../app/api/admin/session/route.ts",
    "../app/api/admin/bootstrap/route.ts",
    "../worker/index.ts",
    "../.github/workflows/deploy.yml",
  ];
  const source = (await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");

  assert.doesNotMatch(source, /Turnstile|turnstileToken|challenges\.cloudflare\.com|browser security/iu);
});

test("public organiser actions keep submission public and named workspaces protected", async () => {
  const [homeShell, activeNight, organizer, submission, adminSubmissions] = await Promise.all([
    readFile(homeUrl, "utf8"),
    readFile(activeNightUrl, "utf8"),
    readFile(organizerUrl, "utf8"),
    readFile(submissionUrl, "utf8"),
    readFile(adminSubmissionsUrl, "utf8"),
  ]);
  const home = `${homeShell}\n${activeNight}`;

  assert.doesNotMatch(home, /href="\/organizer"/u);
  assert.ok(home.match(/href="\/organizer\/submit"/gu)?.length >= 2);
  assert.match(home, />List your event\s*</u);
  assert.match(organizer, /redirect\("\/organizer\/workspace"\)/u);
  assert.doesNotMatch(organizer, /ops-shell|Ticket sales|Gross sales|Attendees/u);
  assert.match(submission, /href="\/"[^>]*>.*Back to events/su);
  assert.match(submission, /className="submission-header__signin"/u);
  assert.match(submission, /aria-label="Organiser access"/u);
  assert.match(submission, /Organiser sign in/u);
  assert.match(submission, /private workspace for tickets, guest updates, entry and sales/u);
  assert.match(adminSubmissions, /readAdminSession\(request\.headers\.get\("cookie"\)\)/u);
  assert.match(adminSubmissions, /if \(!actor\) return Response\.json\([^;]+status: 401/su);
});

test("organiser consent stays aligned with the submission content on desktop and mobile", async () => {
  const [css, form] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(new URL("../app/organizer/submit/submission-form.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(form, /className="submission-consent submission-consent--check"/u);
  assert.match(css, /\.submission-form > section > \.submission-consent--check\s*\{[^}]*grid-column:\s*2 \/ -1[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\)[^}]*align-items:\s*start[^}]*text-transform:\s*none/su);
  assert.match(css, /\.submission-consent--check input\s*\{[^}]*width:\s*16px[^}]*height:\s*16px[^}]*margin:\s*4px 0 0/su);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.submission-fields label\.wide, \.submission-form > section > \.submission-consent--check\s*\{[^}]*grid-column:\s*auto/su);
});

test("organiser submission controls end in straight baselines", async () => {
  const [css, polish] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);

  assert.match(css, /\.submission-fields input, \.submission-fields select, \.submission-fields textarea[^}]*border-bottom:\s*1px solid #8d8b84[^}]*border-radius:\s*0/su);
  assert.match(polish, /Organiser submissions use one honest baseline[\s\S]*?\.submission-fields :is\(input, select, textarea\)\s*\{[^}]*border-radius:\s*0/su);
  assert.match(polish, /\.submission-fields :is\(input, select, textarea\):focus,[\s\S]*?border-bottom-color:\s*var\(--signal\)[^}]*outline:\s*0/su);
  assert.match(polish, /\.submission-consent--check input\s*\{[^}]*border-radius:\s*0/su);
});

test("About us has its own open page and no longer interrupts the landing page", async () => {
  const [home, about, css, polish] = await Promise.all([
    readFile(homeUrl, "utf8"),
    readFile(aboutUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);

  assert.match(home, /<Link href="\/about">About us<\/Link>/u);
  assert.doesNotMatch(home, /<nav aria-label="Main navigation">[^<]*(?:<[^>]+>[^<]*)*<Link href="\/hosts">/u);
  assert.doesNotMatch(home, /id="about"|className="becore-about"|Accra plans differently/u);
  assert.match(about, /className="about-page"/u);
  assert.match(about, /needed a plan/u);
  assert.match(about, /Your people are already in the Room/u);
  assert.match(about, /A good night deserves an encore/u);
  assert.match(about, /which tickets sold, which promoters brought people and when the crowd arrived/u);
  assert.match(about, /Made for how Accra moves/u);
  assert.match(home, /className="organizer-intelligence"/u);
  assert.match(home, /We’ll mind the details/u);
  assert.match(home, /MoMo, cards and ticket tiers/u);
  assert.match(css, /\.about-hero\s*\{[^}]*display:\s*grid[^}]*border-bottom:\s*1px solid #aaa79e/su);
  assert.match(css, /\.about-reasons article\s*\{[^}]*border-bottom:\s*1px solid #cbc7bd/su);
  assert.doesNotMatch(css, /\.about-(?:hero|reasons|close)[^}]*box-shadow/su);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.about-hero\s*\{[^}]*grid-template-columns:\s*1fr/su);
  assert.match(css, /\.organizer-intelligence\s*\{[^}]*grid-template-columns:/su);
  assert.match(css, /\.organizer-intelligence \.night-kicker\s*\{[^}]*color:\s*#5f5c55/su);
  assert.match(css, /\.about-hero h1\s*\{[^}]*font-size:\s*clamp\(58px, 6\.4vw, 92px\)[^}]*line-height:\s*\.88/su);
  assert.match(polish, /\.organizer-intelligence__copy > a,[\s\S]*?border-radius:\s*0/su);
  assert.doesNotMatch(css, /\.organizer-intelligence[^}]*box-shadow/su);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.organizer-intelligence\s*\{[^}]*grid-template-columns:\s*1fr/su);
});

test("first-owner setup explains its one-use key without exposing a credential", async () => {
  const [page, form, css] = await Promise.all([
    readFile(ownerBootstrapUrl, "utf8"),
    readFile(ownerBootstrapFormUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);

  assert.match(page, /Create the first owner\./u);
  assert.match(page, /closes as soon as the account is created/u);
  assert.match(form, /One-time setup key/u);
  assert.match(form, /ADMIN_ACCESS_KEY/u);
  assert.match(form, /Secrets cannot be viewed again/u);
  assert.match(form, /id="owner-name"/u);
  assert.match(form, /id="owner-email"/u);
  assert.match(css, /\.admin-bootstrap__form\s*\{[^}]*grid-template-columns:\s*repeat\(2/su);
  assert.doesNotMatch(`${page}\n${form}`, /ADMIN_ACCESS_KEY\s*=|sk_(?:live|test)_/u);
});

test("fees and named staff stay inside one compact, role-bound operations system", async () => {
  const [fees, accounts, roles, css] = await Promise.all([
    readFile(feeSettingsUrl, "utf8"),
    readFile(staffAccountsUrl, "utf8"),
    readFile(staffRolesUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(fees, /<main className="ops-page">/u);
  assert.match(fees, /<OperationsNav actor=\{actor\} role=\{role\} active="\/admin\/fees"/u);
  assert.doesNotMatch(fees, /settings-page|const links =|Platform configuration/u);
  assert.match(accounts, /className="role-boundary"/u);
  assert.match(accounts, /> Can</u);
  assert.match(accounts, /> Cannot</u);
  assert.match(accounts, /roleDefinition\.eventScoped/u);
  assert.match(roles, /support:\s*\{/u);
  assert.match(roles, /isWorkspacePathAllowed/u);
  assert.match(css, /\.role-boundary\s*\{/u);
});

test("every private workspace has one compact role-scoped navigator", async () => {
  const [jump, navigation, account, scanner, organiser, css] = await Promise.all([
    readFile(workspaceJumpUrl, "utf8"),
    readFile(operationsNavUrl, "utf8"),
    readFile(accountPageUrl, "utf8"),
    readFile(scannerUrl, "utf8"),
    readFile(organizerWorkspaceUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(jump, /STAFF_WORKSPACE_LINKS\s*\n\s*\.filter/u);
  assert.match(jump, /Open an authorised workspace/u);
  assert.match(navigation, /aria-label="Workspace navigation"/u);
  assert.match(navigation, /aria-current=\{active === item\.href \? "page"/u);
  assert.match(account, /<WorkspaceJump active="\/admin\/account" role=\{session\.role\}/u);
  assert.match(scanner, /<WorkspaceJump active="\/scan" role=\{role\}/u);
  assert.match(organiser, /<WorkspaceJump active="\/organizer\/workspace" role=\{role\}/u);
  assert.match(css, /\.curation-nav > \.workspace-jump\s*\{\s*display:\s*none/u);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.curation-nav > \.workspace-jump[^}]*display:\s*grid/su);
});

test("workplace dashboards choose one event without horizontal event rails", async () => {
  const [operations, roomOperations, organiser, css] = await Promise.all([
    readFile(eventOperationsUrl, "utf8"),
    readFile(roomOperationsUrl, "utf8"),
    readFile(organizerWorkspaceUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(operations, /className="workspace-event-picker"/u);
  assert.match(operations, /id="operations-event"/u);
  assert.match(roomOperations, /className="workspace-event-picker room-ops__event"/u);
  assert.match(roomOperations, /id="room-event"/u);
  assert.match(organiser, /className="workspace-event-picker organizer-event-picker"/u);
  assert.match(organiser, /id="organizer-event"/u);
  assert.doesNotMatch(`${operations}\n${organiser}`, /operations-event-strip|organizer-event-tabs/u);
  assert.match(css, /\.workspace-event-picker\s*\{[^}]*grid-template-columns:/su);
});

test("project dropdowns use a soft progressively enhanced picker", async () => {
  const [css, roomNotifications] = await Promise.all([
    readFile(accessPolishUrl, "utf8"),
    readFile(roomNotificationsUrl, "utf8"),
  ]);

  assert.match(css, /:where\(\.workspace-event-picker,[^}]*select\s*\{[^}]*border-radius:\s*11px/su);
  assert.match(css, /@supports \(appearance:\s*base-select\)/u);
  assert.match(css, /select::picker\(select\)\s*\{[^}]*border-radius:\s*14px/su);
  assert.match(css, /\.workspace-jump select::picker\(select\)\s*\{[^}]*border-radius:\s*13px/su);
  assert.match(css, /option:checked\s*\{[^}]*background:\s*#e9e7e0/su);
  assert.match(css, /select:open::picker-icon\s*\{[^}]*rotate:\s*180deg/su);
  assert.match(css, /\.curation-page[^}]*\.before-night[^}]*\.room-modal[^}]*\.event-waitlist/su);
  assert.doesNotMatch(`${css}\n${roomNotifications}`, /room-notifications__controls|<select/u);
  assert.match(css, /\.submission-fields\) select::picker\(select\)/u);
});

test("operations lists stay bounded and dashboard selections use straight markers", async () => {
  const [polish, orders, ordersApi, staff, room] = await Promise.all([
    readFile(accessPolishUrl, "utf8"),
    readFile(orderOperationsUrl, "utf8"),
    readFile(orderOperationsApiUrl, "utf8"),
    readFile(staffAccountsUrl, "utf8"),
    readFile(roomUrl, "utf8"),
  ]);

  assert.match(ordersApi, /const pageSize = 10/u);
  assert.match(ordersApi, /LIMIT \? OFFSET \?/u);
  assert.match(ordersApi, /orders: orders\.results, total, page, pageSize/u);
  assert.match(orders, /className="order-pagination"/u);
  assert.match(orders, /Showing \{firstVisible\}–\{lastVisible\} of \{total\}/u);
  assert.match(staff, /className=\{`staff-list__new/u);
  assert.match(staff, />New person</u);
  assert.doesNotMatch(staff, /<header><div><p>Named access only<\/p><h1>People &amp; permissions<\/h1><\/div><button/u);
  assert.match(polish, /Operational navigation uses a side marker/u);
  assert.match(polish, /\.ops-page \.curation-nav nav a\.active::after,[\s\S]*?display:\s*none/su);
  assert.match(polish, /\.ops-page \.curation-nav nav a\.active::before,[\s\S]*?width:\s*2px/su);
  assert.match(polish, /\.ops-page \.ops-main :where\(button, input, select, textarea\)[\s\S]*?border-radius:\s*0/su);
  assert.match(room, /className="room-flash-toggle"/u);
  assert.match(room, /<RoomNotifications slug=\{slug\} onNotice=\{setNotice\} \/>/u);
});

test("controls keep soft corners while information flows in open straight-edged sections", async () => {
  const [css, polish] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);
  assert.match(css, /--radius-control:\s*10px[^}]*--radius-picker:\s*11px[^}]*--radius-surface:\s*14px/su);
  assert.match(css, /\.workspace-event-picker select\s*\{[^}]*border-radius:\s*var\(--radius-picker\)/su);
  assert.match(polish, /:where\(a, button, input, select, textarea, summary\)\s*\{[^}]*border-radius:\s*var\(--radius-control\)/su);
  assert.match(polish, /Straight selection markers[\s\S]*?\.night-hub__tabs button[^}]*\)\s*\{[^}]*border-radius:\s*0/su);
  assert.match(polish, /My Nights overview actions are ruled rows[\s\S]*?\.night-overview article > div > :is\(button, a\)\s*\{[^}]*border-radius:\s*0[^}]*appearance:\s*none/su);
  assert.match(polish, /\.scene-host\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/su);
  assert.match(css, /\.compact-hero__copy > div a, \.compact-hero__single\s*\{[^}]*border:\s*1px solid/su);
  assert.doesNotMatch(polish, /\[class\*="-(?:card|panel|surface|notice|alert|message|editor|table|pass|state)"\][\s\S]*?border-radius:\s*var\(--radius-surface\)/su);
  assert.match(polish, /Open-flow interface contract[\s\S]*?\.operations-metrics,[\s\S]*?\.organizer-portfolio > div\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent/su);
  assert.match(polish, /\.operations-grid > section,[\s\S]*?\.organizer-answers article\s*\{[^}]*border-top:\s*1px solid var\(--flow-strong\)[^}]*border-radius:\s*0[^}]*background:\s*transparent/su);
});

test("the interface has no effective shadows, tinted fills or curved text-edge controls", async () => {
  const [css, polish] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);
  assert.match(polish, /Absolute flatness contract:[\s\S]*?\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-shadow:\s*none !important[^}]*text-shadow:\s*none !important/su);
  assert.doesNotMatch(`${css}\n${polish}`, /filter\s*:\s*drop-shadow/iu);
  const shadowValues = [...`${css}\n${polish}`.matchAll(/box-shadow:\s*([^;}]+)/gu)].map((match) => match[1].trim());
  assert.ok(shadowValues.length > 0);
  assert.ok(shadowValues.every((value) => value.startsWith("none")), `non-flat shadow declarations: ${shadowValues.filter((value) => !value.startsWith("none")).join(", ")}`);

  assert.match(polish, /Straight selection markers[\s\S]*?\.drop-controls button\[aria-selected="true"\]::after,[\s\S]*?\.room-modes > button\.active::after\s*\{[^}]*display:\s*block[^}]*transform:\s*scaleX\(1\)/su);
  assert.doesNotMatch(css, /\.drop-controls button\[aria-selected="true"\]\s*\{[^}]*border-color:\s*var\(--signal\)/su);
  assert.match(css, /\.drop-vibes button\[aria-selected="true"\]\s*\{[^}]*background:\s*transparent/su);
  assert.match(polish, /\.drop-vibes button,[\s\S]*?\.drop-vibes button\[aria-selected="true"\]\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/su);
  assert.match(css, /\.curation-list > button\.active\s*\{[^}]*background:\s*transparent/u);
  assert.match(css, /\.curation-list > button\.active::before\s*\{[^}]*background:\s*#171713/su);
  assert.doesNotMatch(css, /\.curation-list > button\.active\s*\{[^}]*box-shadow/su);
  assert.doesNotMatch(css, /\.curated-card\.is-picked \.curated-card__image\s*\{[^}]*box-shadow/su);
  assert.doesNotMatch(css, /\.room-product-phone\s*\{[^}]*box-shadow/su);
  assert.doesNotMatch(css, /\.night-room-device\s*\{[^}]*box-shadow/su);
  assert.doesNotMatch(css, /\.night-room-message(?:--right)? > span\s*\{[^}]*box-shadow/su);
  assert.match(polish, /\.room-message\.announcement\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent/su);
  assert.match(polish, /\.room-message\.announcement \.room-bubble\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent/su);
  assert.match(polish, /\.room-message__actions button\.active\s*\{[^}]*background:\s*transparent[^}]*text-decoration:\s*underline/su);
  assert.match(polish, /Flat-surface contract:[\s\S]*?\.submission-error,[\s\S]*?\.curation-error,[\s\S]*?background:\s*transparent !important/su);
  assert.match(polish, /\.quantity-control button\s*\{[^}]*border:\s*0[^}]*border-bottom:\s*1px solid currentColor[^}]*border-radius:\s*0[^}]*background:\s*transparent/su);
  assert.match(polish, /\.event-rail-status button\s*\{[^}]*border:\s*0[^}]*border-bottom:\s*1px solid currentColor[^}]*border-radius:\s*0[^}]*background:\s*transparent/su);
  assert.match(polish, /\.network-list button\.selected\s*\{[^}]*border-bottom-color:\s*var\(--ink\)/su);
  assert.match(polish, /\.ops-record-list button,[\s\S]*?\.ops-record-list button\.active\s*\{[^}]*border:\s*0[^}]*border-bottom:\s*1px solid #c8c4ba[^}]*background:\s*transparent/su);
  assert.match(polish, /\.support-ops__layout\s*\{[^}]*border:\s*0[^}]*border-top:\s*1px solid #aaa79f[^}]*border-radius:\s*0/su);
  assert.match(polish, /\.status,[\s\S]*?\.order-status\s*\{[^}]*border:\s*0 !important[^}]*background:\s*transparent !important/su);
  assert.match(polish, /\.help-audiences button\.active::after\s*\{[^}]*transform:\s*scaleX\(1\)/su);
  assert.match(polish, /\.room-ops__panel,[\s\S]*?\.organizer-answers article\s*\{[^}]*background:\s*transparent/su);
  assert.match(polish, /\.help-contact article p a,[\s\S]*?\.drop-rail-status button,[\s\S]*?\.night-purchase__support a\s*\)\s*\{[^}]*border-radius:\s*0/su);
  assert.match(polish, /\.room-vip-modal nav button\s*\{[^}]*border-radius:\s*0/su);
  assert.match(polish, /Mobile tap-target contract:[\s\S]*?:root\s*\{[^}]*--tap-target:\s*44px[^}]*\}[\s\S]*?@media \(pointer:\s*coarse\), \(max-width:\s*700px\)/su);
  assert.match(polish, /@media \(pointer:\s*coarse\), \(max-width:\s*700px\)[\s\S]*?\.notification-bell,[\s\S]*?\.quantity-control button,[\s\S]*?\.room-message__actions button,[\s\S]*?min-width:\s*var\(--tap-target\)[^}]*min-height:\s*var\(--tap-target\)/su);
  assert.match(polish, /\.submission-header__actions a\s*\{[^}]*border-radius:\s*0/su);
  assert.match(polish, /Interface legibility contract:[\s\S]*?\.analytics-controls label,[\s\S]*?\.analytics-table span small,[\s\S]*?font-size:\s*12px/su);
  assert.match(css, /\.flash-card__closed\s*\{[^}]*background:\s*#181915/su);
  assert.match(css, /\.room-flash-message__closed\s*\{[^}]*background:\s*#181915/su);
  assert.doesNotMatch(css, /\.(?:flash-card__closed|room-flash-message__closed)[^{]*\{[^}]*gradient/su);
  assert.match(css, /\.night-room-showcase::before\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(css, /\.night-room-peek__stream\s*\{[^}]*radial-gradient/su);
});

test("Room moderation stays scoped and the last mobile cascade prevents focus zoom", async () => {
  const [roomOperations, css, finalCascade] = await Promise.all([
    readFile(roomOperationsUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(accessPolishUrl, "utf8"),
  ]);

  assert.match(roomOperations, /selectedReports = reports\.filter\(\(report\) => report\.eventSlug === eventSlug\)/u);
  assert.match(roomOperations, /selectedFlashReports = flashReports\.filter\(\(report\) => report\.eventSlug === eventSlug\)/u);
  assert.match(roomOperations, /selectedSuspensions = suspensions\.filter\(\(item\) => item\.eventSlug === eventSlug\)/u);
  assert.match(roomOperations, />Conversation</u);
  assert.match(roomOperations, />Host update</u);
  assert.match(roomOperations, />Official memory</u);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.curation-workspace\s*\{[^}]*grid-template-columns:\s*1fr[^}]*overflow:\s*visible/su);
  assert.match(finalCascade, /@media \(max-width: 700px\)[\s\S]*?input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),[\s\S]*?font-size:\s*16px !important/su);
});

test("staff passwords derive in the browser and never ask the Worker to exceed its PBKDF2 cap", async () => {
  const [form, client, session, adminSession] = await Promise.all([
    readFile(ownerBootstrapFormUrl, "utf8"),
    readFile(staffPasswordClientUrl, "utf8"),
    readFile(new URL("../lib/admin-session.ts", import.meta.url), "utf8"),
    readFile(adminSessionUrl, "utf8"),
  ]);
  assert.match(form, /prepareStaffPassword/u);
  assert.match(client, /iterations:\s*passwordIterations/u);
  assert.match(client, /PASSWORD_ITERATIONS/u);
  assert.match(adminSession, /passwordSalt/u);
  assert.doesNotMatch(session, /node:crypto|deriveBits|nodePbkdf2/u);
  const loginPost = adminSession.split("export async function POST")[1].split("export async function PUT")[0];
  assert.doesNotMatch(loginPost, /body\.password\b/u);
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

test("help is searchable by role and organiser records follow the verified submission identity", async () => {
  const [help, organizerWorkspace, organizerWorkspaceApi, adminSubmissions, css] = await Promise.all([
    readFile(helpCentreUrl, "utf8"),
    readFile(organizerWorkspaceUrl, "utf8"),
    readFile(organizerWorkspaceApiUrl, "utf8"),
    readFile(adminSubmissionsUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(help, /Search BeCore Help/u);
  assert.match(help, /"Going out", "Organising", "At the door", "The Room"/u);
  assert.match(help, /Frequently needed/u);
  assert.match(help, /verified organiser email used on the submission/u);
  assert.match(help, /Understand what moved your Night/u);
  assert.match(help, /href: "\/organizer\/analytics", label: "Open organiser analytics"/u);
  assert.match(organizerWorkspace, /Your organiser record/u);
  assert.match(organizerWorkspace, /Submission trail/u);
  assert.match(organizerWorkspace, /data\.events\.reduce/u);
  assert.match(organizerWorkspaceApi, /submission\.contact_email = \?/u);
  assert.match(organizerWorkspaceApi, /WHERE contact_email = \?/u);
  assert.match(adminSubmissions, /db\.insert\(staffEventAssignments\)/u);
  assert.match(css, /\.help-page > \.help-centre > \.help-guides\s*\{[^}]*grid-template-columns:\s*repeat\(2/su);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.help-page > \.help-centre > \.help-guides\s*\{[^}]*grid-template-columns:\s*1fr/su);
  assert.match(css, /\.organizer-portfolio > div\s*\{[^}]*grid-template-columns:\s*repeat\(5/su);
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
    readFile(activeNightUrl, "utf8"),
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
  assert.match(home, /active\?\.image/u);
  assert.match(wallet, /\/api\/customer\/recovery/u);
});

test("public browsing is edge-cached without caching private customer journeys", async () => {
  const worker = await readFile(workerUrl, "utf8");
  assert.match(worker, /path === "\/" \|\| path === "\/about" \|\| path === "\/events" \|\| path === "\/hosts"/u);
  assert.match(worker, /\^\\\/event\\\//u);
  assert.match(worker, /headers\.delete\("set-cookie"\)/u);
  assert.match(worker, /ctx\.waitUntil\(edgeCache\.put\(cacheKey, secured\.clone\(\)\)\)/u);
  assert.match(worker, /x-becore-edge-cache/u);
  assert.doesNotMatch(worker, /eligible[^;]+(?:checkout|payment|tickets|my-nights|room)/su);
});

test("homepage footer stays useful without duplicating the customer dock", async () => {
  const [home, css] = await Promise.all([readFile(homeUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(home, /href="\/admin\/login">Event staff/u);
  assert.match(home, /href="\/organizer\/submit">Organisers/u);
  assert.match(home, /href="\/about">About us/u);
  assert.match(home, /href="\/help">Help/u);
  assert.doesNotMatch(home, /compact-footer[\s\S]*href="\/events">The Drop/u);
  assert.doesNotMatch(home, /compact-footer[\s\S]*href="\/my-nights">My Nights/u);
  assert.match(css, /\.night-footer > p\s*\{[^}]*color:\s*#898a83/su);
});

test("Flashes are camera-first and stay closed until tapped", async () => {
  const [panel, room] = await Promise.all([
    readFile(new URL("../app/room/[slug]/flashes-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/room/[slug]/room-client.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /navigator\.mediaDevices\.getUserMedia/u);
  assert.match(panel, /canvas\.toBlob/u);
  assert.doesNotMatch(panel, /type="file"/u);
  assert.match(panel, /className="flash-card__closed"/u);
  assert.match(room, /className="room-flash-message__closed"/u);
  assert.match(panel, /Delete this Flash for good\?/u);
  assert.doesNotMatch(panel, /window\.confirm/u);
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.room-flash-message__closed\s*\{[^}]*min-height:\s*50px[^}]*display:\s*flex/su);
  assert.doesNotMatch(css, /\.room-flash-message__closed\s*\{[^}]*min-height:\s*145px/su);
});

test("semantic states and route-matched skeletons stay accessible", async () => {
  const [css, skeleton, eventsLoading, roomLoading, wallet] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(new URL("../app/loading-skeleton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/events/loading.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/room/[slug]/loading.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tickets/ticket-wallet.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /--status-success:/u);
  assert.match(css, /--status-warning:/u);
  assert.match(css, /--status-danger:/u);
  assert.match(css, /--status-info:/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*skeleton/su);
  assert.match(skeleton, /aria-busy="true"/u);
  assert.match(skeleton, /className="sr-only"/u);
  assert.match(eventsLoading, /LoadingSkeleton/u);
  assert.match(roomLoading, /kind="room"/u);
  assert.match(wallet, /kind="wallet" label="Preparing your entry passes"/u);
});

test("public typography keeps compact copy readable without shrinking header labels", async () => {
  const [css, about, events, hosts, host, privacy, nights, submission] = await Promise.all([
    readFile(new URL("../app/access-polish.css", import.meta.url), "utf8"),
    readFile(new URL("../app/about/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/events/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hosts/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hosts/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/account/privacy/privacy-settings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/my-nights/my-nights-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/organizer/submit/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /font-size:\s*12px\s*!important/u);
  assert.match(css, /\.submission-intro h1\s*\{[^}]*font-size:\s*clamp\(48px,\s*5\.5vw,\s*76px\)/su);
  assert.match(css, /\.submission-page\s*\{[^}]*--signal:\s*#bd3f11/su);
  assert.match(css, /\.directory-header__back-label\s*\{[^}]*display:\s*none/su);
  for (const source of [about, events, hosts, host, privacy, nights]) {
    assert.match(source, /className="directory-header__back-label"/u);
    assert.match(source, /aria-label="Back to /u);
  }
  assert.match(submission, /className="submission-header__back" aria-label="Back to events"/u);
});

test("organiser analytics has a dedicated compact responsive workspace", async () => {
  const [page, client, api, roles, css, wrangler, migration] = await Promise.all([
    readFile(new URL("../app/organizer/analytics/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/organizer/analytics/organizer-analytics.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/organizer/analytics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/staff-roles.ts", import.meta.url), "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0023_organizer_analytics_hardening.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /requireAdminSession\("\/organizer\/analytics", "organizer\.workspace"\)/u);
  assert.match(client, /Last 7 days/u);
  assert.match(client, /Last 30 days/u);
  assert.match(client, /Last 90 days/u);
  assert.match(client, /Export CSV/u);
  assert.match(client, /Booking funnel/u);
  assert.match(client, /Ticket-tier performance/u);
  assert.match(client, /Promoter performance/u);
  assert.match(client, /Check-in timing/u);
  assert.match(api, /This Night is not assigned to your organiser account/u);
  assert.match(api, /no-store, private/u);
  assert.match(api, /COUNT\(DISTINCT lower\(customer_email\)\)/u);
  assert.match(api, /ANALYTICS_RATE_LIMITER/u);
  assert.match(api, /organizer\.analytics_exported/u);
  assert.match(api, /\^\\s\*\[=\+\\-@\]/u);
  assert.match(api, /GROUP BY day ORDER BY day LIMIT 400/u);
  assert.match(wrangler, /"name": "ANALYTICS_RATE_LIMITER"/u);
  assert.match(migration, /orders_analytics_event_status_date_idx/u);
  assert.match(migration, /tickets_analytics_event_status_checkin_idx/u);
  assert.match(roles, /path === "\/organizer\/analytics"/u);
  assert.match(css, /\.analytics-controls \{[^}]*grid-template-columns:/su);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.analytics-layout \{[^}]*grid-template-columns: 1fr/su);
  assert.match(css, /\.analytics-table \{[^}]*overflow-x: auto/su);
});
