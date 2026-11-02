# Connected workspace evaluation

This extends draft PR #394 with fictional, local-state journeys. No production route, authentication, permission, business operation or customer record changes. This is a representative slice of a wider Tickets workspace proposal, not completed project-wide adoption.

## Source map and scope

| Existing area and source | Proposed workspace improvement | Implemented in this preview |
| --- | --- | --- |
| Host navigation: `app/workspace-chrome.tsx`; event context: `app/organizer/workspace/organizer-suite.tsx` | Consistent area navigation and selected-event context; preserve assigned-event scope | Owner/organiser fixture switch, event list, event overview and contextual tools. The switch demonstrates roles; it is not authentication. |
| Event setup: `suite-events.tsx`, `organizer-workspace.tsx` | Short forms, clear validation and save/discard feedback; retain existing draft/submission rules | Published-event venue, map and line-up local editing. Draft creation, tickets, questions, duplication and submission remain proposed. |
| Guest desk and orders: `suite-records.tsx` | Searchable contextual records without losing list state; distinguish paid tickets, RSVPs and admissions | Fictional paid/RSVP list, type filter, pagination and read-only details; original 2,400-row add/edit trial remains available. Comp/door records, delivery recovery and refund review remain proposed. |
| Team and promotion: `suite-promote.tsx` | Distinguish invitation acceptance from email delivery; retain lead-host controls | Read-only accepted, awaiting and email-failed examples. No send/resend/withdraw, role change or promotion action. |
| Audience: `suite-records.tsx`; owner `app/admin/yorkeway-audience` | Event-specific audience context and consent clarity | Separate owner Yorke audience fixture: 600 eligible subscribers, search/sort/page, consent detail. General audience remains proposed. |
| Yorke public entry: `app/the-yorke-way` | Understand recipient consent separately from staff audience management | Isolated signup reference only: explicit unchecked consent, errors and non-submitting completion. Actual public experience unchanged. |
| Money, Room & VIP, insights, requests; owner operations: `app/admin/operations-nav.tsx`, `lib/staff-roles.ts` | Apply common controls and hierarchy while retaining financial, operational and role boundaries | Source-mapped only; not redesigned or connected here. |

Host suite source paths above are under `app/organizer/workspace/`. The real host navigation includes Overview, Events, Audience, Promote, Money and Team. The real event tools include Overview, Details, Tickets, Guests, Room & VIP, Insights and Requests. The preview deliberately has no dead links pretending these are complete.

## Representative journey

Open `/boardui-trial/workspace`: choose a fixture role → manage an event → review/update venue and line-up → filter paid/RSVP guests → open and close a record with list context retained → review team invitation states. Owner examples additionally link to `/boardui-trial/yorke-way` → inspect consent → view the separate non-submitting signup reference.

Yorke's actual flow is early-access signup, not an event RSVP or ticket and not a campaign invitation composer. Current owner audience is read-only; email ownership is unverified and campaign delivery is disabled. This preview retains those distinctions. Withdrawn contacts are represented only by an aggregate, never mixed into the eligible list. Recipient copy preserves the existing year-end-2026 consent text/version; the real single-opt-in welcome behaviour is described but never invoked.

## Boundaries

All examples use fictional names and `example.test` addresses. Edits reset on reload. Team invitations and booking recovery/refunds are not operational. Public customer routes, live APIs and authorization are untouched. Shared primitives come from the same pinned free BoardUI source and scoped Tickets adapter as the first trial. No new dependencies were added for this extension.

The next adoption decision should cover these journeys as a coherent workspace, with separate implementation/verification for money, event setup, permissions and operational actions. Neither this preview nor its role selector demonstrates backend authorization correctness.
