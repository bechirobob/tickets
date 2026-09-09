# Operations Center audit — 9 September 2026

Scope: BeCore Tickets, `bechirobob/tickets`, the master owner workspace and its server-side staff boundaries. Starting release: `3792a2d1819578536f2bff267b0859a206a0afa3`. Remediation: PR #116, `audit/operations-center`.

## Surfaces inspected

Submission queue; event operations/readiness/incidents/approvals; events and ticket inventory; RSVP administration; orders, refunds, reconciliation and disputes; support conversations; promoter links; Room reports/settings/announcements/memories; fees; staff accounts and event assignments; account security, password recovery, passkeys, sessions and logout; gate scanner/manifest/will-call APIs. Supporting D1 migrations, finance jobs, notifications, security headers, CI, release smoke checks and existing recovery rehearsal were reviewed.

## Findings and remediation

| Finding | Severity | Impact and correction | Regression evidence |
| --- | --- | --- | --- |
| Direct cancellation and stale writes could bypass the two-person approval workflow | High | Event editor now directs cancellation to approvals; cancelled records cannot be reopened. A D1 trigger protects against an editor racing with cancellation. | API cancellation rejection and database invariant checks |
| Every event save could revive unrelated voided tickets | High | Removed blanket reissuance. Postponement preserves valid admissions and pauses gate entry/manifest issuance; rescheduling does not revive refunds or cancellations. | Edit, postpone, reschedule and ticket-state checks |
| Concurrent approval decisions could both execute | High | Conditional decision claim must affect exactly one row before any action; missing decisions are rejected. Request and decision audit records are written. | Concurrent approve/reject and self-approval checks |
| MFA challenges and recovery codes were not atomically consumed | High | Conditional one-time claims prevent concurrent replay. Credential changes invalidate unfinished authentication challenges. | Concurrent recovery-code consumption; existing password-recovery tests |
| Offline replay did not bind the result to the requested event and QR | Medium | Replay lookup now binds scan ID, event and token hash. | Replay of an entry into another event is rejected |
| Inventory capacity check could become stale before saving | High | D1 trigger prevents reductions beneath consumed/live-held admissions within the actual write transaction. | Direct storage mutation is rejected |
| Publication toggles restored outdated submission details | Medium | Existing live event venue, schedule, capacity and price remain authoritative during publish/unpublish. | Unpublication preserves the edited event |
| Returned-ticket queue silently swallowed a nonexistent table query | Medium | Query uses `attendee_profiles`; removed the silent migration fallback. | Seeded return is visible to finance/owner |
| Gate heartbeat freshness compared different timestamp formats | Medium | Julian-day comparisons correctly age devices and offline scan counts. | Same-day stale heartbeat is excluded |
| Free RSVPs were labelled Paystack, counted as paid orders and offered verification | Medium | Explicit Free RSVP display; no provider verification; free orders do not block Paystack refund batches. Receipt delivery requires a paid order. | RSVP display/API/batch checks |
| Operations controls could stay busy, discard drafts or claim success after transport failure | Medium | Shared bounded JSON requests return actionable errors; controls become usable again; drafts remain. Logout confirms revocation before navigation; memory drafts clear only after success. | Dropped event/support/Room requests; actual login/logout browser journey |
| Support queue truncated joined messages and could hide later conversations | Medium | Page by conversation, then retrieve complete threads. Add page controls and prevent reply carryover between cases. | 21 conversations and a 610-message thread |
| Moderator queue was limited globally before assignment filtering | Medium | Apply event assignment restrictions before report limits. | Existing Room isolation tests and role matrix |
| Date status could not be confirmed from the event editor | Medium | Date status is editable; date controls explicitly use Ghana time. | Coming-soon date confirmation and owner UI coverage |
| Private page caching and several form controls needed consistent handling | Medium | All Operations pages/APIs use no-store and noindex; explicit accessible names and recoverable failure states. | Rendered owner route checks and axe on three browser targets |
| Readiness check implied a complete physical rehearsal | Low | Relabelled as automated setup checks, with explicit physical gate/payment rehearsal still required; published/date/RSVP conditions are checked. | Operations API and existing role checks |
| Tier references, duplicate IDs, sales windows, promoter duplicates and fee scope needed tighter validation | Medium | Reject invalid input before writes; record promoter toggles. | Tier validation and existing fee/event tests |

## Compact Operations organisation

The submission queue opens as a searchable, paginated list with Needs review, Accepted, Rejected and History views. Approval/rejection returns to the list and removes the submission from active review. Details and poster open only after selection. Events likewise open as a compact directory with Upcoming, Past, Previews and All filters, with ticket inventory collapsed in the detail view.

Event removal shows affected registrations/bookings and requires a reason. Upcoming paid events require independent cancellation approval; already-cancelled, past and unpaid events can be removed directly. Removed events cannot be republished, disappear from active staff/organiser/customer workspaces and no longer fulfil paid reservations. Orders remain accessible using Include removed events for reporting and refunds. Public edge caches can retain a listing for up to 45 seconds after removal.

Orders & payments separates Orders, Reconciliation, Disputes and Settlements and adds event/payment-method filters. RSVP flow redesign and organiser explanation are deferred at the user's request.

## Validation and release evidence

The initial baseline passed 163 Worker tests. The remediation adds 17 focused Worker regressions, including a matrix of seven roles across seven API surfaces. Full local repository, password-client, UI-source, rendered-HTML, Worker, lint, type, build, dependency and migration checks run before release. Dependency audit reported zero vulnerabilities.

`playwright.operations.config.ts` uses isolated local D1 identities and data over local HTTPS, preserving Secure cookie behaviour in Safari. It exercises real owner login/logout, ten owner screens, accessibility, document overflow, RSVP order display and dropped-request recovery. Existing public, Seev checkout and registration browser suites remain release gates. Candidate CI runs desktop Chromium, mobile Chromium and mobile WebKit. Exact successful candidate/deployment identifiers are recorded in PR #116 and the release workflow, not inferred from local tests.

Production smoke verification checks the deployed revision and Worker version, public routes, catalogue, unsigned Seev webhook rejection, all main Operations API privacy boundaries and private-page redirects. It does not impersonate the owner's production session.

## Migration and rollback

`0037_operations_guards.sql` adds two triggers. `0038_event_removal.sql` adds the removal timestamp, a durable cleanup queue and a guard against republishing removed records. Removal keeps financial/reporting records, voids active tickets, cancels registrations, clears active workspace entries and purges Room content. Interrupted cleanup is retried by the scheduled Worker. It does not rewrite accounts, bookings or event records. Keep these invariant guards in place on a rollback; dropping them reintroduces the defects. No credentials or recovery links are committed. Production fixtures are never seeded: the browser helper has only the local D1 path.

The preceding release is `3792a2d1819578536f2bff267b0859a206a0afa3`, Worker version `7fb96c27-7f62-4355-9215-e394007c5fa1`. Reverting to it also restores the audited defects and should only be temporary containment followed by a forward fix.

## Explicit limits

- Authenticated browser verification uses the real application with isolated test accounts. The owner's newly established production password/session is not available to the audit, and is not changed or claimed.
- No real refund, dispute acceptance, payout, customer notification or live event change is initiated to test the interface. Provider money movement, settlement totals and production email delivery require provider/account evidence and an authorised operational rehearsal. Seev production activation is not established by this audit; its payout/refund limitations remain in the Seev runbook.
- The current UI has approval review and reconciliation records. Payout recipient setup and payout request creation remain API/provider-assisted; this audit does not certify a complete self-service payout journey.
- Previously voided tickets are deliberately not restored based on a guess about their cause. Newly postponed events preserve their existing valid tickets; any legacy event already postponed with voided tickets needs individual review.
- A gate device that is genuinely offline cannot learn a cancellation until it reconnects. Online admission and fresh manifests enforce current status; physical gate and offline synchronisation rehearsals remain necessary.
- Automated accessibility checks cover detectable issues and rendered screen sizes, not a complete human assistive-technology or real-device hardware certification. Native app signing/store publication is outside this Operations audit.
