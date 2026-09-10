# Whole-system audit — 10 September 2026

Baseline: main and production `80288d571c3a5007449623963dc5881f291abaf3`, Worker `d67a45dc-5986-447a-bb3c-e97a32fde3d0`. The owner authorizes remediation and deployment. Current events, registrations, provider configuration and permanent mobile signing identity remain production data.

## Coverage

Public discovery, event details, checkout/return, RSVP, ticket recovery/transfers, My Nights, Room/Flashes/VIP, notifications, organizer workflows, every Operations destination, permissions, data removal, provider callbacks, scheduled processing, dependency/build/migration gates and desktop/mobile rendering.

## Findings and verification

| Finding | Impact | Remediation / evidence |
| --- | --- | --- |
| Ticket recovery selected the purchaser's orders rather than current ticket ownership | High: transferred tickets could return to the sender; recipients could not recover them | Implemented: recover only current assignments and unassigned purchases; protect claims against concurrent use |
| Transfer acceptance mutated assignments and QR credentials even when its claim lost a race | High: duplicate acceptance could change a valid pass | Implemented: unique claim ownership guards every mutation; reject checked-in, removed and revoked tickets |
| Recovery and transfer links consumed access on GET | Medium: email previews could consume the link | Implemented: inert landing page and explicit acceptance; retain old link compatibility |
| Partial refund callbacks were not idempotent | High: repeated callbacks could overstate refunds and void remaining admissions | Implemented: guarded refund transitions and an atomic reservation before provider requests |
| RSVP announcement consent was stored on the request but absent from the audience | Medium: willing guests appeared unsubscribed | Implemented: preserve original consent without treating it as email ownership or changing consent on retries |
| Paystack orders did not store test/live environment and real checkout lacked the production guard used by Seev | High: sandbox transactions could be treated as production bookings | Implemented: shared availability rules, explicit environment and matching verification |

Baseline checks: 206 Worker/D1 tests passed; npm audit reports zero known vulnerabilities. Previous preview cleanup is complete and must not be repeated as new data deletion.

Additional confirmed fixes:

- Concurrent wallet generation uses one stored QR credential.
- Approved RSVP requests automatically enter the staff door list without creating accounts or sending guest email. Admission remains single-use if a guest later opens My Nights. Cancellation removes door access.
- Door desk is searchable and paginated at ten entries, refreshes automatically, retains failed drafts and handles connection errors.
- Expanded scanner accessibility checks exposed low-contrast status/help text and a white search panel inheriting white text. The full gate workspace now uses readable dark surfaces and consistent controls.
- Registration settings reject deadlines after the start and capacity below allocated paid admissions.
- Expired payments can become verified failures, allowing a later provider choice. Payment-return polling has cancellation and time limits.
- Email retries retain the original provider key, claim work once and do not downgrade delivered messages on older callbacks. Payment confirmation delivery has a stable database identity.
- Room messages and reactions check the current session, profile and admission; both are rate limited.
- Payout reservations account for overlapping settlement periods. Partial payouts retain their ledger and only complete the settlement once its balance is paid. A database trigger enforces the balance ceiling. Unknown refund callbacks create an Operations alert rather than altering a different refund.
- Refund batches derive progress from their ledger and wait for provider confirmation. Failed refunds and resolved disputes cannot reactivate removed or cancelled event tickets.
- Scheduled announcement failures are reported without preventing later jobs from running. External finance and email calls have time limits.
- Customer/member and organizer pages receive private no-store/noindex handling. Malformed public session and waitlist requests return useful errors; removed events cannot accept waitlist or door entries.

Migrations 0041–0042 preserve existing records. 0041 adds claim/refund guard fields. 0042 replaces the one-payout-per-settlement index with a balance guard and supplies door entries for existing approved RSVP guests. Keep the balance trigger on code rollback; do not restore the obsolete unique payout index after partial payouts exist. Baseline Worker version above is the code rollback reference; deployment captures the D1 bookmark.

Validation: baseline 206 Worker tests; full local release suite passed with 227, followed by a passing batch-refund regression (228 total). Added coverage includes concurrent overlapping payout requests and settlement completion. Hosted CI exposed the large cleanup fixture exceeding its default five-second test budget; that case now has a bounded 15-second budget. The two-provider browser fixture explicitly configures its invalid Paystack test credential, matching the new availability rules. Candidate runs must pass against the final commit, including all desktop/mobile browser and expanded Operations checks. No live customer payment, signup or outbound test email is required or performed by this audit.

## References

- [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): keep state changes off GET and validate request origin.
- [Paystack verification](https://paystack.com/docs/payments/verify-payments/): match verified transactions before giving value.
- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/): bound external requests and scheduled work.
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys): retain one key when retrying an uncertain send.
- [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/): keyboard access, readable states and usable controls.

Candidate `9604cb06ad39aa932c38cb966c598e8e6f52e5dd` passed 228 Worker/D1 tests and 312 browser checks in run `34466109546`. PR #124 merged as `6d7bc56f3f4cb33f33c292f025ed6ca19c27711e`.

Deployment `34466945667` applied migration 0041 but rejected 0042 with `incomplete input` before Worker publication. The nested CASE inside the trigger passed local D1 but failed the remote multi-statement query path. The correction expresses the same condition in the trigger's WHEN clause, matching the already deployed capacity guard. Index changes are retry-safe, and an additional direct-database regression proves the ceiling remains enforced independently of application checks. Migration 0042 was not recorded as applied. The baseline Worker remains the live app until the corrected release succeeds.

Pre-migration bookmark: `00002369-00000000-000050e2-3ef3fbd83c7087bc9a34cfccea07e95b`, artifact `10147977063`. Recovery rehearsal `34466945660` passed. Final deployment and production evidence is recorded in the release PRs as verification completes.

PR #125 corrected the migration; deployment `34468352867` published `caaf682dadbe31fdfa620c9f5c732459d57dfd65`, Worker `dda9ac18-8031-4409-adc9-3b47881fa2ee`, after 229 Worker tests and 312 candidate browser checks. Production run `34468557904` passed with 209 cases on the first attempt and one navigation retry. A direct live reload reproduced an early keyboard interaction arriving before the header's client handlers were ready. The follow-up exposes navigation and notification controls only when their handlers are ready, and tests a deliberately delayed script load to prove the first enabled keypress opens the menu. The final release PR records the replacement deployment and verification results.
