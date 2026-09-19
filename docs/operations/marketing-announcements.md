# Marketing announcements

Guests remain in the event RSVP/email list regardless of marketing consent. Only
contacts with current event consent are imported to Resend Contacts. Addresses
are lowercased and deduplicated across events; organisers can only select their
assigned event's consenting guests. Provider global unsubscribes also suppress
legacy queued announcements when the periodic contact census observes them.

Announcements use Resend Broadcasts from `BeCore Tickets <tickets@becoreops.com>`.
There is no fallback to the transactional `/emails` endpoint. Existing legacy
announcements retain their delivery records and processor. RSVP/receipt/host
notification emails continue through their existing transactional paths.

## Capacity and connection

The contact census runs at least every six minutes. It checks Contacts, Segments,
and Broadcasts access using the existing Worker `RESEND_API_KEY`. A sending-only
key is reported as blocked; it must be replaced in the Worker secret store with a
key that can manage contacts and broadcasts. Do not put keys in source or logs.

The interface reports a conservative 1,000-contact safety allowance shared across
the Resend account. It includes contacts outside Tickets and reservations made
before provider calls. The reservation high-water count never decreases on
unsubscribe or deletion; the app never deletes contacts to evade a plan limit.
This is a safety counter, not an invoice. Resend's private-beta Usage API is not
required. Resend remains authoritative for billing and account limits. The app
does not change the plan or purchase overages. At capacity, RSVPs continue and
new marketing imports wait. Existing synced recipients remain usable.

## Sending and recovery

Preview is read-only. Send validates the current recipient count and snapshots
the selected consenting contacts. Schedules are stored in UTC and shown in Ghana
time. New signups never expand a queued campaign. Recipients are rechecked before
the broadcast is handed off. Resend enforces its global unsubscribe at delivery.

The minute cron alternates legacy processing and marketing processing. Marketing
continues through the existing email Queue with a 15-second delay between small
batches. Queue batches contain one message to keep each invocation within its
query/subrequest budget. A global ten-minute lease serializes account imports and
campaign preparation. Crons recover missing Queue messages.

Each active campaign owns a private segment. It is created only when due; the
segment name includes the immutable campaign ID so a lost create response can be
recovered. After Resend reports `sent`, the segment is deleted to release free
segment capacity. Cancelled drafts also release their segments. Contacts and
campaign history remain intact.

Broadcast creation makes a draft. Its provider ID is persisted before sending.
The sending state is committed before the send API call. If the response is lost,
the worker retrieves that same broadcast; it never automatically sends again.
If Resend still reports draft, the campaign stays `review`. An owner must inspect
that exact draft in Resend. Do not make a replacement campaign until its outcome
is resolved. A removed/unpublished event cannot dispatch a queued campaign.

Cancellation atomically wins only before `sending`. Hosts see a clear error if
handoff already started. Provider recipient counts are fetched with complete
pagination, refreshed every 20 minutes, and retained locally. `sent` means handed
to Resend; only its recipient events establish delivered/bounced/complained totals.
Open counts are deliberately omitted because they do not reliably prove reading.

## Verification

`tests/marketing-campaigns.test.ts` covers consent, shared deduplication, capacity,
provider opt-outs, permissions, previews, scheduling/cancellation, audience
snapshots, replay protection, provider failures and measured delivery results.
The Operations browser suite checks the branded preview and failed-send recovery
on desktop and mobile. `Marketing connection status` reads only aggregate D1
connection/campaign counts through the existing Cloudflare operator secret; it
does not send mail, expose contact addresses, or read provider secrets.
