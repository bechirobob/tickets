# The Yorke Way early-access list

## Scope and state

Requested 26 October 2026: a standalone email signup for Kofi Bills’ year-end
2026 events, sponsored by BeCore Tickets. `/the-yorke-way` is not an RSVP,
ticket, reservation or admission promise. No existing audience is imported.
Preview-first implementation on `feat/yorkeway-early-access`, base `e697952`.
Not published or deployed. Confirmation email flow was approved separately;
campaign delivery is not part of this increment.

## Consent and access

Name, normalized email, exact consent wording/version and timestamp are saved.
Consent starts unchecked; ownership is established only through an explicit
POST from the 24-hour emailed confirmation link. Opening a link does not
change anything. List-only confirmation and withdrawal capabilities are hashed
at rest in the campaign tables. They grant no attendee or staff access.
Existing transactional outbox necessarily stores the message payload containing
the private links, under its existing restricted storage lifecycle.

Duplicate submits have a 15-minute database-enforced cooldown. All signup
responses are generic, with no email-existence or subscription-state disclosure.
A fresh signup cannot reverse a withdrawal without fresh email proof. Revision
binding prevents old proof/withdrawal links from changing a later preference.
Provider-wide suppression remains effective. Campaign capture/confirmation
closes at 00:00 UTC on 1 January 2027 (Accra year end); unsubscribe remains open.

Only the owner can view the confirmed list at `/admin/yorkeway-audience`.
No provider contact import/export, host grant, campaign, paid resource or new
credential is introduced. Existing preview cleanup preserves these records.
The normal schema-driven database backup includes the additive tables.

## Delivery boundary

The new `yorkeway_confirmation` kind uses the existing transactional pipeline
and approved customer email shell. It currently selects Resend, without
expanding the VPS mail allowlist. Actual production provider configuration and
capacity must be checked before release. No real email was sent in local tests.
Retries suppress expired, used, superseded or provider-suppressed proof.

## Verification

Focused synthetic SQLite and Worker suites cover consent validation, duplicate
capture, confirmation, expiry, withdrawal/replay, suppression, request origin,
body bounds and anonymous list access. Record final exact-candidate results
before release. UI and email preview review precedes publication. No local
passes establish production configuration, delivery or deployed readiness.
