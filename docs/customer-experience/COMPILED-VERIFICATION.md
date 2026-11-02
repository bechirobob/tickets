# Compiled customer verification

> Current status (2026-11-02): see [release readiness](RELEASE-READINESS.md). Hosted full Chromium/WebKit journeys and the focused390px WebKit empty capture are now accepted. Earlier pending/unavailable statements below describe their original checkpoint, not the current status. No deployment or release admission is claimed.

This extends the source-component preview with the compiled application served by a local Miniflare Worker and a dedicated temporary D1 database. It is not a hosted preview, deployment, or physical iPhone test. The original `evidence/before` and `evidence/after` comparison remains immutable; newer screenshots live in `evidence/compiled`.

## Additional customer corrections

- Home's Meet the Hosts area now leads to host discovery and upcoming nights. Its copy describes customer tickets, Room and host updates rather than selling events. The established photograph remains.
- Hosts' empty state offers Explore nights without claiming there are events. About's secondary action also leads to Hosts.
- Organiser submission remains in the explicitly labelled menu/footer and the Organising help guide. Organiser workspaces retain their proper submission actions.
- The music default is “All music”; below 360px the two labelled filters stack so longer selected values remain readable.
- Existing customer action icons retain their positions and reserved space, with their decorative shaded tiles removed. Host verification badges align with their text. The mobile event loading placeholder matches the compact 300px poster.
- The expanded discount label now inherits the light summary text colour; the compiled axe scan found its previous dark label failed contrast.

## Journey and safety boundaries

`node scripts/customer-experience/compiled-check.mjs` migrates a new local-only database, seeds five fictional events, four fictional paid bookings and one ephemeral attendee session, then removes all state. The seeded session verifies existing-booking views; it does **not** prove email delivery or a real email-link claim. There are no staff accounts or persistent credentials. The existing nonfunctional `sk_test_ui_fixture` value exposes the payment UI. Worker outbound requests return 503; non-local browser requests are aborted. There are no production bindings or email queues.

The browser exercises actual first-party HTTP handlers, without mocking API responses:

- Home and Hosts customer actions; directory filtering, reset, zero events, 320px long selected value.
- Event → existing ticket panel → checkout; invalid coupon and actual valid coupon quotation; required customer fields, separate mandatory consent and optional updates; an interrupted provider request reaches the saved-order “Don’t pay again” page.
- Event → existing RSVP form → locally confirmed RSVP and QR-pass action, optional announcements unchecked. Three local records are asserted.
- Signed-out recovery for an unknown fictional address returns the privacy-preserving response; no email is sent. Existing bookings use the seeded local attendee identity and actual My Nights API; search, tabs, Back/Forward and ticket/Room actions remain.
- Existing header menu/close and notification icon: accessible names, 44px targets, keyboard opening, Escape and focus return. No navigation system was added or replaced.
- Yorke early-access form: required fields/consent, keyboard validation and accessibility. No signup/withdrawal response is sent.
- Axe scans cover discovery, expanded checkout, RSVP form, My Nights and Yorke. Chromium runs at 1440×1000, 390×844 and 320×740. The mobile runs simulate viewport/touch; they are not physical Safari/iPhone validation.

## Original scope reviewed and retained

Yorke is an existing early-access signup/withdrawal journey, not a ticket invitation. Its duplicate guards, timeout/retry handling, consent and success focus are appropriate and preserved. My Nights access retains explicit claim actions and safe redirects. Header panel/history helpers retain Back/Escape, hidden-panel handling, loading, locked, empty, retry and focus behavior. Global errors already provide retry/My Nights and discourage repeat payment after uncertainty. Room/Flashes assets, behavior and APIs were not restyled or rewritten; the existing Worker regressions remain part of validation.

No payment provider success, email delivery, actual email-link claim, live purchase, physical iPhone or WebKit result is claimed. WebKit's expected executable is absent; no browser download was attempted. Earlier blocked transfers were not retried. No Library upload IDs or hosted preview URL exist for this increment.

## Evidence

See [machine results](evidence/compiled/results.json) for exact source, browser, checks and cleanup. Screenshots are actual compiled local pages with fictional records. Existing branding/artwork is real; pictured event data is fictional.

| Screen | Desktop | 390px | 320px |
|---|---|---|---|
| Home / Hosts section | [desktop](evidence/compiled/desktop-home-hosts.png) | [mobile](evidence/compiled/mobile-home-hosts.png) | [narrow](evidence/compiled/narrow-home-hosts.png) |
| Discovery | [desktop](evidence/compiled/desktop-discovery.png) | [mobile](evidence/compiled/mobile-discovery.png) | [narrow](evidence/compiled/narrow-discovery.png) |
| Empty discovery | [desktop](evidence/compiled/desktop-empty.png) | [mobile](evidence/compiled/mobile-empty.png) | [narrow](evidence/compiled/narrow-empty.png) |
| Expanded discount | [desktop](evidence/compiled/desktop-discount.png) | [mobile](evidence/compiled/mobile-discount.png) | [narrow](evidence/compiled/narrow-discount.png) |
| Interrupted payment | [desktop](evidence/compiled/desktop-payment-interrupted.png) | [mobile](evidence/compiled/mobile-payment-interrupted.png) | [narrow](evidence/compiled/narrow-payment-interrupted.png) |
| Confirmed local RSVP | [desktop](evidence/compiled/desktop-rsvp-result.png) | [mobile](evidence/compiled/mobile-rsvp-result.png) | [narrow](evidence/compiled/narrow-rsvp-result.png) |
| My Nights | [desktop](evidence/compiled/desktop-my-nights.png) | [mobile](evidence/compiled/mobile-my-nights.png) | [narrow](evidence/compiled/narrow-my-nights.png) |
| Menu | [desktop](evidence/compiled/desktop-menu.png) | [mobile](evidence/compiled/mobile-menu.png) | [narrow](evidence/compiled/narrow-menu.png) |

The initial harness failures were fixture/setup issues (no provider UI without its test value, unsupported fixture music category, RSVP-created cookie before signed-out recovery, immutable removed-event guard and missing generated-config preparation) and incorrect test expectations about the saved-payment return page. They were corrected without changing application rules. The genuine product finding was coupon-label contrast, fixed in this increment.

## Control placement review

| Area | Placement and verification |
|---|---|
| Header | Back stays left, brand central, menu/account actions right. Existing named menu and close controls retain 44px hit areas and keyboard focus return. Direct My Nights stays visible on discovery/event screens. |
| Discovery | Search icon leads its labelled field. Area/music keep visible text labels and native select indicators; stack at320px. Reset remains beside the active-filter description. |
| Event | Text-labelled jump links sit before the poster/facts, leading to the existing access panel; copy/share remain secondary. Poster and Room/Flashes character remain intact. |
| Checkout | Quantity has a visible label. Payment icons sit beside named options; the lock remains a trailing payment-action cue. Discount stays in a labelled disclosure. Consent checkboxes stay separate from payment choices. |
| My Nights | Ticket action leads each booking row; Room remains a separate labelled action. Bell stays beside the existing menu and opens its existing anchored panel; Escape returns focus. |
| Hosts | Badge and verification text share one aligned row. Customer host-discovery actions replace the organiser-led homepage pitch. |

No bottom navigation was added. The application’s pre-existing mobile customer dock is present in compiled screenshots and was retained, along with its route-aware destinations. Room/Flashes controls were deliberately preserved after source review rather than replaced.

## Validation ledger

- Passed: build; typecheck; lint (0 errors, 4 pre-existing warnings); 75 tooling + 324 repository + 308 UI + 11 password-client + 5 rendered + 1,145 Worker tests = **1,868**.
- Passed: root and mobile dependency audits, **0 vulnerabilities** each. Dependencies were not changed.
- Passed: compiled Chromium journeys and the scoped axe checks at desktop,390px and320px; see final machine results for exact tested source and cleanup.
- Source-reviewed and regression-covered, not end-to-end delivered externally: payment-provider success, email/token delivery, Yorke unsubscribe transport and live Room/Flashes communication. No actual external transaction or communication was attempted.
- Not run: WebKit executable unavailable; physical iPhone/Safari unavailable. No download retry.
- No merge, deployment, release-admission changes, production data access, staff-trial modifications or new persistent credentials. Parent-confirmed release history: the original PR392 screenshot issue was resolved by supported artifact review and image-decode readiness commit12f028c8. Combined release32b595 is live and verified, including corrective WebKit run41444056693. That resolved issue is not a blocker for this customer preview; this preview remains undeployed.

Source-only review can use the published branch and these screenshots. No hosted customer preview URL is claimed; GitHub links are source/evidence links, not a running app. Draft PR publication was not needed to preserve the branch; previously blocked HTTP/artifact-transfer actions were not retried.
