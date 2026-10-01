# Discovery and pass access

## Product direction

Use BlacVolta's clear date-led discovery as a reference while preserving BeCore's plum/lime identity, complete posters and Home / The Drop / My Nights navigation. The Room remains a useful private event connection, not a claim of competitor exclusivity. Existing marketing already demonstrates host updates, Flashes and concierge; do not duplicate those sections.

## This increment

- Shared Home/Drop Tomorrow filter; a native date input on The Drop. Explicit dates and Tomorrow follow Accra calendar dates; Tonight retains the existing 06:00 night boundary.
- Earliest scheduled events first, undated listings last. Clamp retained pagination when the live catalogue shrinks. Keep filters across in-session navigation.
- Refresh date-dependent actions every minute and on tab focus/visibility restoration.
- My Nights leads with the ticket/RSVP pass for scheduled active events. The Room is a secondary destination. Past nights appear newest first.
- A network or service failure loading a night offers retry; only authorization errors show recovery. Optional Wallet configuration failure does not hide passes. Failed preference writes release the busy state and preserve answers.
- Ended, postponed and cancelled events have truthful countdown labels.

## Verification

Date-boundary unit tests and browser regressions cover date selection/back/clear, direct pass access, and failed night load/retry with optional Wallet failure. Existing candidate CI exercises the full public, payment, registration and operations journeys across desktop Chromium, mobile Chromium and mobile WebKit. Shared-client build and browser checks remain required, with macOS app/web layout comparison.

## Explicit remaining launch gates

Native secure account handoff/storage, logout/revocation and physical-device payment return remain unfinished as documented in docs/mobile/shared-customer-screens.md. Public screen parity is not shared authentication. Apple Wallet PR 138 requires separate review and signer/certificate production configuration; never show automatic updates as active based on a build alone.

Production payment activation still requires the existing provider/account checks. Recurring host participation requires real organizers and events: prioritize their existing submission, guest list and announcement workflows; do not invent listings or send unsolicited outreach. Track discovery-to-booking completion, successful pass retrieval, entry success and host response behavior with privacy-conscious aggregate reporting before broadening lifestyle categories.

## 1 October 2026: discovery and related view selectors

Approved refinement from production `4cd96fb13e99b4eddd22466e03142d934b4bba49`:
compact segmented date selection; count and Filters on one row; closer heading,
selector and cards; consistent My Nights, guest and organizer view switches.
The shared presentation component retains caller-owned selection, URL/history,
loading guards and business logic. No payment, RSVP, date-matching, permission,
data, schema or migration change. Neutral surfaces preserve the Tickets palette.

Accessibility: 44px minimum targets; wrapping at narrow widths; visible keyboard
focus; reduced-motion and opaque surfaces; forced-colors selection; printed
passes keep view navigation hidden. The indicator tracks real control geometry
on selection and resize, with a static server-rendered fallback.

Source review found and resolved forced-colors and print-cascade regressions.
Local type/lint, aggregate application and VPS suites passed during implementation;
final-revision aggregate and hosted desktop Chromium/mobile Chromium/mobile
WebKit, native/iPhone and release-operator gates remain required before release.
Local browser launch is socket-restricted, so hosted screenshots are the visual
review evidence. Release must preserve current rollback and verify exact live SHA.
