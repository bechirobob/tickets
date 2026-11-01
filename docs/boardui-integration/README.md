# Tickets workspace integration candidate

Local integration branch `integrate/boardui-workspace-20261101`, based on approved preview commit `14b2b3789b61ed032e20ac772397c637c0fbfc33` and original main `63f2ead2fb3eaae03696f408b12e9e18cfcee265`. This is application source work, not a live rollout or a claim that Tickets is finished. Preview PR #394 and independent PRs #392/#393 are not modified by this branch.

## Real routes and contracts

| Area | Implemented integration | Preserved contract / remaining work |
| --- | --- | --- |
| `/organizer/workspace?area=overview` | Free BoardUI search and pagination over assigned events; removes the first-twelve-only display limit | `/api/organizer/business?section=events&event=all` remains authoritative; client filtering never broadens assignments. Existing host navigation and selected-event URLs retained. |
| Event Guests | BoardUI search, compact table and pager; contextual native record dialog; Close/Escape/mobile Back and trigger-focus restoration | Existing server-side query/status/25-row pagination and counts-first/on-demand personal data. `guest_detail` still controls financial scope, resend access and refund review. Search controls remain mounted while results load, so typing and focus survive slow responses. No duplicate guest mutation API or fake saved state. |
| Host Audience | BoardUI search/pager; contextual guest history | Assigned-event history and event-specific announcement consent unchanged. |
| Owner `/admin/yorkeway-audience` | Compact subscriber list, server search before existing email cursor pagination, accurate matching count, consent-version dialog, loading/error/retry and stale-request protection | Same owner session/password-change check and private no-store response. Same subscribed/suppression predicates. Bound, parameterised literal substring search; withdrawn/suppressed rows excluded. No send, contact sync, edits or permission changes. |
| Event Details, Tickets, Room/VIP, Insights and Requests | Existing forms/actions stay connected. Phase 3 adds ticket/question dialogs and request-history search/paging | Established persistence, role checks and mutation contracts remain. See the exact inventory for retained specialist views and outstanding authenticated verification. |
| Other owner platform screens | Existing shared navigation retained | See phase 2 below for orders, event inventory and Money; staff management and support remain untouched. |
| Public Yorke signup | No change | Remains distinct from owner audience management and staff invitations. The prior isolated signup reference is not a production redesign. |

The same pinned MIT BoardUI source and notices under `components/boardui` are reused. Production adapters live under `components/workspace`; existing Operations button rules explicitly exclude the integrated adapter so they cannot shrink its touch targets or overflow action cells; production layouts reference `/boardui-pressable.css`. Existing trial routes remain separately under `/boardui-trial`. No global theme replacement, customer-data reads, outgoing messages or production credentials. The source-only dependency correction is detailed below.

## Current integration inventory (phase 2)

| Status | Area | What is actually implemented / remaining |
| --- | --- | --- |
| Complete for this increment | Owner orders | Existing API search/filter/pagination, compact list and contextual full record; loading/error/retry and stale-response handling. Existing payment predicates/actions retained, none executed during browser checks. |
| Complete for this increment | Owner event directory | BoardUI search/pagination; event editor returns to the same page, row focus and list position. Existing editing API and business rules remain. |
| Complete for this increment | Organiser/owner Money | Read-only statement search/pagination/detail, separate paginated payout history. Host ticket-only versus platform fee projection and accounting disclaimer preserved. |
| Complete for this increment | Event Team | Search, member/invitation grouping and pagination; accepted versus delivery-failed states retained, role-dependent controls and unsent form draft preserved. |
| Complete from first increment | Host overview, Guests, Audience and owner Yorke audience | Assigned-event discovery, contextual guest/history dialogs and eligible-subscriber literal server search. See first inventory above. |
| Partial | Actual writes and expanded workflows | Event save, invite acceptance/revocation/delivery, financial actions and provider-case workflows retain existing implementation. Not exercised through compiled authenticated browser/database. |
| Untouched | Other workspace and public areas | Owner staff-account/security/support redesign, Room/VIP, coupons/promotions, full event/ticket forms and public customer signup/checkout. Shared styling is not a claim that each is redesigned. Bubble Wash and Addressing have not started. |
| Blocked | Compiled authenticated fixtures/device review | Neither checkout contains an existing operations fixture. Its setup script generates passwords/session tokens. It was not run under the explicit no-fresh-credentials/no-invented-tokens restriction. No auth bypass or synthetic production identity was introduced. Real Safari/iPhone, OS keyboard and assistive-technology checks remain. |

## Verification and limitations

Phase 2 logs, browser results and screenshots are in `evidence/phase2`. Existing repository tests: 288 passed; UI tests: 308; focused Worker tests: 122 across six files; tooling compatibility tests: 75; mobile unit tests: 20. Typecheck and mobile build passed. Lint: zero errors, seven warnings. Compiled unauthenticated checks: five protected pages redirect to login and four APIs reject with 403. Vinext build and rendered-asset validation are recorded alongside this document. Lint warnings are retained, not waived: protected/trial external stylesheet links, inherited moderation default export and test image shim.

Chromium checks mount actual source components/styles with intercepted fictional HTTP at desktop 1440×1000 and touch-emulated 390×844/320×740. They exercise search, pagination, retry/empty states, contextual records, focus restoration, unsaved event edits, host/owner finance projections, team role presentation and invitation delivery states. Every write request is blocked and asserted absent. Worker tests separately exercise real API/business code with isolated test records. These two layers are **not** compiled authenticated browser-to-database proof. Existing full-flow guest/Yorke checks were rerun with the patched dependencies.

Payout-history checking exposed insufficient inherited badge contrast (3.82:1). The scoped workspace adapter now uses ink text on a transparent background; final axe checks include this view. No accessibility suppression was added. Rendered-asset validation also caught a missing shared CSS-import chunk; the workspace adapter import was moved from client components to their protected layouts, with the same stylesheet explicitly imported in the source harness. The asset guard is retained unchanged.

Final Vinext build and all five rendered-asset/configuration tests passed. Whole-build JS/CSS is 671,491 gzip bytes (200 emitted files), versus 667,243 at the preceding integration. This candidate also contains the reviewed dependency corrections, so the older baseline is not a same-lock performance comparison. Totals include retained evaluation routes; they are emitted-file sizes, not route cost or performance claims. No exact-HEAD hosted release evidence exists. No release admission inventory, control plane, auth, consent or workflow was weakened.

## Dependency and release sequence

Applied only the eleven reviewed dependency-correction files from PR #392 commit `a17fd73f31a19eba1be725fbbf29e5c798ec0392`; scanner page/test excluded. `dependency-provenance.json` records exact source/local hashes. Root package files retain the selected BoardUI additions; every non-root dependency entry from the reviewed lock is unchanged. Separate integration node_modules were installed, leaving the original trial checkout untouched.

Fresh unwaived root and mobile audits both report **zero vulnerabilities**, versus this branch's preceding root 21 moderate/mobile 4 moderate findings (glob GHSA-3g3m-2fjr-6pw4 and minimatch GHSA-g3hv-75wg-m249 plus propagated paths). No broad unrelated upgrade or audit exception. This is source-only reuse, not a release of PR #392. Its original email screenshot/release blocker remains unresolved; PR #393 and their admission controls remain untouched.

Before rollout: resolve the original independent release blockers, review the combined source inventory and ancestry, complete authenticated isolated browser/database and device verification, exclude evaluation-only routes from a production candidate if required, and rerun all exact-candidate gates. Then obtain the separate rollout decision required by this no-deploy task and use the existing guarded release/rollback controls. No old exact-source admission can be reused as approval for this combined candidate.

## Automatic CI reviewed before committing

`.github/workflows/deploy.yml` deploys on matching `main` pushes and explicit dispatch, with a main-ref guard. Never push this integration to main. New feature-branch commits/pushes do not match that trigger. Native app and iPhone layout workflows run on relevant PR changes; their PR paths build local candidates. Production browser audit and marketing connection follow Deploy to Cloudflare, not this feature branch. All other push branch filters were parsed and recorded in `evidence/phase2/push-triggers.json`; none matches this integration branch. No workflow is changed or manually dispatched here. A new PR is not needed for the local verification work.

## Device access and delivery

Only the loopback source-component harness has been verified. No independent hosted URL, real iPhone/Safari run or LAN setup is verified; do not use the optional historical `--lan` flag as evidence or a tested delivery instruction. A signed-in phone check needs an authorized isolated HTTPS test environment. Screenshots in this repository are the available visual deliverable.

Library transfer is not retried: owner approval remains valid, but the supported helper's pre-upload tool-discovery network failure is unresolved. No Library IDs exist.

## Phase 3: event forms and request history

Ticket-grade editing and guest-question editing now use contextual dialogs. Guest questions have search and ten-row pagination; validation and server errors remain inside the dialog. Ticket-grade reload now remounts the form even when the stored revision is unchanged, fixing the existing false-success reload behavior. Request history has search and ten-row paging without clearing an unsent request. API payloads and existing history/capacity restrictions are preserved. No financial execution, outgoing request/invitation or production write occurred.

See [the exact workspace inventory](workspace-inventory.md) for each owner/organiser area, including retained specialist interfaces that have not been redesigned. See [the read-only fixture assessment](fixture-assessment.md) for generated values, storage, expiry, actual sign-in behavior and the narrower normal-login testing option. No credentials were generated. Phase 3 evidence is under `evidence/phase3`.

Phase 3 verification: 288 repository tests, 308 UI tests, 23 organiser-business Worker tests and five rendered-build tests passed. Types and Vinext build passed; lint remains zero errors/seven unsuppressed warnings. Chromium component tests passed at 1440×1000, 390×844 and 320×740, including native validation, Cancel/Escape/focus restoration, preserved drafts after mocked 409 rejection, successful question save, ticket history-lock payloads, reload reset, request search/pagination and axe. All three POSTs per viewport were intercepted fictional form contracts; no request-history submit, invitation or financial execution occurred. Credentials, database setup and authenticated browser-to-database verification remain unperformed. Root/mobile dependency files are unchanged from phase 2's zero-vulnerability audits.
