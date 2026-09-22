# Booking confirmation notifications

Guests can enable **phone confirmations** after submitting a new RSVP, in My Nights, on a ticket page, or in The Buzz. Setup is optional and never blocks registration, payment, or ticket access. The browser asks permission only after a tap. Show success only after the subscription and preference have been saved on the server.

## Delivery and consent

- Booking confirmations and Room alerts have separate device flags. Existing Room subscriptions retain their behavior and do not suppress receipts until the guest explicitly enables confirmations. A new booking-only subscription does not enable Room chat push.
- Confirmation delivery always persists an authenticated inbox item. An active, opted-in device must receive acceptance from its push provider before email is suppressed. Missing configuration, no eligible device, encryption/network failures and rejected subscriptions use the existing email outbox. A 404 or 410 revokes the endpoint. Email quota and retry behavior is unchanged.
- `confirmation_deliveries` gives each payment or registration version one durable channel decision. Concurrent callbacks use a two-minute lease. Crashes can repeat a push after lease expiry; a stable tag lets the phone replace it. Email retains its existing idempotency key. Exactly-once external delivery is not promised.
- Host approval enqueues RSVP delivery. Scheduled processing repairs missed queue writes and drains state changes; queue messages process one registration or purchase per invocation to preserve the database budget. Confirmation messages carry an authenticated My Nights URL, never a QR credential or recovery token.
- Push-provider acceptance does not prove that a banner appeared or was read. Offline devices, Focus, OS notification settings and expired alerts can prevent display. The guest can always check My Nights or recover access by email.

## Ownership and recovery

Only a newly created RSVP can bind its submitting session. An unverified profile is durable but grants no access to other bookings under the typed email. Repeating someone else's email never issues a session or exposes their registration. A confirmed RSVP issues real zero-cost QR tickets to its owner; requests and waitlists do not grant admission. Host approval, capacity and Room access remain independent checks.

Returning paid buyers are associated with their current authenticated profile only when the checkout email matches it. Fulfillment assigns only that new order. Returning in the same browser preserves the session and preferences. Opening the one-use checkout claim in another browser produces an isolated order session, never access to the existing account's other tickets. First-time buyers without an enabled device receive email and can opt in afterward for future confirmations.

Email recovery proves inbox ownership and transfers recoverable tickets and registrations to the verified owner. Legacy RSVP requests can also request recovery. Signup retries preserve the original name, party size, consent and attribution. Marketing announcement consent is separate from confirmation consent.

## Platforms and release

Android browsers that support web push can ask permission without installation. iPhone and iPad web push requires a supported Home Screen web app (iOS/iPadOS 16.4 or later). The optional guide explains Share → Add to Home Screen, reopening My Nights, recovering access if needed, then enabling alerts. There is no browser workaround for this platform requirement. This release does not add native APNs/FCM integration to the Capacitor catalogue.

Apply additive migration `0051_confirmation_notifications.sql` before the Worker. Existing VAPID keys and subscriptions must be preserved. No new email provider or key rotation is needed. The existing delivery queue and five-minute cron provide recovery. Application rollback can retain the new columns and outbox; old code will resume its previous email behavior, so monitor for repeat receipts during rollback.

Verification covers actual encrypted push construction with mocked provider responses, failed/expired subscriptions, explicit consent, concurrent routing, device-bound RSVP ownership, verified recovery, returning/cross-browser purchase claims, real QR check-in and host recap. Browser permission and install-flow checks use isolated fixtures on desktop Chromium, Android Chromium and iPhone WebKit. Physical-device lock-screen delivery still needs a real-device acceptance check; simulated permission is not that proof.
