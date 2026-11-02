# Hosted customer diagnostic handoff

Customer application source remains the ten-file reviewed increment based on live32b595. The hosted diagnostic adds no application changes, credentials, deployment actions or release-admission exceptions. Original PR392 screenshot review is resolved (parent-confirmed12f028c8 and live32b595 verification including WebKit run41444056693); it is not a remaining customer blocker.

Use the existing **Booking consent previews** workflow (`booking-consent-previews.yml`) on branch `feat/customer-experience-20261102`. Set `expected_customer_source` to the exact published branch SHA supplied with this handoff. The new `customer_compiled` matrix refuses a mismatched SHA before npm/source execution. It runs only on this branch and manual dispatch, with contents:read and the established pinned Playwright image. No browser download step is added.

The existing preview job remains intact. The new diagnostic matrix runs Chromium and WebKit independently against the compiled Worker and a temporary, fictional local D1 database. Both engines exercise desktop,390px and320px. WebKit uses touch activation on touch viewports. The helper blocks Worker outbound requests and external browser traffic and cleans up sessions/database. A missing prepared executable is a failure, not a skip. The job uploads only PNG/JSON evidence to `customer-compiled-<SHA>-chromium` and `customer-compiled-<SHA>-webkit`, with three-day retention. It does not upload database files, app builds, credentials, logs or traces.

Three stale existing E2E assertions now match the approved customer CTAs: discovery empty state points to My Nights; Home Hosts section points to Explore nights; payment-label coverage stays in the payment footer. No unrelated host-navigation patch479aba1 was incorporated, published or retried through this branch.

## Status and remaining gates

Local Chromium checks and previously captured visual evidence do not substitute for the hosted results. Hosted WebKit is **pending dispatch/result review**, not passed. Physical iPhone/Safari remains unrun; Linux WebKit is not a physical iPhone claim. Parent owns the single hosted dispatch and its run/artifact review.

This diagnostic is not release admission. After hosted results are reviewed, the existing `candidate-parallel-checks.yml` can separately verify the complete exact source using `expected_source=<reviewed head>` and `trusted_base=32b5956549cb3eff04e2abbcfda177bccb07b0f8`; clean audits need no advisory exception. Its production audit counterpart would test live32b595, not this undeployed preview, and should not be used for candidate evidence.

No release-guard delta is proposed for approval before hosted results. Any later admission proposal must enumerate exact source/tree, complete changed-path inventory and evidence run IDs, preserve the trusted live baseline and existing controls, and admit only that reviewed candidate. Do not widen a branch/path exception or reuse unrelated test-only approvals. No admission controls or inventories have changed in this handoff.
