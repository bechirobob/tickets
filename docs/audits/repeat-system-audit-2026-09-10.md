# Repeat Tickets audit — 10 September 2026

Baseline: `bechirobob/tickets`, main `721848ebfd6fab0f64def00298e101a7755224d5`. Deployment run `34473959349` and production browser run `34474148693` both succeeded for that commit. Work is on `audit/full-system-2026-09-10`. Standing project authority covers audit fixes and their verified release.

## Scope and evidence

Reviewed public discovery and RSVP, payment verification/refunds, ticket ownership and recovery, attendee sessions, Room messages/Flashes/VIP, notifications, staff role boundaries, uploads, cron/email retries, CI/rollback, and the packaged mobile acceptance record. Opened the live homepage, event details, expanded RSVP, navigation and expanded help; inspected the desktop render. The hosted browser matrix covers desktop Chromium, mobile Chromium and mobile WebKit, including expanded Operations and organiser workflows with isolated identities.

Baseline Worker/D1 suite: 229 passed. New failure tests demonstrated the first four defects below before remediation. Tests for a revoked connection confirmed that it received the private message while remaining silent. No evidence of past exploitation was established.

## Findings and repairs

| Severity | Finding and impact | Repair and verification |
| --- | --- | --- |
| High | Room suspension blocked the chat socket but not separate access, photo or VIP HTTP endpoints. | Shared Room authorization now checks suspension and cancelled/postponed event states. Purchase/support access remains separate. Regression checks denial, restoration and retained purchase access. |
| High | A revoked session could continue receiving private chat on an existing silent socket. | Private broadcasts validate current session, profile, admission, payment, event and suspension before sending; invalid recipients disconnect. Current block settings apply to messages, reactions and Flash markers. Recipient queries stay below D1's bind limit. Tested allowed delivery before logout and denial afterward. |
| Medium | Private notifications checked ticket rows without requiring the order to remain paid. | Notification audience now uses current payment and event state. Four regressions cover refund-pending, disputed, refunded and requires-refund purchases with a stale issued ticket. |
| High | A delayed successful payment could issue new admissions after event cancellation. | Inventory consumption, payment transition and ticket issuance now share one D1 transaction. Cancelled/removed events and unavailable inventory enter the existing refund path; reservation and issued ticket state are protected. Cancellation regression and existing duplicate callback/refund tests pass. |
| High | A push subscription could direct authenticated server requests to an arbitrary HTTPS destination. | Validate supported browser push hosts and encryption-key shape on registration; validate stored destinations before delivery and reject redirects. Rate-limit registration and atomically cap active devices at 12 while allowing refresh. Tests cover URL tricks, private destinations and concurrent device registration. |
| Medium | Concurrent Flash uploads could pass separate capacity reads and exceed guest/event/storage limits. A failed broadcast reported failure after the photo was saved. | Enforce all three capacities within the insert statement. Return saved success even if the broadcast fails; the normal list retrieves the stored Flash. Twelve concurrent upload attempts admit only eight. |
| Medium | Simultaneous VIP requests bypassed the one-song queue guard; requests could be accepted after the Room closed. | Queue and hourly limits now apply within the insert, with request throttling and Room lifecycle checks. A reproduced three-request race now creates only one song request; closed Rooms reject new requests. |
| Medium | The moderation workspace expanded every historical event into SQL parameters, exceeding D1's documented parameter limit as the catalogue grows. | Apply owner/assignment scope in SQL with a constant parameter count. A 125-event regression verifies owner visibility and unrelated moderator isolation. |
| Medium | The homepage advertised a ticket price for an RSVP event and could direct registration events with paid tiers into checkout. | Shared discovery offer rules now determine both card labels and hero actions. RSVP/interest actions open registration; cancelled, postponed and sold-out events do not offer checkout. The advertised grills package remains on the event details. Browser assertions use the active registration mode. |
| Low | Mood filters could accept an early click before client handlers were ready. Long venue addresses also made the Room preview dialogue awkward. | Apply the existing readiness guard to mood filters and shorten the preview conversation. |

## Verification and limits

- Local lint and typecheck passed; 259 Worker/D1 tests passed across 39 files, including VIP concurrency/lifecycle and 125-event moderation checks. The complete repository/UI/password/rendered suite and production build passed before those two follow-ups and run again against the final commit in hosted CI.
- Full dependency audit reported zero known vulnerabilities. Packaged mobile behavior/signing-policy suite: eight tests passed.
- Local browser execution could not complete because the environment cancelled its network approval. Browser acceptance must come from the hosted candidate and production runs, not this local attempt.
- Final exact-commit CI, deployment and post-release results are recorded in the release pull request.
- No schema migration or production data cleanup is included. Existing preview deletion is not repeated. No test payment, guest submission, refund, email or push was sent to a real recipient during this audit.
- Live payment acceptance still needs provider activation and a real transaction. Camera/device notifications and native background/resume require physical-device acceptance. Native secure sign-in, private offline passes, native push and store review retain their existing incomplete status; these web fixes do not complete them.
- Code rollback reference is the baseline commit above. No data restoration is required by this patch. The release workflow retains its normal D1 recovery evidence.

## Primary references

- [Cloudflare D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/): batches execute transactionally and roll back on statement failure.
- [Paystack webhooks](https://paystack.com/docs/payments/webhooks/): authenticate provider notifications and handle retries safely.
- [Apple Web Push](https://developer.apple.com/videos/play/wwdc2022/10098/): Safari uses subdomains of `push.apple.com`.
- [Browser push subscription flow](https://web.dev/articles/push-notifications-subscribing-a-user): browser subscriptions provide the endpoint and encryption keys used for delivery.
