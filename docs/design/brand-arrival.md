# Browser opening scene

A progressive enhancement for a fresh browser document, including an installed PWA start at `/my-nights?source=pwa`. It is not a native launch screen. The real destination remains mounted; there is no redirect, video, dependency, API call, persistent once-per-session flag, body scroll lock, focus trap or inert page.

## Approved sequence

The 2-second SVG/CSS scene uses the existing orange `/brand/becore-ticket.webp` asset. TICKETS is visible first. BeCore drops and bounces above it, the emblem drops beside the stacked wordmark, then the adjacent arched doorway opens. The complete compact lockup enters together and the portal reveals the actual page underneath. Typography follows the system stack. The Skip target is at least 44 by 44 CSS pixels.

## Entry and exit rules

- New navigation or reload on public browsing routes and exact `/my-nights` may show. Internal client navigation, restored history documents, bfcache, foreground resume and discarded/prerendered documents do not replay it.
- Checkout, payment, RSVP/access recovery, ticket/QR, scanning, Room, organizer/admin and unknown entry routes bypass it. Callback intent is checked against both the initial navigation URL and current URL, including callback parameters and known payment/authentication referrers. Public event referral links still work.
- Reduced motion, a page already used or scrolled, delayed script/mount, missing styles, missing logo, hidden document or unavailable lifecycle APIs skip the decoration. This deliberate fail-open behavior takes priority over showing a scene on a slow or interrupted opening.
- Skip, any pointer tap, keyboard input, scrolling, backgrounding, pagehide, history/URL change or a reduced-motion preference change dismiss it. Dismissal is permanent for that document. A tap on the scene is consumed, not forwarded to a concealed action.
- The default server markup is hidden. JavaScript installs an independent 2-second cleanup timer before revealing it, and CSS independently ends both visibility and hit testing at 2 seconds. No completion event is required. Cleanup removes listeners, timers and animation frames; it never modifies the actual page.

## Verification

`tests/brand-arrival.test.mjs` exercises the real controller with deterministic clocks and document events, plus actual server markup. `tests/e2e/brand-arrival.spec.ts` renders the real React component, stylesheet and logo in an isolated browser fixture. It covers mobile/desktop rendering, native pointer dismissal, failure paths, reload, target preservation, reduced motion, CSS-only deadline, and the compact assembled geometry.

Before release, run the browser specification in desktop Chromium, mobile Chromium and mobile WebKit, then inspect the full application on homepage and `/my-nights`. Verify real back/forward cache and installed-PWA close/reopen versus foreground resume on a device; synthetic lifecycle events are not evidence of OS launch behavior. Compare the 1.07-second assembled frame and full motion against the approved preview. Keep a production browser check of the actual security policy and hydration path as a release gate.
