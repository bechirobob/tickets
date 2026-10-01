# BeCore Tickets full production audit — 1 October 2026

## Scope and source

This is a full-system audit and remediation pass, not a Room-only delta.
Baseline repository main: `dc034f675121c556e673ecd714e0b334b6b69ee2`.
Baseline live application: `7b9db84ddff94a8b54324241dc855d3ab9ac8a8f` on the
active Tickets VPS, behind Cloudflare. Later baseline main changes were diagnostic
workflows, not a different deployed application. Work branch:
`audit/full-production-2026-10-01`.

Inventory: 48 page routes, 80 API route handlers, scheduled operations, durable
email tasks, Room WebSockets, active SQLite persistence, migrations, VPS release
and backup tooling, the preserved Cloudflare fallback, and the separately locked
Android/iPhone client. The September audit is historical context; its Worker/D1
capacity numbers are not reused as current VPS production measurements.

Constraints preserved: the real RSVP event remains intentionally Coming soon;
no publication, event date, pricing, host verification or USDC availability change
is part of this audit. No real payment, refund, payout, outsider email, customer
record cleanup, new credential or security-permission change is a test step.
Production-write journeys are exercised only in disposable fixtures or intercepted
browser APIs. Physical-device and provider acceptance remain separate gates.

## Findings repaired in this candidate

| Severity | Defect and user impact | Repair and regression evidence |
| --- | --- | --- |
| High | A live waitlist offer could override cancelled/postponed event restrictions and concurrent requests could reuse it to create more than one checkout | Restrict override to sold-out state, validate and claim the unexpired offer inside the order transaction; concurrent Seev requests create one order/provider call, cancelled/postponed create none |
| High | Stale dispute reminders could reopen terminal state, unknown resolution restore admission, and a partial accepted dispute mark an entire order refunded | Fence terminal provider decisions and atomic winning updates; require explicit remaining-balance evidence for a full refund, keep partial/unknown outcomes under review with admission suspended |
| Medium | Concurrent staff demotion/disable requests could remove the last active owner; concurrent failed logins lost increments and avoided lockout | Add exact additive database owner guard; atomic failure counters preserve lockout; test two simultaneous owner changes and ten concurrent failed logins |
| Medium | A temporary-password account could read organizer activity; password/support actions lacked some dedicated abuse controls | Enforce the same permission boundary and bounded identity throttles; malformed support payloads return validation errors; refund request conversations deduplicate transactionally |
| Medium | Draft/future/withdrawn uploaded event posters were anonymously readable with long-lived caching | Require curation authorization until actual public publication; private previews no-store, public responses revalidate. Previously cached browser copies remain a residual until prior expiry |
| Medium | Valid Room guests could multiply their flood allowance across unlimited sockets | Shared per-attendee action/slow-mode budget, four connections per identity and 2,048 per Room, reject excess with retryable 1013 without evicting current guests; reconnect/revocation/window and 600-guest headroom regressions |
| Medium | Most API parsers trusted transport/body size implicitly, and upload checks relied on Content-Length | Bound actual stream bytes before JSON/text/form parsing, preserving tighter route limits and exact signed webhook bytes; exercise absent/forged lengths and oversized streams |
| Medium | VPS confirmation scheduler called an unimplemented batch queue method; stale queue consumers could delete newer lease work | Implement durable deduplicated batch enqueue; fence acknowledge/retry by claimed attempt; five queue/rate-limit adapter tests now run through the established VPS suite |
| Medium | Receipts created during missing email configuration could remain without a retry; explicit receipt resend reused callback deduplication identity | Preserve due retries without burning provider budget; separate deliberate resend identity while retaining payment-callback idempotency |
| Medium | Reconciliation could call provider/local lifecycle mismatches matched and silently truncate after ten pages; legacy Paystack dispute requests used an incorrect field and lacked required context | Record lifecycle mismatches, fail visibly at incomplete pagination; send documented refund_amount/message and require real provider evidence for a challenge. No provider action performed |
| Medium | Private owner/host/team links became unusable after initial temporary failures once their bearer fragment was stripped | Bounded in-page inspection retry keeps the token only in memory, distinguishes expired links and never auto-submits a consequential action |
| Medium | RSVP confirmation could hang or report success for an empty successful response; promoter refresh left stale figures looking current | Bounded requests, validated success shape, single-flight loading, explicit stale-report feedback and recovery regressions |
| Low | Privacy retry lacked loading/single-flight state; settings confirmation did not verify saved=true; organizer sign-in dropped its selected workspace context | Preserve settings through failures, confirm actual application success, carry only allowlisted route context through authentication |
| Low | One Room entry test scrolled past a visible conversation before observer state settled; README and scheduled dependency coverage lagged runtime/mobile architecture | Maintain bounded playback-readiness assertion without changing Room behavior; correct VPS/fallback overview and include the independent mobile lockfile in recurring audit |

Provider-contract references: [Paystack dispute API](https://paystack.com/docs/api/dispute/)
and [dispute lifecycle guidance](https://paystack.com/docs/payments/manage-disputes/).
Tests use isolated fixtures and mocked provider calls. Focused suites overlap and
must not be added together as a full-suite count.

## Coverage and evidence ledger

The final candidate CI, runtime artifact, merge, deployment, production browser
and operational receipts must be appended below before this record can claim a
verified release. A pending check is not a pass.

| Area | Coverage / verification contract | Current status |
| --- | --- | --- |
| Public customer journeys | Home/Drop, search/filter segments, event details, host pages, RSVP availability and registration failure/retry, paid checkout and returns, sharing, public help/legal pages, missing/retired routes | Source inventory and regression additions complete; final 3-engine hosted gate pending |
| Customer private journeys | My Nights recovery, claims, ticket/Room entitlement, notifications, privacy controls, transfers, support/refund requests, saved/offline pass behavior | Isolated API and browser coverage; final hosted gate pending |
| Staff and organizer | Named roles, object/event scoping, temporary passwords, lockouts, owner preservation, organizer activation/team links, all Operations task routes, scanner duplicate/retry states | Focused new regression evidence recorded by area; final hosted gate pending |
| Financial and messaging integrity | Paystack/Seev webhook verification and duplicate handling, late/cancelled payment states, refunds/disputes/ledger, confirmation retry, durable queue leases and delivery suppression | Provider calls mocked; fresh real settlement/refund acceptance excluded |
| Security and privacy | Server authorization/session lifecycle, CSRF/origin, uploads and actual byte caps, draft media exposure, SSRF boundaries, headers, dependency/secret review | Source and focused tests; final hosted security/runtime checks pending |
| Responsive/accessibility | Desktop Chromium, mobile Chromium and mobile WebKit; expanded forms/menus, keyboard focus, axe checks, reduced motion and Room arrival visibility | Fresh rendered evidence requires hosted CI; local browser unavailable |
| Reliability/operations | Background job status, queue/alerts, DB integrity, credentials presence only, backups/restore, rollback/retention, exact-source release controls, edge/proxy trust | Fresh read-only operational workflow prepared; current-host run pending |
| Packaged mobile | Public-catalogue-only cache/projection, safe external handoff/deep-link routing, independent lockfile, permanent signing fail-closed/version validation, shared screens | Local unit/build/identity gates passed; exact candidate native CI pending |

## Verified local gates and execution limits

- Fresh server and mobile dependency audits: zero known advisories, including
  development dependencies, on 1 October 2026. Scheduled dependency audit now
  covers the independently locked packaged client too.
- Packaged mobile: clean dependency installation with scripts disabled for the
  audit install, 13 Node tests, four iOS release-script tests, Android and iOS
  release-identity validators and production TypeScript/Vite build passed.
- Release/retention/read-only diagnostic tests: 120 passed, including an
  independently reproduced staged-operator-only layout. The new owner trigger is
  pinned by exact source blob, SHA-256 and schema fingerprint; no general
  existing-table trigger permission was broadened.
- Limited secret review: current tracked-source scan found no live-key pattern; a separate nonprinting scan of added lines across 517 locally reachable main-history commits found no matches for the selected high-confidence provider/GitHub/AWS/private-key patterns. This is not a forensic assurance of every secret or remote branch.
- Earlier local full application builds and full lint terminated with SIGKILL
  (137), which were incomplete checks. The later VPS build with a 768 MiB Node
  heap succeeded, enabling a real local compiled HTTP/WebSocket verifier. Full
  build/lint/unit/browser release gates still run against the exact hosted source.
- A later local complete VPS test attempt passed 23 Node tests and 592 Vitest
  cases across 67 files, but three Vitest child processes exited unexpectedly.
  That aggregate is incomplete, not a release pass; exact-source hosted VPS
  verification remains required before activation.
- Local Chromium could not start because the runtime denies a required socket;
  the cloud interactive browser also timed out before navigation. No fresh
  responsive-quality claim is based on those failed attempts. Hosted browser
  artifacts must be inspected before closing visual coverage.

## Current-day operational receipts retained with their original time

- Read-only storage/health verification [36915375619](https://github.com/bechirobob/tickets/actions/runs/36915375619), 1 October 19:35 UTC: active application 7b9, previous 2c3, third 2266; free 22,038,310,912 bytes; no deletion by that check; health and version200. This predates this audit release.
- Backup [36832627387](https://github.com/bechirobob/tickets/actions/runs/36832627387), 1 October 07:50 UTC: encrypted backup, complete isolated restore and off-host upload all passed. Artifact11147432902 expires 5 November, 35-day retention. Workflow source 4cd96fb. This is current-day backup evidence, not a post-candidate restore or total-host-loss exercise.
- Historical host-capacity evidence from 29 September remains dated and is not treated as fresh performance. The new candidate additionally runs the existing 600-guest VPS harness in an isolated hosted runner: wallet isolation, duplicate gate races, 72,000 expected Room deliveries, revocation and restart. Runner measurements are not an SLA for the live VPS.

## Release safety

Migration `0060_staff_owner_integrity.sql` only adds a guard against removing the
last active owner through concurrent role/status updates. It rewrites no account
or customer row. The existing release transaction makes a private verified
pre-migration backup and preserves the additive guard if application code rolls
back. Existing DELETE behavior remains separately atomically guarded.

The release updater admits this exact migration through a narrow reviewed path;
its generic migration grammar and restrictions remain unchanged. Application
blobs are pinned after the complete candidate is reviewed. The baseline live
release remains the rollback point until a verified deployment records its exact
replacement. No earlier cleanup, handover or failed deployment is replayed.

## External acceptance boundaries

- A mocked provider checkout/webhook test does not establish current USDC
  settlement, real Mobile Money settlement, bank payout or a completed refund.
  Any live financial acceptance needs a separately approved transaction.
- The packaged client currently stores only public event data. Private My Nights,
  RSVP, recovery and checkout deliberately use secure browser journeys. Native
  private-session handoff, private offline passes, push and physical iPhone/Android
  lifecycle acceptance remain unimplemented or unverified; native store readiness
  is not established by web tests, an unsigned archive or a simulator build.
- Current customer privacy settings are not a complete account deletion/export
  workflow. A generalized session/access-grant/audit-record retention purge also
  needs a defined business policy before any destructive implementation. Native store submission and retention/legal policy acceptance need
  their own completed product and operational decisions.
- A restored encrypted backup on the existing host proves that rehearsal. Total
  host-loss recovery on a replacement machine and ongoing provider account quotas
  must not be inferred solely from source or an earlier receipt.

## Candidate verification corrections, before any deployment

- First candidate `901e5c7`: build, lint, types and rendered checks passed; Worker
  suite passed 606 of 607. The one old gate fixture demoted its only owner and was
  correctly blocked by the new invariant. Retaining a second fixture owner kept
  all assertions intact; focused Worker and VPS gate suites each passed 4/4.
- Candidate `bfd0706`: complete core passed 607 Worker tests plus 82 repository,
  44 UI, two password-client and four rendered checks, schema and Worker dry-run.
  Exact-source operator, isolated 600-guest capacity, native Android/iOS and mobile
  browser validation passed. The 600-guest test delivered 72,000 messages with zero
  errors; measurements are isolated hosted-runner observations.
- Its complete three-engine browser matrix was **not green**. All three engines
  found the same privacy helper-text contrast defect (4.02:1). Real compiled
  Operations writes exposed an audit-introduced request-wrapper integration bug:
  native unit Requests passed, but Vinext's cross-realm wrapper could not be used
  as a branded Request constructor input. No failing candidate was deployed.
- The corrected bounded parser reconstructs from URL and explicit metadata,
  preserves signed bytes and cancellation, and normalizes nonconstructible
  navigation mode for its parsing clone. Foreign-wrapper tests reproduce the
  failure before repair; Worker and VPS each pass 12 focused cases afterwards.
  The compiled VPS verifier now exercises real generic JSON persistence, origin
  rejection, 413 size rejection and an unsigned webhook, beyond the fast API path.
- Actual native screenshots additionally exposed omitted payment-logo assets,
  a missed portrait-crop identity after URL absolutization, and public artwork
  blocked by same-origin resource policy. The corrected client bundles its shared
  payment assets, uses normalized artwork identity, and verifies image loading and
  geometry. Only flat known public artwork and explicitly publication-verified
  public poster responses may embed cross-origin. Private/draft/denied media and
  API responses remain protected; no credentialed CORS access was added.
- Candidate `b9ba236` exposed a second bounded-body integration defect in the
  new compiled VPS check: declared-length rejection returned 413 but left its
  unread incoming stream blocking a reused connection. Local compiled tracing
  reproduced the next request resetting. Cancelling the rejected body preserves
  the cap and lets Vinext drain it without buffering the payload. A deterministic
  single-socket regression fails before repair and passes afterwards, including
  unchanged saved privacy, QR wallet, Room WebSocket, restart and revocation.
  Worker and VPS parser tests each pass 13/13; failed hosted evidence is retained.
- The corrected native screenshots show the restored portrait crop, host image
  and seven payment logos. Its new geometry test incorrectly treated the
  deliberately faded kicker overlap as a defect; the corrected assertion retains
  exact portrait dimensions and checks the title/actions instead. The iPhone
  capture runner also lost its Wrangler development proxy mid-capture; it now
  uses the existing direct compiled-Worker harness with explicit exit diagnostics.
- The desktop browser matrix on `b9ba236` passed 167 public cases, all 53 Operations
  cases, three repeated host cases and provider/RSVP/keyboard phases. Its one
  public failure was a synthetic document blocked by Chromium local-network
  protection before loading the candidate images. The exact trace proves both
  images returned 200 through the API but browser requests never reached them.
  The fixture now serves an actual document from a separate loopback port,
  retaining real image requests, CORP assertions and browser security defaults.
- The first failures, dates and original artifacts remain attached to the runs.
  These corrections require fresh exact-candidate complete gates and changed-view
  pixel review; earlier partial passes do not establish the corrected release.

## Final results and receipts

Pending final candidate, independent review, exact-source CI, operational
observation, authorized release and post-release verification.

## Full route/state inventory (48 Next page routes)

Status codes: **S** = source and existing automated coverage inspected, current candidate run/pixels pending; **N** = new failure-state tests prepared, candidate run pending; **G** = identified rendering/route gap still needs explicit evidence. Existing tests are not marked passed without current results. Each row applies to desktop + mobile Chromium + mobile WebKit unless a documented test restriction says otherwise.

| Route | Coverage source and relevant states | Status / evidence to inspect |
|---|---|---|
| `/` | public-journey, published-catalogue, room-demo, room-natural-entry: single/multiple hero, pause, reduced motion, discovery filters, Room arrival/reactions, short viewport, footer/nav | S; home-expanded, Room PNG/video/trace and scene geometry |
| `/events` | public-journey, discovery-segments, discovery-pass-access, customer-feedback: search/no results, date/filter expansion, history restoration, narrow320, reduced motion | S; expanded filters/date screenshots |
| `/event/[slug]` | published-catalogue, event-details, cuppy-guest, customer-feedback, payment-labels: real flyer, host, Coming soon, extras/disclosures, share/copy fallback, RSVP expansion, availability | S; each catalogue event PNG plus expanded panels |
| `/rsvp/[slug]` | host-profile and isolated registration suite: free RSVP, paid guidance, interest, Coming soon/schedule unavailable, failed send draft and success | S; October RSVP + fixture form PNG |
| `/checkout/[slug]` | public-journey, checkout-preview-retired, seevplus-checkout, seevplus-crypto-checkout: availability redirects, paid form/hydration, buyer validation, provider failure, labels/USDC | S; isolated provider fixtures only; no live payment |
| `/payment/return` | payment-return: pending polling/refresh, authenticated resume, missing ownership/error without false success | S; needs retained screenshot if suite has no custom PNG |
| `/hosts` | public-journey, host-profile, room-identity: list, Kofi Verified host, navigation | S; public expanded PNG |
| `/hosts/[slug]` | host-profile: portrait loaded, public socials, real next event, readable mobile layout | S; Kofi profile PNG; no-host/empty-next-event fixture coverage currently limited |
| `/about` | public-journey and room-identity: prose/identity/navigation, expanded state if any | S; public expanded PNG |
| `/help` | public-journey, room-identity: every visible details expanded, identity/hydration/readability | S; public expanded PNG |
| `/privacy` | public-journey, room-identity: policy/readability/no overflow/navigation | S; public expanded PNG |
| `/terms` | public-journey, room-identity: policy/readability/no overflow/navigation | S; public expanded PNG |
| `/my-nights` | my-nights-studio, member-navigation, discovery-pass-access, confirmation-notifications: private recovery, empty/error/retry, search/filter, active/history, cancelled/waitlist, notification settings | S; hub/filter/recovery/inactive-payment PNGs |
| `/my-nights/[slug]` | my-nights-hub: single/group passes, already-scanned no QR, perks/purchase/support expansion, question draft preservation, details/history links | S; pass/group/support/plan PNGs |
| `/my-nights/access` | customer-feedback: recovery/transfer fragments removed, deliberate claim, failure/retry, keyboard/readability | S; recovery-access and transfer-access PNGs |
| `/tickets` | public-journey and guest-clarity: legacy pass access, secure-recovery guidance | S; public expanded PNG |
| `/notifications` | notifications, member-navigation, confirmation-notifications: large14-item feed, long expanded text, loading/error/retry/private, unread/all, mark-read recovery, device preferences | S; dropdown/loading PNGs plus public page; real notification delivery remains external |
| `/account/privacy` | public-journey, navigation-audit, private-link-recovery: signed out, load failure/retry/loading, save failure retained choices/success | S+N; privacy-recovery PNG |
| `/room/[slug]` | room-identity, room-features: authenticated isolated socket, announcement target, reaction actions/focus, VIP sheet, Flash inbox/view/expiry/report/delete failures, delayed camera permission | S; Room message/actions/VIP/Flash PNGs; actual device capture remains external |
| `/rsvp/access` | registration + private-link-recovery: missing/expired link, deliberate confirmation, malformed response, confirmed/requested/waitlist/interested | S+N; registration-confirmation-recovered PNG |
| `/announcements/unsubscribe` | route-completeness: no token guidance, token POST form, done acknowledgement; mutation interception asserts zero submissions | N; three announcement-preferences PNGs planned |
| `/organizer/join` | host-onboarding: full form, policy checkbox, failed save retains details, success/back | S; host-form PNG |
| `/organizer/join/confirm` | host-onboarding + private-link-recovery: inspect, token stripped, deliberate confirmation, temporary-failure retry and expired | S+N; private-link recovered PNG |
| `/organizer/activate` | organizer-activation + private-link-recovery: missing/expired, matching passwords, failed save, inspect retry | S+N; setup/recovered PNG; real password changes excluded |
| `/organizer/team/accept` | operations + private-link-recovery: assignment/deep-link destination, existing password preserved, inspection failure/retry/expired | S+N; recovered invitation PNG; new-password flow has source only beyond shared password tests |
| `/organizer/submit` | organizer-submission, room-identity, public-journey: form labels/disclosures, invalid inputs, failure recovery, identity | S; submission/public expanded PNG |
| `/organizer/workspace` | operations: every nav area, event overview/details/tickets/guests/Room/VIP/insights/requests; coupons/questions/promoter/team; help/settings/desk; large lists/errors/preserved drafts | S; organizer per-view PNGs, host overview, segmented states. validated task-context sign-in repair prepared with dedicated regression/captures |
| `/organizer/analytics` | operations: event/range/views/filter/export, RSVP count, contact exclusion, readable controls | S; analytics PNG/trace |
| `/organizer` | Operations alias/login test: server alias to workspace then correct sign-in returnTo | N; organizer-alias-login PNG |
| `/organizer/assistant` | Operations deep-link test: alias to workspace `area=desk` with validated event retained through login | N; organizer-login-assistant PNG; embedded assistant covered by operations |
| `/promoter` | private-link-recovery: private report valid/refresh/503/stale/timeout/retry, in-memory token | N; promoter-recovered PNG; no real payout action |
| `/scan` | operations: camera start/result/repeated start/failure, offline queue conflict/reload/review, disconnected status, large RSVP door desk | S; physical camera/real door admission not proved by mocks |
| `/admin` | operations: queue list/expanded submission, review, exact owner-approval link; auth returnTo | S; admin expanded PNG |
| `/admin/account` | operations: account form, password/security state, nav/layout | S; admin-account PNG; actual MFA/passkey/device enrollment external |
| `/admin/accounts` | operations: staff list/removal safety/current-owner protected, expanded menus | S; admin-accounts PNG |
| `/admin/bootstrap` | route-completeness first-owner fields/help expanded with zero mutations; Operations seeded-DB redirect to sign-in | N; bootstrap-expanded-read-only and bootstrap-closed PNGs; empty-DB case deliberately skips live production |
| `/admin/events` | operations: real inventory, event draft/tier numeric validation/failure retention, remove test event, expanded fields | S; admin-events PNG |
| `/admin/fees` | operations: fee controls/expanded panels/layout | S; admin-fees PNG; no production financial rule mutations |
| `/admin/help` | operations: help expansion, mobile menu focus/escape/leave | S; admin-help PNG |
| `/admin/hosts` | operations: application view, approval exact form, local review/no event | S; admin-hosts PNG |
| `/admin/login` | public-journey + operations: startup hydration, values retained, isolated real password sign-in/sign-out, returnTo | S; public/operation captures |
| `/admin/operations` | operations: checks/incidents/approvals separate focused views, errors/readability | S; admin-operations PNG |
| `/admin/orders` | operations: orders vs reports/free registration, provider scope, uncertain save, filters; finance worker owns new dispute repair | S; admin-orders/provider-record PNG |
| `/admin/promoters` | operations: promoter list/expanded controls | S; admin-promoters PNG |
| `/admin/recover` | owner-recovery + private-link-recovery: setup email, no token history, matching passwords/error, initial inspection retry/expired | S+N; owner recovery/recovered PNG |
| `/admin/registrations` | operations: settings/roster/guest email tabs, loading guards, pointer stability, save-copy failure and clipboard readiness | S; admin-registrations PNG + guest states |
| `/admin/rooms` | operations: Room controls/memory failed save retains draft, expanded content | S; admin-rooms PNG |
| `/admin/support` | operations: support conversation/failed reply retention, expanded content | S; admin-support PNG |

Additional non-Next routes: `/offline-ticket.html` has public-journey rendered identity/offline Chromium coverage; offline WebKit service-worker emulation is intentionally skipped, not passed. `/manifest.webmanifest` identity/adaptive-icon assertions exist. 404 unknown/removed event recovery is exercised by published-catalogue/checkout-preview-retired; six new route-completeness cases cover invalid event/checkout/RSVP/My Nights/Room/host slugs with screenshots and axe checks.


## API route inventory

This is the source routing map, not a claim that every method received a separate live mutation test. Protected and write scenarios are exercised in isolated suites.

| Route | Exported methods |
| --- | --- |
| `/api/admin/accounts` | GET, POST, PATCH, DELETE |
| `/api/admin/audience` | GET, POST |
| `/api/admin/bootstrap` | POST |
| `/api/admin/campaigns` | GET, POST |
| `/api/admin/check-in` | GET, POST, DELETE |
| `/api/admin/door` | GET, POST |
| `/api/admin/events/removal` | GET, POST |
| `/api/admin/events` | GET, PATCH |
| `/api/admin/host-applications` | GET, PATCH |
| `/api/admin/operations` | GET, POST |
| `/api/admin/orders` | GET, POST |
| `/api/admin/organizer-activity` | GET, POST |
| `/api/admin/organizer-invitations` | GET, POST |
| `/api/admin/passkeys` | GET, POST, DELETE |
| `/api/admin/promoters` | GET, POST |
| `/api/admin/recovery` | POST |
| `/api/admin/registrations` | GET, POST |
| `/api/admin/rooms/flashes/[id]` | GET, DELETE |
| `/api/admin/rooms` | GET, POST, DELETE |
| `/api/admin/session` | GET, POST, PUT, PATCH, DELETE |
| `/api/admin/submissions` | GET, PATCH |
| `/api/admin/support` | GET, POST |
| `/api/admin/workspace` | GET |
| `/api/analytics` | POST |
| `/api/announcements/unsubscribe` | POST |
| `/api/calendar/[slug]` | GET |
| `/api/config/booking-fee` | GET, POST |
| `/api/customer/experience/[slug]` | GET, PATCH |
| `/api/customer/my-nights` | GET |
| `/api/customer/notifications/preferences/[slug]` | GET, PATCH |
| `/api/customer/notifications` | GET, PATCH |
| `/api/customer/notifications/subscription` | GET, POST, DELETE |
| `/api/customer/notifications/test` | POST |
| `/api/customer/preferences` | GET, POST |
| `/api/customer/privacy` | GET, PUT |
| `/api/customer/recovery/claim` | GET, POST |
| `/api/customer/recovery` | POST |
| `/api/customer/registrations` | GET, POST |
| `/api/customer/returns` | GET, POST, DELETE |
| `/api/customer/session` | POST, GET, DELETE |
| `/api/customer/support/[slug]` | GET, POST |
| `/api/customer/tickets` | POST |
| `/api/customer/transfers/claim` | GET, POST |
| `/api/customer/transfers` | GET, POST, DELETE |
| `/api/customer/wallet/[ticketId]` | GET |
| `/api/customer/wallet/config` | GET |
| `/api/email/webhook` | POST |
| `/api/host-applications/confirm` | POST |
| `/api/host-applications` | POST |
| `/api/media/[id]` | GET |
| `/api/organizer/activate` | POST |
| `/api/organizer/analytics` | GET |
| `/api/organizer/assistant/events` | GET |
| `/api/organizer/assistant` | POST |
| `/api/organizer/business` | GET, POST |
| `/api/organizer/reports` | GET, PATCH |
| `/api/organizer/team/accept` | POST |
| `/api/organizer/workspace` | GET, PATCH, POST |
| `/api/payments/initialize` | POST |
| `/api/payments/quote` | POST |
| `/api/payments/seevplus/webhook` | POST |
| `/api/payments/webhook` | POST |
| `/api/promoter` | POST |
| `/api/public/events` | GET |
| `/api/registrations/claim` | POST |
| `/api/registrations` | POST |
| `/api/rooms/[slug]/access` | GET |
| `/api/rooms/[slug]/block` | POST, DELETE |
| `/api/rooms/[slug]/flashes/[id]/report` | POST |
| `/api/rooms/[slug]/flashes/[id]` | POST, PATCH, GET, DELETE |
| `/api/rooms/[slug]/flashes` | GET, POST |
| `/api/rooms/[slug]/report` | POST |
| `/api/rooms/[slug]/vip` | GET, POST |
| `/api/submissions` | POST |
| `/api/version` | GET |
| `/api/waitlist` | POST |
| `/api/wallet/apple/v1/devices/[deviceLibraryId]/registrations/[passTypeIdentifier]/[serialNumber]` | POST, DELETE |
| `/api/wallet/apple/v1/devices/[deviceLibraryId]/registrations/[passTypeIdentifier]` | GET |
| `/api/wallet/apple/v1/log` | POST |
| `/api/wallet/apple/v1/passes/[passTypeIdentifier]/[serialNumber]` | GET |
