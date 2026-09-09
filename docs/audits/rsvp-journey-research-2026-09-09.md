# RSVP journey: research and release criteria

Research date: 9 September 2026. This is an implementation checkpoint, not a release sign-off.

## User requirements

Organisers choose free RSVP or paid registration, retain guest email addresses for later announcements, share registration links, and receive live signup updates. The owner sees organiser actions in the Operations dashboard. The guest-facing experience must be compact, accessible and understandable from invitation through confirmation and entry.

The previously requested Operations Center changes remain part of the overall audit.

## Primary-source comparison

| Concern | Observed platform behavior | BeCore acceptance criterion |
| --- | --- | --- |
| Share and register | Luma shares the event page and collects name/email without requiring an account first. Partiful supports copied links across messaging services. | Copy a stable RSVP link; preview the exact guest page; direct link opens registration; useful manual copy fallback. |
| Free and paid | Luma supports free and paid tickets and optional approval. | Explicit organiser choice, price and capacity; free RSVP never enters payment checkout; paid signup is confirmed only after verified payment. Existing bookings cannot be stranded by a mode change. |
| Guest status | Luma separates confirmed, approval pending and waitlisted communications. | Immediate on-screen status after email confirmation; never imply admission for a request, waitlist or email-only interest. |
| Host updates | Luma offers guest-registration email/push notifications to managers. Partiful documents notifications when a guest RSVPs. | Visible live connection status, automatic signup/count refresh, recent activity and approval queue. Consider email alerts for assigned organisers when away from the dashboard, with a preference. Describe actual update latency honestly. |
| Capacity and groups | Luma and Partiful support waitlists and group controls. | Atomic capacity allocation, group-size limits, no duplicate booking, clear waitlist order, cancellation and promotion notifications. |
| Closing registration | Both platforms document closing registration and deadlines. | Organiser can pause registration and set a deadline; backend enforces it for free signup and paid checkout, with clear closed-state guest copy. |
| Guest self-service | Partiful documents changing RSVPs; Luma has registration confirmations and calendar invitations. | Recovery link, registration status, cancellation, confirmed QR passes and calendar link; mobile browser works without installing an app. |
| Announcements | Luma supports guest blasts; Partiful documents guest messaging and guest-list exports. | Search/export verified free and paid guest emails, separate optional announcement subscription, preview recipients/message, durable sends, visible delivery failures and unsubscribe. |
| Owner oversight | Luma documents audit/activity tracking. | Owner-only feed of organiser mode/price/deadline changes, approvals, exports and queued announcements, with unread state and event links. |
| Privacy and accessibility | Luma documents notification preferences and guest-list visibility. | Keep guest emails private to authorised event staff; keyboard/contrast/mobile checks; readable consent and status messages. |

Sources:
- [Luma registration process](https://help.luma.com/p/event-registration-process)
- [Luma notification types](https://help.luma.com/p/notification-types)
- [Luma waitlist](https://help.luma.com/p/waitlist)
- [Luma event blasts](https://help.luma.com/p/sending-or-scheduling-event-blasts)
- [Partiful sharing invitations](https://help.partiful.com/en-us/articles/15525324-how-do-i-invite-guests-to-my-event)
- [Partiful host RSVP notifications](https://help.partiful.com/en-us/articles/15525377-do-i-get-notified-when-someone-rsvps)
- [Partiful RSVP deadlines](https://help.partiful.com/en-us/articles/15525321-how-can-i-set-a-deadline-for-my-guests-to-rsvp-by)
- [Partiful guest registration](https://help.partiful.com/en-us/articles/15525505-how-do-i-rsvp-to-an-event-on-partiful)
- [Partiful host tools index](https://help.partiful.com/en-us/collections/19666489-partiful-for-hosts)

These are references, not promises of identical functionality. Luma's paid waitlist uses deferred payment capture; do not assume Seev supports that. BeCore's existing free waitlist automatically promotes eligible parties, unlike Luma's documented manual approval.

## Implementation checkpoint

The coding workspace disconnected with environment_offline after initial implementation. Repeated attempts to reconnect failed. New RSVP work remains uncommitted in the local feature worktree and has NOT been deployed.

Local worktree: /workspace/scratch/2a4746bde3db/tickets-rsvp
Local branch: feature/rsvp-audience
Local starting commit: 7ee63ac287914f4a119aa004c41c82f335953afa

This remote branch starts at merged Operations release 06f341a021556598dd7509240bb934df13855da9 and contains this checkpoint only. Preserve and commit local RSVP edits, then merge this remote branch before opening a release PR.

Implemented locally before interruption:
- Free/paid/email-list organiser choices and paid base price/capacity.
- Guest email capture and subscription consent on free verification and paid fulfilment.
- Audience search/CSV export, announcement preview/composer, campaign and recipient queue, unsubscribe.
- Owner organiser-activity feed and unread tracking.
- Migration 0039_rsvp_audience and corresponding schema metadata.
- Further partial edits for accepting/deadline/host-alert settings, closed checkout checks and neutral provider copy.

Verification before the last partial edits: all 180 existing Worker tests passed; typechecks passed. This does NOT validate the new audience features or the subsequent registration-control edits.

A later command intended to add RegistrationLive, finish guest confirmation/registration pages and generate registration_controls migration did not execute because the environment was offline. In particular, the current local schema references new accepting/closes_at/notify_host columns but their migration has not yet been generated. The event page also passes new RegistrationForm props that have not yet been added to its component type. Resolve these before any build or push.

## Required completion work

1. Recover the existing worktree, inspect its exact diff and finish registration controls/migration.
2. Finish shareable direct RSVP entry, connection-aware live host updates, recent signup/status feed, host alert preference and real delivery behavior.
3. Finish guest form, explicit confirmation/waitlist/approval status, recovery and calendar/QR actions.
4. Fix campaign progress to distinguish provider acceptance from confirmed delivery, and count delivered/bounced/suppressed states. Test campaign idempotency, unsubscribe before sends/retries, abandoned queue claims and event removal.
5. Test assigned-organiser permissions, owner-only activity, free/paid mode and price/capacity changes, deadlines, live counts, guest deduplication/export and payment capture.
6. Add browser fixtures for organiser/owner and guest journeys, checking desktop Chrome, mobile Chrome and mobile WebKit, keyboard access, contrast, long text and overflow.
7. Update production privacy smoke coverage for audience/activity/unsubscribe endpoints.
8. Run exact candidate gates, inspect browser renders, merge/deploy under existing user authorization, verify exact live revision and migrations.

No real customer announcements or host notifications were sent for this implementation. No production event settings were changed for testing.

## Operations release status and remaining production audit

Operations PR116 merged at 06f341a021556598dd7509240bb934df13855da9.
Worker version: 8ec58e25-abc1-4bcf-8cd2-c902364cdcba.
Candidate verification 34403317899 and release 34403967459 succeeded, including exact-revision public/privacy smoke and D1 migrations 0037/0038. Recovery rehearsal 34403967430 succeeded.

The later production browser audit 34404207518 FAILED: 192 passed, 63 skipped, 6 failed and 3 flaky. The six failures are two assertions repeated across three browser projects: event-details expected a Keep me posted button for sun-chasers-labadi, and a pending-launch checkout assertion failed. Investigate current production event state versus fixture assumptions before changing tests; do not report this audit as fully green. Log job 102643144768 and artifact 10124913040 retain evidence.

Do not visit old owner recovery links, rotate owner credentials, or overwrite the user's existing payment configuration as part of completing this work.
