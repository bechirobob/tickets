# Paid checkout return incident — 15 September 2026

The owner completed a real GHS 1.00 Seev checkout. Provider verification recorded one paid order and issued exactly one ticket. The return page nevertheless showed an incomplete-link error, and its order access grant remained unclaimed.

## Cause and repair

The page called history.replaceState to remove reference/claim parameters before verification completed. Vinext publishes external history changes to useSearchParams. The effect depended on that object, so URL cleanup aborted verification and restarted it without credentials.

PR #148 retains the claim through pending verification and refresh, uses primitive effect dependencies, and removes the return URL through final location.replace navigation. Referrer-Policy remains no-referrer. It does not store the claim in browser storage. A cleared return can recover only the paid order claimed by the exact active session; a consumed token cannot be replayed from another browser or a revoked session. Regression tests cover pending polling, refresh, success navigation, missing credentials, claim races, and session revocation. Shared-navigation GET requests must be distinguished from claim POSTs in browser test mocks.

## Paid test recovery

The original checkout request payload is intentionally cleared after initialization. A scoped operation replaced only the unclaimed access grant on the single paid GHS 1.00 test order. The replacement link was encrypted to an ephemeral key before entering Actions logs; the private key was deleted after retrieval. No payment status, refund status, or ticket issuance was fabricated.

Test sales were stopped after verifying exactly one successful payment and one ticket. Keep the event published temporarily so its purchased-ticket and Room pages remain reachable. After the owner verifies access, use the existing close operation to unpublish the fixture and archive its submission while retaining payment/ticket/audit evidence. Do not reopen the old pending payment or ask for another payment.

## Separate delivery blocker

The payment_confirmation delivery failed with Transactional email is not configured. Cloudflare settings confirm EMAIL_FROM exists and RESEND_API_KEY is absent; no Resend repository secret exists. The email service requires an authorized account connection/key before email receipt delivery can be verified. Do not describe email confirmation as working or mark this delivery sent manually.

## Release evidence

Previous production revision: 4f68c81cb1a4e81d5944b7b0139942f7107e692d.
Final candidate revision: 78343698f22dd7cf9f3f7e30f27d827d7d25a66f.
PR: https://github.com/bechirobob/tickets/pull/148.
Final candidate run: 35037775560. Native run: 35037775607. All desktop Chromium, mobile Chromium, mobile WebKit, Android, iOS and packaged web-client jobs passed. Payment-return mocks explicitly block service workers: the WebKit trace showed a service worker bypassing the second intercepted poll and reaching the real server with the dummy reference.
Deployed revision: 20eef5865316e68c700bd41f7fe7e7d08179615a.
Cloudflare version: e671e06c-c9e2-4feb-8cd2-3c3e776ab530.
Deploy run: 35038481980, job 104612824292, success. The custom-domain version matches; release smoke checks passed public routes, privacy checks and unsigned webhook rejection. The new unauthenticated return recovery correctly returns 401 and the live page shows its recovery guidance. The owner's replacement paid-ticket link remains unconsumed so the owner can claim it on their own device. Customer-visible QR/Room access still requires that click; do not claim it already happened.

Resend sign-in succeeded through the owner's chosen GitHub method. No sender domains exist. Automatic approval review explicitly rejected adding tickets.becoreops.com because persistent sender-domain registration needs the user's explicit approval. Do not retry through another route. Ask for that domain registration and verification DNS setup after delivering the completed checkout fix. No domain or sending key has been created. Once sender setup is approved and verified, configure a sending-only key in encrypted secrets and retry only the failed receipt through the normal delivery path (its not-configured failure currently has no next_attempt_at).
