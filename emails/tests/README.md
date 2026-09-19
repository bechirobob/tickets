# Branded email tests

Use the `ops/branded-email-tests` branch and `Branded test email` workflow for owner-authorized previews. Tests must use `BeCore Tickets <tickets@becoreops.com>` through the site's existing Resend delivery service, never the operator's personal Gmail sender.

The approved public templates, logo and RSVP flier are retained here. Recipient addresses and phone numbers do not belong in this public repository. The workflow resolves the exact recipient fingerprint against existing private account and delivery records and sends only one email per request. Receiving a requested test does not require an active staff login, and this workflow never changes staff access. It does not add an RSVP or subscribe anyone to marketing.

For each newly authorized test, edit the approved template and `request.json`: use a new request ID, the exact authorized owner's SHA-256 email fingerprint, and an expiry no more than 48 hours away. Push the request change to the operations branch. Rerunning the same commit does not create another email. An expired request fails closed. This workflow cannot send to the guest list. Each matrix job resolves only its explicitly approved recipient fingerprint.

The existing Worker retains its Resend secret, sender settings, delivery tracking, quota handling and retries. This workflow inserts one `email_preview` delivery record; the existing five-minute cron processes it once its five-minute queue lease expires. A run waits up to 14 minutes for provider acceptance. If it times out, inspect that same delivery ID before starting another request.

Verify the received message's From and authentication headers before describing delivery as verified. Public logs show the request ID, count and provider result only; they do not print recipient addresses or mail credentials. No application deployment, database migration, new paid service or credential export is required.

## Host invitation preview

The September 19 request authorizes one separate copy for each of the two confirmed private test contacts. The matrix reads `request.json` and `request-second.json`; each retains a distinct request ID, recipient fingerprint and 24-hour expiry. `host-invitation` uses the approved invitation and hosted logo without an event flier. The original RSVP event-state and artwork checks remain scoped to the RSVP template. No production site release is involved.
