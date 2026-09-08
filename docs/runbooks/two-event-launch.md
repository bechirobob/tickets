# Two-event listing release

This release publishes listings, not live ticket sales.

- The Weekend Braai — Birthday Edition: 20 September 2026, 14:00 Accra time; GH₵350 for unlimited grills and drinks; supplied original flier. Closing time and ticket allocation remain unconfirmed. No tiers, capacity claims, or organiser verification badge are created.
- On The Guest List: published, coming soon; existing pink palette, dress code, awareness note and mimosa perk retained. Historical dates stay in the database for audit purposes but public data, metadata, discovery, My Nights and calendar routes do not expose them. Seeded tiers are hidden.
- All is_test_event records are unpublished. Their tiers, purchases and audit records are preserved. The rollover only touches explicitly published previews and cannot revive these retired listings. The seeded preview host is excluded from the public directory.

## Schedule contract

`schedule_status` is confirmed, coming_soon or end_pending. Public dates are nullable. The legacy non-null storage end for Braai equals its start; this is not a closing time and is never published. Calendar exports omit DTEND when unconfirmed. Coming-soon events have no calendar export or Event JSON-LD. Both pending statuses refuse ticket selection and the atomic inventory reservation. Room access and waitlist offers require a confirmed schedule.

`is_verified` is an explicit editorial flag, not an inference from non-test status. Only the previously approved Guest List is marked verified.

## Opening sales later

Confirm allocation, closing time, entry rules and organiser details. Configure verified inventory and its real price; set schedule_status to confirmed only after the date is approved. Do not restore the old seeded Guest List tiers without confirmation. Check the configured live payment provider, checkout fee and merchant destination, then verify an authorised real payment, ticket delivery, refund path and door scan. None of those provider acceptance checks is claimed by this listing release.

## Verification and rollback

The full dependency gate identified new advisories in Next.js, Vitest, sharp and js-yaml. Pin Next.js/eslint-config-next 16.3.4 and Vitest 4.1.11; override transitive sharp to 0.35.4 and js-yaml to 4.3.2. Do not use npm audit's suggested Cloudflare downgrades or waive the gate. The updated tree reports zero advisories; rerun all tests on these versions.

Run npm test, lint, typecheck, drizzle-kit check, dependency audit and exact-head candidate browser checks. The browser suite now tests real pending listings and retired URLs; payment integration tests use explicit isolated inventory, never public preview fixtures. Production workflow captures a D1 Time Travel bookmark before migration 0032. Do not claim that bookmark until the workflow succeeds.

Previous production SHA: ee5096deff9f3d83edb7c935a176ac3c681b39b7; Worker version: 46d7aa32-8db3-4599-b91f-b14c293613ad.

The schema change is additive. Before rolling back to an older Worker, unpublish both pending listings: old code cannot interpret schedule_status and may expose historical dates. Preserve hidden tier states. Prefer a forward fix. No account, order, ticket or host record is deleted by migration 0032.
