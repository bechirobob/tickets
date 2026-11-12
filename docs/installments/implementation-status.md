# SeevCash installments: delivery checkpoint

## Approved scope
- The planned January event costs GHS3,200; details are not final. No listing or live price changed.
- SeevCash both full and partial payments for opted-in events. GHS1,000 steps, final remainder; clear balance anytime.
- First confirmed payment: one ticket set and Room access. Entry QR/wallet remain blocked until fully paid.
- Existing event payment methods remain unchanged. No invented forfeiture, deadline or refund terms.

## Candidate implementation (not deployed)
- Additive migrations0072/0073: immutable booking/payer/provider/environment/total ledger, child attempts and sessions; event settings default absent/off.
- Initial order, plan, charge and provider request persist atomically before network contact.
- Server-calculated amounts; per-child idempotency and exact provider verification; one unresolved attempt per booking; duplicate callback and overpayment guards.
- Unknown checkout beyond provider24h dedup window held for manual review, never blindly retried. Old unresolved bookings remain in recovery.
- Explicit part_paid entitlement and same ticket set across payments; separate paid-only admission/wallet/offline gates.
- Original buyer only for balance payment, via verified booking email or original claimed checkout session; transferred tickets never grant payer authority.
- Checkout and My Nights show today amount, paid and remaining. Child success recovered on callback, authenticated poll or scheduled task.
- Per-charge durable receipts use existing transactional email identity and distinguish deposit from paid-in-full.
- Refund evidence puts booking on hold and voids tickets pending per-charge reconciliation; gross ledger cannot incorrectly unlock admission after refunded deposit.

## Activation/release gates
- No event has been enabled. Configure the actual event only after final listing details and total fee presentation are settled. GHS3,200 is face price unless existing fee policy is intentionally changed; never add provider processing fees as a second customer fee.
- Finish exact-head CI, independent review, browser checks and deployed provider sandbox integration before enabling. Mocked provider tests are not proof of a real provider transaction.
- Live purchase/refund transactions need their own authorization. This build has made none.
- Seev refunds remain manual evidence/reconciliation; no invented refund API. Failed/uncertain child attempts are held, not automatically replaced.

## Rollout and rollback
Apply additive0072 and0073 migrations before the code; no data rewrite/drop. Deploy with no enabled event rows. Preserve prior release and database recovery evidence.
Disable event enrollment to stop new plan creation. Provider disable stops new charges but recovery remains available. Once funds exist, rollback must preserve ledger, recovery, receipts and balance visibility; never drop payment history or deploy an old gate/claim flow over active partial bookings.

Baseline main6049b25eda0adcfbb25a86c53dbb62f62185358a. Verification details are recorded in the implementation report/PR; candidate is not a live release until provider receipts and production checks exist.
