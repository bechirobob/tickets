# Hosted customer diagnostic handoff

Customer application source remains the ten-file reviewed increment based on live32b595. The hosted diagnostic adds no application changes, credentials, deployment actions or release-admission exceptions. Original PR392 screenshot review is resolved (parent-confirmed12f028c8 and live32b595 verification including WebKit run41444056693); it is not a remaining customer blocker.

Use the existing **Booking consent previews** workflow (`booking-consent-previews.yml`) on branch `feat/customer-experience-20261102`. Set `expected_customer_source` to the exact published branch SHA supplied with this handoff. The new `customer_compiled` matrix refuses a mismatched SHA before npm/source execution. It runs only on this branch and manual dispatch, with contents:read and the established pinned Playwright image. No browser download step is added.

The existing preview job remains intact. The new diagnostic matrix runs Chromium and WebKit independently against the compiled Worker and a temporary, fictional local D1 database. Both engines exercise desktop,390px and320px. WebKit uses touch activation on touch viewports. The helper blocks Worker outbound requests and external browser traffic and cleans up sessions/database. A missing prepared executable is a failure, not a skip. The job uploads only PNG/JSON evidence to `customer-compiled-<SHA>-chromium` and `customer-compiled-<SHA>-webkit`, with three-day retention. It does not upload database files, app builds, credentials, logs or traces.

Three stale existing E2E assertions now match the approved customer CTAs: discovery empty state points to My Nights; Home Hosts section points to Explore nights; payment-label coverage stays in the payment footer. No unrelated host-navigation patch479aba1 was incorporated, published or retried through this branch.

## Status and remaining gates

Local Chromium checks and previously captured visual evidence do not substitute for the hosted results. Hosted WebKit is **pending dispatch/result review**, not passed. Physical iPhone/Safari remains unrun; Linux WebKit is not a physical iPhone claim. Parent owns the single hosted dispatch and its run/artifact review.

This diagnostic is not release admission. After hosted results are reviewed, the existing `candidate-parallel-checks.yml` can separately verify the complete exact source using `expected_source=<reviewed head>` and `trusted_base=32b5956549cb3eff04e2abbcfda177bccb07b0f8`; clean audits need no advisory exception. Its production audit counterpart would test live32b595, not this undeployed preview, and should not be used for candidate evidence.

No release-guard delta is proposed for approval before hosted results. Any later admission proposal must enumerate exact source/tree, complete changed-path inventory and evidence run IDs, preserve the trusted live baseline and existing controls, and admit only that reviewed candidate. Do not widen a branch/path exception or reuse unrelated test-only approvals. No admission controls or inventories have changed in this handoff.

## Original WebKit failure and bounded correction

Preserve hosted run41451355779 at source896e58a and its original artifacts (WebKit artifact13144726884 reported by the parent). Chromium passed; WebKit stopped at desktop RSVP, before390px/320px. The visible “RSVP received” copy is a generic submission receipt, not proof of a pending host decision. The fixture has capacity100 and approval_required0. The original helper served HTTP while `attendeeCookieHeader` correctly issues HttpOnly/Secure/SameSite=Lax ownership cookies. WebKit's missing confirmed detail is consistent with rejecting that Secure cookie on HTTP. The original run did not record saved registration state/cookie acceptance, so this remains the evidence-supported diagnosis rather than a retrospective claim about unrecorded data.

The harness now uses local HTTPS, matching the established isolated Operations setup; browser-only ignoreHTTPSErrors accepts its local certificate. No product cookie flag, security setting, consent, registration logic or session rule changed. New assertions require HTTP202/canManage, persisted confirmed status with order and owner, a retained Secure cookie, authenticated GET status200 with confirmed state, and the confirmed My Nights/QR action. No fallback assertion accepts merely “received.” Receipts omit cookie values and tokens.

Visual evidence is strengthened independently: Hosts waits for hydrated navigation and an unobscured real directory heading; menu waits for settled animations, opacity1 and its opaque background; recovery links must scroll to an unobscured point, retain44px targets, and navigate with real mouse/touch activation. New viewport screenshots demonstrate these links clear of the dock. Original screenshots are retained; splash-screen Hosts images and intermediate menu captures must not be treated as valid final layout evidence. No animation or native action was removed.
