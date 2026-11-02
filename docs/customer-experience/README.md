# Customer experience review — source preview, not deployed

Base: `32b5956549cb3eff04e2abbcfda177bccb07b0f8` (verified current main when this task began).
Branch: `feat/customer-experience-20261102`.

## What had actually shipped before this pass

Verified that the six customer files from
`01ca0fec952de1766d9ac42fb222a0c16f34d247` are unchanged in this base:

- The Drop: applied-filter summary and a reset action with restored focus.
- Checkout: invalid-field state, associated inline errors, email input settings.
- RSVP: opening/closing focus, error alerts, email input settings.
- My Nights: tab changes reset search and use browser history.

That was an interaction/accessibility pass, not a customer redesign. It did not
change event-page layout, ticket-selection layout, customer navigation, the
signed-out recovery screen, My Nights card layout, or Yorke. With an empty public
catalogue the filter changes were not even visible. The old empty state also
pointed customers at organiser submission.

## This pass

| Screen | Visible change | Existing behaviour retained |
| --- | --- | --- |
| Empty Home/The Drop | Compact “No upcoming nights announced” state with My Nights and Explore hosts links; no organiser task or invented event | Empty catalogue remains empty; no signup or booking is enabled |
| The Drop | Direct My Nights header link; visible native Area/Music selectors; compact heading; useful full-width single-result row on phones | Search, dates, filters, pagination, imagery and browsing state |
| Event page | My Nights header link; Tickets & entry / RSVP details / Get event updates jump to the existing panel; shorter uncropped mobile poster and compact facts | Existing availability, stale-state and registration guards; same destinations and poster assets |
| Checkout | Explicit quantity label; optional discount-code disclosure; active/stale code summary; shorter section spacing and order summary | Prices, fees, inventory limits, provider selection, consent, idempotency and payment logic |
| My Nights, signed out | Clear “Find your tickets & RSVPs” and “Email my access link”; compact form, no full-height photo overlay | Same recovery endpoint, duplicate guard and privacy-preserving responses; no new signing gate |
| My Nights, member | Smaller headings, plain underlined tabs and denser event rows without the next-night tinted panel; date/time inline where space permits | Ticket/RSVP passes, Room access, update links, roles and entitlement rules |
| RSVP | Faster access to existing form through the event-page jump | Standalone RSVP form and approval/confirmation flow are not redesigned |

System font, product palette, existing icons and event assets remain. No new
BoardUI component or dependency is claimed; native controls suit these customer
flows. No Room/Flashes or Yorke source was changed. Yorke remains early-access
signup/withdrawal, not an invented invitation-response booking flow.

## Visual review

`evidence/before/` and `evidence/after/` contain matched 1440×1000, 390×844 and
320×740 Chromium renders of empty discovery, one-event browsing, event details,
checkout, RSVP, member My Nights and signed-out recovery. These are real source
components with fictional data and existing public artwork; no production data.

For the same 390px fixtures: checkout falls from 2080px to 1736px; the event page
from 1950px to 1763px; four My Nights records from 1606px to 1332px. These are
fixture comparisons, not claims about every event or device. RSVP form height is
unchanged. Empty/recovery screens retain viewport height but have less content
and clearer next actions. See `evidence/comparison.json`.

Inspected phone empty/browse/recovery/checkout/event/My Nights, narrow empty/browse,
and desktop recovery. Added a geometric check that the header logo and navigation
do not overlap. An initial 320px collision was corrected. Scoped axe checks caught
a skipped empty-state heading level; the directory now uses h2, Home retains h3.
Independent read-only source review found no high-priority flow blockers.

## Verification

- Full existing npm test: 1,868 passed (75 tooling, 324 repository, 308 UI,
  11 password client, 5 rendered, 1,145 Worker tests across 90 files).
- After final accessibility/CSS adjustments: affected empty-state regressions,
  typecheck, lint, production build/local preparation and rendered tests rerun.
- Lint has zero errors and four existing warnings. Root/mobile dependency audits
  both report zero vulnerabilities. No dependencies changed.
- Synthetic browser checks at desktop/390px/320px cover empty-state customer
  destinations, direct filters, reset/search/date/pagination, admission panel
  focus and closed/cancelled guards, coupon apply/remove/stale state, quantity
  limits/totals, field validation, duplicate/interrupted submissions, preserved
  payment idempotency key, unchecked optional consent, RSVP draft retention,
  My Nights loading/error/retry/empty/tab history, and menu/notification focus.
- Recovery submissions and payments are intercepted synthetic failures; no emails,
  purchases, registrations, credentials or production requests are executed.
- Targeted accessibility scans cover empty state, visible filters, checkout input
  feedback. Every captured page checked for horizontal overflow; header bounds
  checked at all three widths.

Updated existing empty-state/copy/filter test expectations to match intentional
UI changes, including the existing iPhone capture helper's empty heading. No test
was removed or skipped. Release controls, inventories and workflows are unchanged.

## Reproduction and limits

Run `node scripts/customer-experience/serve.mjs`, then
`node scripts/customer-experience/check.mjs` and
`node scripts/customer-experience/capture.mjs after`.
The server is local-only at 127.0.0.1:8898 and rejects real API traffic; Playwright
supplies synthetic responses. Source base snapshots were captured before edits.
This address is not a user-accessible hosted preview.

Physical iPhone/Safari/WebKit and complete browser-to-database checkout remain
unrun. Existing Worker/Room/Flashes regressions are separate evidence, not a claim
that their visual journeys were newly reviewed. No live E2E or provider call.
No Library upload or previously blocked HTTP request was retried. Screenshots are
preserved with the branch. Review the visible changes before any deployment.

Candidate and current main workflow triggers were inspected before publishing;
no push selector matches this branch. Branch publication only: no PR, workflow
dispatch, merge, deployment or release-admission change. Release verification is
owned elsewhere and none of its gates is declared resolved by this preview.

## Compiled follow-up

The subsequent customer completion pass adds Home/Hosts customer actions, narrow filter fixes, deliberate control/icon review and a discount-label contrast fix. See [compiled verification and scope ledger](COMPILED-VERIFICATION.md) for actual browser-to-server journeys, fresh screenshots, final checks and remaining limits. Original before/after images above are intentionally unchanged.
