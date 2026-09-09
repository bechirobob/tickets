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

## Implementation and verification

The interrupted workspace recovered with its files intact. The candidate now includes:

- Explicit free RSVP, paid registration and email-list choices, paid price/capacity, accepting toggle, optional Accra-time deadline, host email preference and booking-preservation guards.
- Shareable direct registration link, guest preview, live activity/counts every five seconds while visible, recent signups and preserved unsaved settings during refresh.
- Immediate host signup emails with stable per-booking delivery identifiers and retries; assigned active organisers only, respecting the event preference. Notifications do not represent payment until fulfilment verifies it.
- Guest page explains free admission, optional subscriptions, verification, group size and deadlines. Confirmation distinguishes confirmed, waiting for approval, waitlisted and interest; confirmed guests get QR/calendar links. My Nights refreshes status and supports cancellation.
- Search/export of verified free and paid guest emails; optional announcement consent; message preview, durable per-recipient sends and unsubscribe. Payment retries cannot re-subscribe an unsubscribed guest with older consent.
- Owner-only organiser activity, unread tracking and direct event links.
- Removal clears audience contacts/campaigns and prevents remaining delivery retries from sending for removed events.

Migrations: 0039_rsvp_audience and 0040_registration_controls. They are additive. Existing registrations are still visible in the guest list; existing guests are not silently subscribed to marketing announcements.

Delivery scope: announcements are per event. The minutely queue processes up to 25 recipients per invocation; large audiences take multiple batches, and provider quotas/retries can delay delivery. The dashboard distinguishes provider acceptance from a delivery failure. No real customers were emailed during verification. Tests use isolated D1 and mocked email/payment providers; browser send-failure testing never sends an announcement.

Local integration coverage includes mode/price changes, closed/deadline registration, assigned-event access, owner-only feed, live counts, free/paid email capture, notification deduplication, campaign deduplication, unsubscribe before send/retry, abandoned-delivery recovery and safe CSV export. Candidate browser coverage exercises organiser controls, guest page, real verified signup appearing without refresh, preserved settings drafts, guest export, announcement preview/error recovery and owner oversight on desktop Chrome, mobile Chrome and mobile WebKit.

Exact candidate and post-deployment results are recorded in the PR and GitHub Actions; this document alone is not a release sign-off.

## Operations audit follow-up

Operations PR116 merged at 06f341a021556598dd7509240bb934df13855da9; Worker version 8ec58e25-abc1-4bcf-8cd2-c902364cdcba. Candidate 34403317899, release 34403967459 and recovery rehearsal 34403967430 succeeded.

Production browser audit 34404207518 had two failing assertions across three browsers. Both assumed sun-chasers-labadi had interest registration. Read-only production inspection showed its saved registrationMode was paid, and the guest page correctly showed pending ticket sales. Tests now read the public catalogue mode when asserting the entry UI; they continue to assert closed checkout and no purchase link for the pending launch fixtures. No production registration settings were overwritten to satisfy a test.

Production rollback base: 06f341a021556598dd7509240bb934df13855da9. Capture a D1 bookmark before migrating; leave additive columns/tables in place if rolling the Worker back. Do not remove owner accounts, revisit recovery links, or alter existing payment-provider credentials.
