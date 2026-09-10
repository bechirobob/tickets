# Full interface and preview cleanup audit — 10 September 2026

User request: review the entire design, including closed sections; remove technical copy and decorative curves/glows; erase preview cases; allow the master account to remove staff; keep guest email lists compact.

## Baseline

Main and production: `9de60786ec25d59e488ebe1faadf89a58d1be9d3` (PR 121). The prior audit checked top-level screens but left organizer task forms inside a large closed panel. Public help and account device disclosures also needed expanded-state review.

Read-only production inventory: Actions run 34426444988. Retired previews are `after-dark-osu` (32 orders), `noir-room-labone` (1), and `longitude-spintex` (0). The three are explicitly marked test events; their older Paystack environment fields are null. No explicitly live payment is present. `sun-chasers-labadi` is now the real **On The Guest List** event despite its legacy preview IDs; preserve the listing and settings. Inventory run 34429241197 identified its one legacy preview booking (11 August), with no provider transaction or verification, before the 8 September conversion in commit 5283b5a. Remove that exact booking and pre-conversion guest/Room content; preserve later content. The Weekend Braai has one current RSVP; preserve it. The rejected Bomboclart Parties submission has no evidence identifying it as a preview; preserve it.

## Changes

- Organizer task navigation: RSVP & guests, Event & sales, Room & VIP, Entry team, Requests. Forms stay mounted so changing views retains drafts. Event history remains a compact disclosure.
- Full workspace controls and expanded surfaces: tier editor, device list, staff roles/assignments, activity, order filters, VIP settings, guest answers, support, fees, promoter links and analytics.
- Guest emails default to counts and search. No individual contacts are fetched in summary mode. The opened table uses ten rows per page, server-side search, CSV export and subscription status.
- Plain public/organizer guidance replaces technical descriptions of internal processing. Staff account, login and Room labels use neutral task names. Help instructions match the new organizer views.
- Removed the Drop's decorative radial colour glow. Artwork remains complete and its softened backdrop stays within the flier frame. Expanded help and guest support use complete surfaces instead of curved partial outlines.
- Owner-only account removal deletes credentials, sessions, recovery access and event assignments. Self-removal and removing the last active owner are blocked. Past operational work remains attributable in the audit history.
- One-time preview cleanup runs only after the release job records the owner's authorization. It erases the retired event graphs, test purchases on current listings, retired preview ticket tiers, associated media/Room stores, event-specific fee rules and unshared preview customer accounts. The converted listing keeps its Room settings and content after publication. Shared customers and real bookings remain. The temporary retry manifest is replaced with aggregate counts after success. No messages are sent to guests.
- The production schedule no longer refreshes preview event dates.

## Coverage map

| Area | Views/states covered by the audit suite |
| --- | --- |
| Public discovery | Home, Drop, both real event pages, Hosts, host detail/empty state, About |
| Public forms | RSVP form/success/failure, checkout availability, submission fields, ticket recovery, privacy and terms |
| Guest workspace | My Nights, ticket wallet, notifications, Room messages and announcements, Flashes, VIP, support |
| Operations | Every navigation destination, expanded details, account devices, staff removal confirmation and failure |
| Organizer | History open; every task view; RSVP advanced options; email summary/search/pagination; announcement preview/history; analytics |
| Viewports | Desktop Chromium, mobile Chromium, mobile WebKit; narrow event lettering covered by existing fixtures |

The browser suite opens disclosures before accessibility and visual-contract checks. Private state is tested with isolated CI identities; real customer accounts and real guest submissions are not used for test writes. Screenshots are reviewed from CI artifacts. Production checks verify the deployed SHA and cleanup receipt separately.

## Release record

Local unit, rendered, type, lint and browser results, final SHA, deployment ID, cleanup counts and production verification are recorded in the PR as they complete. The release captures a D1 recovery bookmark before any changes. Code rollback cannot recreate deliberately erased preview records; use the recorded bookmark only if a verified restoration is needed.

Design reference: [Carbon accordion guidance](https://carbondesignsystem.com/components/accordion/usage/) supports concise disclosure titles and recommends task views for large sections. BeCore retains its own typography, aubergine identity and event artwork.
