# Suppression-preserving rollback candidate

This isolated candidate starts from 75af4f8e57393ddbed7bd05a31e636098c4532ab. Its only runtime change is lib/email-delivery.ts, byte-identical to the reviewed host-push candidate's suppression. It prevents organizer_signup email for RSVP registrations and suppresses unsent queued/failed retries. Guest confirmations/access, paid and interest signup emails, recovery, support, announcements and other email kinds keep their existing paths. Mail already accepted by a provider cannot be recalled.

No runtime migration, push subscription UI/dispatcher, worker, permission or global email setting changes. On the original schema it suppresses host RSVP email before push exists. On the later additive0063 schema it also leaves subscriptions and pending push rows intact. It cannot dispatch push alerts: during the short preparation interval or while this fallback is active, hosts must use the roster until the push release is restored. Pending pushes remain subject to the final dispatcher's normal eligibility/consent and24-hour horizon.

Release sequence, subject to independent review and all existing gates:

1. Review/merge the separately anchored exact suppression-only controls F, then the suppression-only application descendant R. Generate clean full candidate/browser and exact main runtime evidence. No0063 migration belongs to this release.
2. Deploy R through the existing guarded workflow with expected_active=75af4f8e. Verify the active identity and selective suppression before proceeding. R's own failed activation reverts to the existing baseline; do not attempt push unless R activated successfully.
3. Reconcile the final push control proposal on top of verified R, preserving R's suppression byte-for-byte. Obtain independent review and current CI/runtime artifacts for those exact descendants; do not reuse earlier trust commit IDs or build artifacts.
4. Deploy the push descendant with expected_active=R. The unchanged operator's automatic code rollback now restores the verified R runtime, preserving suppression and live additive schema/bookings. Do not restore an old database.

This creates a known-good rollback runtime using the existing previous-runtime mechanism; it does not change the operator rollback logic or select a substitute after failure. R is only a proposed locally tested candidate until the production gates and active verification complete. No deployment is authorized by this document alone.

The test-only SQL fixture is an exact SHA256-checked copy of0063 for post-failure compatibility tests, not an admitted production migration. Tests mock all provider HTTP calls. No external email or customer notification is sent.
