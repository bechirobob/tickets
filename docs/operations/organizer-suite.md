# Organiser business suite

Authorised 22 September 2026: implement the full HustleSasa comparison recommendations.
Branch: feat/organizer-business-suite. Base: main 94521e6 (includes confirmation notifications).

## Acceptance ledger

- [x] Stable organiser navigation and selected-event context; desktop/mobile views.
- [x] Money totals, settlement/payout history and safe CSV statements.
- [x] Joined guest records with scoped details, support requests and delivery recovery.
- [x] Organiser audience history and consent-aware segments.
- [x] Event team invitations, acceptance, expiry and revocation without role escalation.
- [x] Host-managed promoter links, commission snapshots/refund adjustment and private reports.
- [x] Coupons integrated into checkout, concurrency limits and late-payment checks.
- [x] Reviewed bulk complimentary QR passes with idempotency and admission capacity.
- [x] Duplicate-to-draft with fresh schedule, no copied customers and curated publication.
- [x] Compact text/choice question editor and contextual guides.
- Browser acceptance evidence: [PR #172 checks](https://github.com/bechirobob/tickets/pull/172/checks), including desktop Chromium, mobile Chromium and WebKit.
- [x] D1 integration, payment/permission regression, production build and lint/types.

All changes are additive. Production customer data must not be used for rehearsal.
Commission payment records document external payments; this upgrade does not itself transfer money.
Existing payout approvals and event publication authority remain in place.

All feature flows and Help Centre guides are implemented. PR #172 records the final
acceptance status and exact candidate SHA; a green build alone is not release approval.

Validation so far: 420 worker tests passed across 53 files; repository, UI contract,
password-client and rendered build checks passed. Twelve new integration cases cover
scope, privacy, coupon checkout concurrency, late payments, complimentary idempotency,
current-holder recovery, team acceptance and revocation, commission refunds and CSVs.
Browser tests were updated for the new navigation and business workflows. Local browser
installation timed out; candidate CI is the fallback for all three browser projects.

Changes remain on this isolated feature branch. No production migration, customer email,
financial transfer or deployment has been performed.

Browser checks cover event and workspace navigation, draft preservation, history
back/forward, header containment, accessibility, coupons, promoter reports, questions,
complimentary issuance and joined guest search. Every browser suite runs after successful
fixture setup, even when an earlier browser suite fails, so failures are reported together.
