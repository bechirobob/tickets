# Completed staff dashboard interface pass

This pass covers existing owner/organiser staff dashboards. Customer Room/VIP, checkout, signup, scanner/native-app experiences and other projects are outside it. Retaining an appropriate existing screen is intentional; adoption does not mean replacing every screen with the same dashboard.

| Route / workspace | Final disposition | Preserved behavior |
| --- | --- | --- |
| `/admin` submission review | BoardUI search/paging; detail back restores the same row, page and scroll | Existing queue grouping, deep-linked submissions, editorial/approval/publish actions and notes |
| `/admin/hosts` | Existing disclosure review retained; current-page search and consistent paging; filtering retains an unsent note | Awaiting-email cannot be approved; explicit approve/decline and profile selection; account-access delivery remains distinct |
| `/admin/accounts` | Search/paged directory and contextual account form; close restores list focus | All role descriptions, assignments, password rules, self-removal exclusion and confirmation steps; no permission/action added |
| `/admin/account` and host Account | Existing password/passkey/recovery sections retained; active-device paging and readable neutral rows | Real authentication routines, current-device protection, recovery-code handling, password-change requirement |
| `/admin/support` | Existing desktop conversation split view; mobile list/conversation navigation; consistent paging and explicitly current-page search | Separate unsent drafts per case in component memory only; stale loads ignored; reply/status actions and notification semantics unchanged |
| `/admin/promoters` | Search and paging over existing authorised links; create draft remains mounted | Existing copy/create/toggle contracts and sales figures |
| Host Promote | Search/paging for promoter and coupon lists; hidden promoter details remain mounted to retain unsaved edits | Commission fields, payment-record controls, portal generation, coupons and consent-scoped announcements unchanged and unexecuted |
| `/admin/orders` | Earlier compact order list/search/paging/contextual records | Existing provider-specific financial controls and conditions; no payment/refund executed |
| `/admin/events` | Earlier searchable/paged inventory with edit-return focus | Existing event/inventory/archive/removal operations |
| `/admin/yorkeway-audience` | Earlier eligible-subscriber server search, cursor paging and consent detail | Owner-only eligibility/suppression rules; distinct from public signup and staff invitations |
| `/admin/operations` | Existing role-sensitive Overview/Readiness/Issues/Approvals grouping retained | Owner/curator event controls versus owner/finance financial projections; no new operational action |
| `/admin/platform-audience` | Existing consent-focused table and cursor navigation retained | Current-page contacts, consent and suppression; no fabricated total/page numbers or send operation |
| `/admin/fees` | Existing bounded fee-settings form retained | Existing `fees.manage` guard, financial meaning and save behavior; no fee changed |
| `/admin/registrations`, host RSVP | Existing shared settings/roster/approval workspace retained inside connected navigation | Mode, approval and consent distinctions; no invitations or approvals executed |
| Host Overview / Events / Guests / Audience | Earlier searchable lists and contextual guest/history details | Assigned-event visibility, counts-first guest access, event-specific consent and server pagination |
| Host Tickets / Guest questions / Requests | Earlier contextual editing, validation/error placement, saved-grade reload fix and request-history search/paging | Capacity/history restrictions, request semantics and idempotent complimentary issue workflow |
| Host Details / Draft / Submit / Help / Insights | Existing focused forms, readiness/reporting and help retained | Event scope, policy acceptance, business submission and reporting semantics |
| Navigation (`OperationsNav`, `WorkspaceChrome`) | Existing identity and role-aware destinations retained across integrated screens | No new role access, auth route, customer route or destination |
| Customer Room/VIP and public experiences | Outside this staff dashboard pass; retained unchanged | No customer redesign, announcement, concierge or public signup change |

## Verification boundaries

Browser tests use actual source components and styles with intercepted fictional GET contracts. They assert zero mutation requests. They cover staff account dialog/cancel/focus and self-removal protection, support draft isolation, review return state, host review eligibility and note retention, promoter/coupon paging and form-draft retention, and current-device protection. Desktop and touch-emulated viewports are not real iPhone/Safari or signed-in browser-to-database evidence.

Existing Worker tests exercise staff access, owner integrity, host applications, compact/event-day operations and organiser business behavior in the existing isolated unit-test environment.

## Approved compiled authenticated acceptance

The owner approved exactly two temporary local fictional password accounts and cleanup. `scripts/boardui-integration/authenticated-check.mjs` applies the 72 repository migrations to a new dedicated local D1 database, creates owner/organiser password accounts, and signs in through the compiled application's real password form. It never seeds sessions or injects cookies. Passwords remain in process memory; no password file, trace or HAR is created. Application sessions retain their normal twelve-hour lifetime while the database exists; the entire isolated database is removed after the run. The local login-decoy secret is ephemeral and grants no external access.

Desktop 1440×1000 and touch-emulated Chromium 390×844 each passed owner and organiser sign-in/sign-out, event visibility, owner-account access versus organiser 403, owner self-removal exclusion, actual guest-question save plus database/reload persistence, and organiser cross-event read/write rejection. Organiser runs also passed answered-question rejection with draft retention, ticket-description cancel, concurrent-edit conflict, reload of saved values, then real UI save and database/reload persistence. Ticket price remained unchanged. The compiled runtime uses unchanged rate-limit definitions and denies all outbound network; no provider or queue bindings are supplied. No invitations, messages, payments or refunds were executed.

The inspected question/ticket dialogs had no axe violations or horizontal overflow. Four real app-created sessions, zero page errors, zero observed CSP violations, zero external network attempts, and complete database/runtime/browser cleanup were verified. CSP observations are scoped to the inspected page lifecycle, not exhaustive route coverage. Screenshots contain fictional records only. This bounded acceptance complements the wider component tests; it does not establish saved-action coverage for every staff workflow. Real iPhone/Safari and screen-reader testing remain outstanding.

Evidence and source/lock/helper hashes: `evidence/authenticated/results.json`. No application changes were required by this acceptance; an initial ambiguous test locator was corrected before successful runs.

## Remaining release gates, not an unspecified UI backlog

1. Bounded local authenticated acceptance is complete as described above. Any broader saved-action coverage must retain fictional fixtures and the same no-message/no-financial-execution boundaries.
2. Complete real iPhone/Safari and assistive-technology checks through an authorized isolated HTTPS environment. No hosted URL or LAN instructions have been verified here.
3. Resolve PR #392's independent original email-screenshot/release blocker. Reviewed dependency fixes are present source-only; #392/#393 and their admission controls are untouched.
4. Review this combined candidate's exact source, remove evaluation-only routes if required for release, and run exact-candidate security/build/browser gates. Old admission inventories do not approve this new candidate.
5. Make the separate rollout decision required by the no-live-change boundary, then use existing guarded release/rollback and revision verification. No merge/deploy has occurred.

## Recorded final checks

- 288 repository tests, 308 UI tests, 72 existing Worker tests across six files, and five rendered-asset/configuration tests passed.
- TypeScript and actual Vinext build passed. Lint: zero errors, five unsuppressed warnings (three protected/trial external stylesheet links, inherited moderation default export, harness image shim).
- Root and mobile audits: zero vulnerabilities, no exceptions or dependency changes in this pass.
- Staff dashboard browser journeys passed at 1440×1000, 390×844 and 320×740, with zero write requests, zero page errors and no axe violations in the inspected views. Actual pixels were inspected. Earlier guest/Yorke, order/event/Money/Team and form/request journeys were rerun.
- Compiled unauthenticated checks: 11 protected pages redirect to login; 10 APIs return 403. These earlier checks were unauthenticated; the later bounded authenticated run is recorded above.
- Fixed a confirmed compact-pagination bug: when data initially yielded one page, the width observer never attached after more pages loaded. The observer now attaches when the pager becomes active; a mobile assertion covers asynchronous device-list loading. Original MIT provenance is retained and this adaptation is recorded.
- Whole emitted client JS/CSS: 673,959 gzip bytes across 200 files, including retained trial routes. Same dependency lock as phase 2 (671,491 bytes). These are artifact totals, not route transfer sizes or speed measurements.

Evidence: `evidence/phase4/`. Source-component screenshots contain only fictional records. No independent hosted URL, real iPhone/Safari result or Library upload ID is claimed.
