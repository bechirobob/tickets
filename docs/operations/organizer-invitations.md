# Organiser invitations on approval

Approving, scheduling or publishing a submission provisions an active organiser account for its contact email and assigns that event. Existing activated organisers keep their credentials; disabled accounts and other staff roles require owner review. Historical submissions are not bulk-invited by this migration.

New organisers receive a branded password-setup email through the existing Resend delivery service and configured `EMAIL_FROM`. Production uses `BeCore Tickets <tickets@becoreops.com>`. The link expires after 48 hours and works once. Password setup uses the existing staff password policy, revokes earlier sessions/challenges and then directs the host through normal sign-in to `/organizer/workspace`; MFA remains enforced.

## Operations

Open an accepted submission in Curation to inspect **Organiser access**, or select the organiser under **People & permissions**. The panel shows activation and email state, and offers **Send invite**, **Resend invite** and **Refresh status** as appropriate. Resending replaces the previous link and has a one-minute cooldown. Activated accounts use the existing password-recovery process rather than another invitation.

The invitation and email outbox commit together before contacting the provider. Approval records a pending-access flag so the scheduled worker can recover interrupted provisioning. Delivery failures follow the existing retry policy; expired, replaced, used or revoked invitations are suppressed before sending. Account email, role, status or password changes invalidate pending setup. Tokens are hashed in the invitation table, held transiently in the email outbox and removed from browser history before activation requests; activation responses are private and non-cacheable.

## Release and verification

Migration `0048_organizer_invitations.sql` adds the invitation table and pending-access marker with a zero default. Apply it before publishing the Worker. The change is additive; the previous Worker can run against the migrated database. Preserve the standard pre-migration D1 recovery bookmark through the release workflow.

Automated tests cover approval through the API, event assignment, repeat approval, existing credentials, concurrent one-time activation, session revocation, expiry, account changes, resend cooldown, stale-email suppression, delivery retries, interrupted provisioning, permissions and CSRF. Browser journeys cover desktop and mobile password setup, private URL handling, accessibility, expired links, mismatched passwords and retryable failure.

Live checks should verify the deployed commit and route security headers. A real inbox-delivery confirmation requires an actual newly approved host; no historical invitation campaign or production test account is required for release verification.
