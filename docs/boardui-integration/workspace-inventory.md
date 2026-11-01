# Tickets workspace coverage and remaining work

This is a source inventory, not a claim of full product readiness. All areas retain their existing server authorization and business operations. API writes need compiled authenticated fixture verification before rollout.

| Route / existing component | Current UI disposition | Exact remaining verification or implementation |
| --- | --- | --- |
| `/organizer/workspace` Overview, `OrganizerSuite` | Integrated: assigned-event search/pagination, connected event navigation | Authenticated assignment isolation and navigation/draft continuity across reload/back |
| Event Overview, `HostStart`, `Draft`, `Duplicate` | Existing readiness summary and draft/duplicate forms retained; no generic dashboard replacement | Real draft save/submit and policy acceptance; repeat-event idempotency; no duplication performed |
| Event Tickets, `TicketEditor` | Integrated: contextual grade editing, cancellation/focus restoration, errors inside dialog; saved-value reload now actually resets edited fields | Authenticated optimistic-conflict/capacity/history safeguards, new-grade save; no real price change performed |
| Tickets complimentary CSV, `Tickets` | Existing review-before-issue and resume/idempotency flow retained | Browser-to-DB partial batch/resume; no passes issued or delivery queued |
| Overview Guest questions, `Questions` | Integrated: search, ten-row paging, contextual add/edit, native field validation, retained draft on error, cancel/focus restoration | Authenticated answered-question restrictions and create/edit persistence |
| Event Guests / RSVP, `Guests`, `RegistrationManager` | Guest records integrated; existing settings/approval/roster controls retained | Real RSVP settings save, approve/decline and guest-access workflows; no invitation sent |
| Event Details, embedded `OrganizerWorkspace` | Existing focused venue/map/line-up form retained | Authenticated save/reload and server rejection; no additional UI redesign implemented |
| Event Requests, embedded `OrganizerWorkspace` | Integrated: request-history search and ten-row pagination; unsent request form remains mounted | Authenticated request creation and owner review; no refund/cancellation request submitted |
| Event Room/VIP, embedded `OrganizerWorkspace` | Existing announcement, concierge settings and VIP queue retained | Expanded-state mobile review and authenticated permissions; no announcement, concierge action or settings write performed |
| Event Insights, `OrganizerAnalytics` | Existing analytic scope/range controls retained | Authenticated event-scoped metrics and device review; no new reporting semantics |
| Promote, `Promote`, `PromoterDetail`, `EventAudience` | Existing channel grouping, coupon forms, promoter detail disclosures and consent-scoped announcements retained | Long promoter/coupon-list treatment remains a possible separate UI increment; portal creation, commission/payment records and sending are unexecuted |
| Team / Door, `Team` | Integrated: member/invitation search, groups and paging; delivery state distinct from acceptance | Authenticated role/lead checks, invitation lifecycle and access removal; no outgoing invite or permission mutation |
| Audience, `Audience`, `ContactHistory` | Integrated: search/paging/contextual assigned-event history | Authenticated cross-event isolation/export and consent exclusions |
| Money, `Money`, `StatementRecord` | Integrated: read-only statements/search/paging/details and payout-history grouping | Authenticated owner/host projection and exact amounts; no financial action executed |
| Host Help / Account / Submit | Existing `HelpCentre`, `AccountSecurity`, `SubmissionForm` retained | Authenticated support and submission persistence; security flows not redesigned |
| `/admin/events`, `EventOperations` | Integrated directory/search/pager and return to selected row; full event form retained | Authenticated save, inventory/removal/archive controls; none executed |
| `/admin/orders`, `OrderOperations` | Integrated compact records/dialog/search/paging/error handling | Authenticated read/write predicates, provider cases and reconciliation/disputes/settlements. Financial and delivery actions untouched and unexecuted |
| `/admin/yorkeway-audience`, `YorkewayAudience` | Integrated eligible-subscriber server search/pager and consent detail | Authenticated eligible/withdrawn/suppressed boundaries, cursor search; public signup unchanged |
| `/admin`, submission queue; `/admin/hosts`, `HostApplications` | Existing review interfaces retained | Submission/host review presentation is not migrated; approval/decline actions not exercised |
| `/admin/operations`, `EventOperationsHub` | Existing operational grouping retained | Dedicated event-day dashboard redesign not implemented; operations actions not exercised |
| `/admin/support`, `SupportOperations` | Existing 20-row queue and conversation split view retained | Mobile conversation navigation/draft preservation needs dedicated review; no customer reply or notification sent |
| `/admin/accounts`, `StaffAccounts`; `/admin/account` | Existing staff directory and account-security forms retained | No role/security redesign or permission changes; authenticated security testing remains required |
| `/admin/promoters`, `/admin/rooms`, `/admin/fees`, `/admin/platform-audience` | Existing specialist views retained | Not migrated; respective commission, Room, fee and platform-consent semantics must be reviewed before any dedicated redesign |
| `/admin/registrations`, `/admin/help` | Existing shared registration/help interfaces retained | No separate owner redesign claimed; real registration writes remain unverified |
| Public customer routes, scanner/native apps, Bubble Wash, Addressing | Outside this workspace increment | No redesign or rollout performed |

## What is blocked versus simply not redesigned

The concrete blocker is compiled authenticated owner/organiser browser-to-database verification: no approved isolated fixture exists, and the current instruction forbids its credential/token generation. `fixture-assessment.md` explains the exact existing setup and a narrower normal-login option. This does not block source-component work.

Specialist retained areas above are explicitly **not redesigned**, not falsely labelled blocked by credentials. They can be considered in later bounded interface increments. The current increment finishes the selected event-record/list/form changes while preserving their established workflows. Whole-workspace adoption remains partial; no production release is implied.
