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
