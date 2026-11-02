# Customer release readiness — not deployed

Live/main baseline verified by remote ref: `32b5956549cb3eff04e2abbcfda177bccb07b0f8`.
Reviewed diagnostic snapshot: `f0920bedfca81d642c93b53c57346caf070c8ab1`, tree `aa280e15a2b359fd978be23ae0ed0e127a6c8ba2`.
Branch: `feat/customer-experience-20261102`. This documentation/evidence follow-up changes no executable source. Its exact final commit/tree are supplied in the handoff; use that SHA, never a floating branch, for candidate verification.

## Scope reconciled

| Surface | Delivered or deliberately retained | Verification |
|---|---|---|
| Home / The Drop / Hosts / About | Customer next steps replace primary organiser submission; compact headings, visible native filters, narrow stacked filters, direct My Nights | Compiled desktop/390/320 browsing, filter reset, long selection, zero-event views; original and follow-up screenshots |
| Event | Compact poster/facts and labelled jump to existing Tickets/RSVP access panel | Compiled event → checkout/RSVP; synthetic closed/cancelled and focus guards |
| Checkout | Visible quantity, optional discount disclosure, readable expanded label, compact summary | Real local quote/error handlers, totals/fees and separate consent, saved-order interruption; synthetic repeated submissions and idempotency |
| RSVP | Existing form reached directly; confirmation/ownership preserved, no replacement flow | Both hosted engines:202/canManage, saved confirmed row/order/owner, Secure cookie, authenticated200 confirmed, My Nights/QR |
| My Nights / recovery | Compact recovery and booking rows, plain tabs, clearer actions | Real local bookings, tabs/search/Back/Forward; fictional unknown-address recovery; link reachability ≥44px and real destination navigation |
| Navigation / icons / notifications | Existing header/dropdown/dock retained; consistent labelled controls, decorative icon tiles removed; no new bottom navigation | Keyboard opening/Escape/focus return, named44px targets; settled opaque menu; source review and existing panel regressions |
| Loading / empty / errors / mobile forms | Customer empty actions, matching poster skeleton, existing retry/privacy and uncertain-payment safeguards retained | Compiled empty/error/interrupted journey checks; synthetic loading/retry/double-action tests; viewport/axe checks |
| Invitations / Yorke | Existing early-access signup/withdrawal is appropriate; no invented ticket invitation | Source review, existing regressions, required fields/consent and keyboard/axe browser checks; no submission |
| Room / Flashes | Established assets, controls, access rules and behaviour retained | Source unchanged; Worker/UI regressions and My Nights access affordances; no new live communication claim |
| Staff / Operations | Earlier live dashboard work remains unchanged by this increment | No customer-branch changes to staff/organiser operations implementation or authentication |

## Current evidence and provenance

- Parent independently verified full run161 at `2b56a4d072e55de8a2e01d1d100348fbfb5d38c3`:24 completed compiled check groups per engine, desktop/390/320 Chromium and WebKit, zero page errors. Four previously implicated RSC paths returned200 `text/x-component`. Full run ID:41455676657.
- [Focused run162](https://github.com/bechirobob/tickets/actions/runs/41457813899) at exactf0920bed passed three390px WebKit empty captures. Parent reviewed original pixels: naturally hidden intro, unobscured heading, readable customer actions/navigation, no overlap. All three PNGs SHA256 `1d8f88b6c93583b2f72d5fd2e87356342a09c5c0a733467b381ea8a43c1175f5`. Artifact13147886956 ZIP SHA256 `1860e309fcd2a0348f2ee8918420a577717111e658548aa2b9cd85a62af9979c`. Zero errors/outbound attempts; temporary database removed. This closes only the capture gap and does not replace full161.
- Original failed159 (`41451355779`) and160 (`41453460812`) remain preserved. The HTTP/Secure-cookie cause of159 was a hypothesis; corrected confirmed-state behaviour is proven. Run160's four RSC errors are not erased by161; rapid interrupted navigation is not exhaustively proven by settled-navigation success.
- Application/lib/styles/worker/dependency/mobile bytes are identical between earlier compiled snapshotef2e534f, full161 source2b56a4d and focused162 sourcef0920bed (verified Git diff). Later changes were harness diagnostics/readiness, workflow selection, tests and evidence. Therefore full browser product evidence remains applicable; it does not imply every later diagnostic mode received a full-suite rerun.
- Fresh final `npm test` atf0920bed passed **1,870 tests**:77 tooling +324 repository +308 UI +11 password-client +5 rendered +1,145 Worker (90 files). Includes production build and local deployment preparation, not deployment. Fresh typecheck passed; lint0 errors/4 existing warnings; root/mobile audits0 vulnerabilities each. [Saved logs](evidence/release-readiness/) preserve actual output, including expected negative-path Worker diagnostics and local Wrangler log-location warnings; process exits were0.
- Independent final source review found no new application blocker and confirmed all agreed surfaces have delivered or reviewed-retained treatment.

## Reviewable preview and limits

Use the [compiled screenshot index](COMPILED-VERIFICATION.md#evidence), [immutable before/after comparison](SCREENSHOTS.md), and hosted original artifacts reviewed by the parent. GitHub evidence is not a running user preview. No hosted application preview or Library ID is claimed. Older splash/intermediate captures are superseded only by their explicit settled follow-ups; originals remain intact.

Unrun by design: physical iPhone/Safari, successful external payment/provider completion, email delivery and real email-link claim, live Room/Flashes communication, and actual Yorke signup/withdrawal transport. Fictional local handlers, seeded session, blocked providers and existing regressions are the stated evidence boundaries. No production customer data, messages, credentials or financial actions were used. No new BoardUI integration/dependency is claimed for this native customer UI pass.

## Remaining release gates and approval proposal

1. Run existing `candidate-parallel-checks.yml` on the exact published handoff source, `expected_source=<same SHA>`, `trusted_base=32b5956549cb3eff04e2abbcfda177bccb07b0f8`. This is isolated candidate evidence, not activation. Parent owns dispatch. Inspect exact attempt, all required jobs and original artifacts; any failed stale assertion needs diagnosis, not an exception or blind retry.
2. Existing `ops/vps/code-release.py` admits named historical source families and manual branch `release/tickets-reconciled-20261102`; it does **not** admit this new customer branch/source from live32b595. Candidate CI success alone cannot authorize release.
3. Smallest proposed admission change, **not implemented or approved here**: independently reviewed change limited to `ops/vps/code-release.py` and `ops/vps/test_code_release.py`, adding one customer family anchored to live32b595, the exact reviewed final snapshot/tree and one explicit manual candidate branch. Compare the complete mode/blob inventory against that snapshot, permitting only the two independently merged control files to differ. Keep existing families, provenance, audit, runtime, actor, permissions and activation checks unchanged. Reject wrong base/tree/branch/event, any extra path/mode/blob, migrated schema, changed dependencies, altered control bytes or missing exact-run evidence. No wildcard/prefix admission or advisory waiver.
4. After approval and independent control review, prepare a new isolated release candidate with exactly the snapshot plus trusted control bytes; record its new tree and inventory and run the existing exact-source candidate/runtime verification. Only the authorised release owner may then consider merge/activation and public verification. No production operation is authorised by this document.

Draft PR is prepared but not published: `.github/workflows/browser-followup.yml` matches changed discovery/Room test paths and automatically uses `E2E_BASE_URL=https://tickets.becoreops.com` on PR creation. This would start a production-facing job outside this isolated preview task. No tool denial occurred and no alternate publication route was attempted. The separate denied host-test479aba1 remains untouched. Source branch publication is safe:35 push workflows inspected, none match this branch or a wildcard. No release controls were changed.

## Complete reviewed snapshot inventory

The f0920bed snapshot changes **185 paths**, including ten application/style files, diagnostic workflow/tests/helpers, docs and screenshots. This is not a ten-file-only release. The documentation follow-up adds this report and five final check logs and updates three existing ledgers, making the final branch **191 changed paths** against live32b595. Exact final mode/blob inventory is generated after commit and supplied with the handoff; Git diff remains authoritative. No dependencies, migrations, APIs, worker logic or release guards changed.

<details><summary>All185 paths in the browser-reviewed snapshot</summary>

```text
.github/workflows/booking-consent-previews.yml
app/about/page.tsx
app/checkout/[slug]/checkout-form.tsx
app/customer-experience.css
app/event-explorer.tsx
app/event/[slug]/event-screen.tsx
app/events/events-screen.tsx
app/home-screen.tsx
app/hosts/page.tsx
app/my-nights/my-nights-client.tsx
docs/customer-experience/COMPILED-VERIFICATION.md
docs/customer-experience/HOSTED-VERIFICATION.md
docs/customer-experience/README.md
docs/customer-experience/SCREENSHOTS.md
docs/customer-experience/evidence/after-capture.log
docs/customer-experience/evidence/after/desktop-browse.png
docs/customer-experience/evidence/after/desktop-checkout.png
docs/customer-experience/evidence/after/desktop-empty.png
docs/customer-experience/evidence/after/desktop-event.png
docs/customer-experience/evidence/after/desktop-nights.png
docs/customer-experience/evidence/after/desktop-recovery.png
docs/customer-experience/evidence/after/desktop-rsvp.png
docs/customer-experience/evidence/after/layout-results.json
docs/customer-experience/evidence/after/mobile-browse.png
docs/customer-experience/evidence/after/mobile-checkout.png
docs/customer-experience/evidence/after/mobile-empty.png
docs/customer-experience/evidence/after/mobile-event.png
docs/customer-experience/evidence/after/mobile-nights.png
docs/customer-experience/evidence/after/mobile-recovery.png
docs/customer-experience/evidence/after/mobile-rsvp.png
docs/customer-experience/evidence/after/narrow-browse.png
docs/customer-experience/evidence/after/narrow-checkout.png
docs/customer-experience/evidence/after/narrow-empty.png
docs/customer-experience/evidence/after/narrow-event.png
docs/customer-experience/evidence/after/narrow-nights.png
docs/customer-experience/evidence/after/narrow-recovery.png
docs/customer-experience/evidence/after/narrow-rsvp.png
docs/customer-experience/evidence/before-capture.log
docs/customer-experience/evidence/before/desktop-browse.png
docs/customer-experience/evidence/before/desktop-checkout.png
docs/customer-experience/evidence/before/desktop-empty.png
docs/customer-experience/evidence/before/desktop-event.png
docs/customer-experience/evidence/before/desktop-nights.png
docs/customer-experience/evidence/before/desktop-recovery.png
docs/customer-experience/evidence/before/desktop-rsvp.png
docs/customer-experience/evidence/before/layout-results.json
docs/customer-experience/evidence/before/mobile-browse.png
docs/customer-experience/evidence/before/mobile-checkout.png
docs/customer-experience/evidence/before/mobile-empty.png
docs/customer-experience/evidence/before/mobile-event.png
docs/customer-experience/evidence/before/mobile-nights.png
docs/customer-experience/evidence/before/mobile-recovery.png
docs/customer-experience/evidence/before/mobile-rsvp.png
docs/customer-experience/evidence/before/narrow-browse.png
docs/customer-experience/evidence/before/narrow-checkout.png
docs/customer-experience/evidence/before/narrow-empty.png
docs/customer-experience/evidence/before/narrow-event.png
docs/customer-experience/evidence/before/narrow-nights.png
docs/customer-experience/evidence/before/narrow-recovery.png
docs/customer-experience/evidence/before/narrow-rsvp.png
docs/customer-experience/evidence/comparison.json
docs/customer-experience/evidence/compiled/checks/audit.json
docs/customer-experience/evidence/compiled/checks/build.log
docs/customer-experience/evidence/compiled/checks/lint.log
docs/customer-experience/evidence/compiled/checks/mobile-audit.json
docs/customer-experience/evidence/compiled/checks/password.log
docs/customer-experience/evidence/compiled/checks/rendered.log
docs/customer-experience/evidence/compiled/checks/repo.log
docs/customer-experience/evidence/compiled/checks/tooling.log
docs/customer-experience/evidence/compiled/checks/types.log
docs/customer-experience/evidence/compiled/checks/ui.log
docs/customer-experience/evidence/compiled/checks/worker.log
docs/customer-experience/evidence/compiled/desktop-discount.png
docs/customer-experience/evidence/compiled/desktop-discovery.png
docs/customer-experience/evidence/compiled/desktop-empty.png
docs/customer-experience/evidence/compiled/desktop-home-hosts.png
docs/customer-experience/evidence/compiled/desktop-hosts.png
docs/customer-experience/evidence/compiled/desktop-menu.png
docs/customer-experience/evidence/compiled/desktop-my-nights.png
docs/customer-experience/evidence/compiled/desktop-payment-interrupted.png
docs/customer-experience/evidence/compiled/desktop-recovery.png
docs/customer-experience/evidence/compiled/desktop-rsvp-result.png
docs/customer-experience/evidence/compiled/desktop-yorke.png
docs/customer-experience/evidence/compiled/mobile-discount.png
docs/customer-experience/evidence/compiled/mobile-discovery.png
docs/customer-experience/evidence/compiled/mobile-empty.png
docs/customer-experience/evidence/compiled/mobile-home-hosts.png
docs/customer-experience/evidence/compiled/mobile-hosts.png
docs/customer-experience/evidence/compiled/mobile-menu.png
docs/customer-experience/evidence/compiled/mobile-my-nights.png
docs/customer-experience/evidence/compiled/mobile-payment-interrupted.png
docs/customer-experience/evidence/compiled/mobile-recovery.png
docs/customer-experience/evidence/compiled/mobile-rsvp-result.png
docs/customer-experience/evidence/compiled/mobile-yorke.png
docs/customer-experience/evidence/compiled/narrow-discount.png
docs/customer-experience/evidence/compiled/narrow-discovery.png
docs/customer-experience/evidence/compiled/narrow-empty.png
docs/customer-experience/evidence/compiled/narrow-home-hosts.png
docs/customer-experience/evidence/compiled/narrow-hosts.png
docs/customer-experience/evidence/compiled/narrow-long-filter.png
docs/customer-experience/evidence/compiled/narrow-menu.png
docs/customer-experience/evidence/compiled/narrow-my-nights.png
docs/customer-experience/evidence/compiled/narrow-payment-interrupted.png
docs/customer-experience/evidence/compiled/narrow-recovery.png
docs/customer-experience/evidence/compiled/narrow-rsvp-result.png
docs/customer-experience/evidence/compiled/narrow-yorke.png
docs/customer-experience/evidence/compiled/provenance.json
docs/customer-experience/evidence/compiled/results.json
docs/customer-experience/evidence/empty-capture-followup/capture-hashes.json
docs/customer-experience/evidence/empty-capture-followup/mobile-empty-1.png
docs/customer-experience/evidence/empty-capture-followup/results.json
docs/customer-experience/evidence/final-build.log
docs/customer-experience/evidence/final-empty-state.log
docs/customer-experience/evidence/final-rendered.log
docs/customer-experience/evidence/hosted-preflight/chromium-results.json
docs/customer-experience/evidence/hosted-preflight/lint.log
docs/customer-experience/evidence/hosted-preflight/tooling.log
docs/customer-experience/evidence/hosted-preflight/types.log
docs/customer-experience/evidence/https-followup/desktop-hosts.png
docs/customer-experience/evidence/https-followup/lint.log
docs/customer-experience/evidence/https-followup/manifest.json
docs/customer-experience/evidence/https-followup/narrow-menu.png
docs/customer-experience/evidence/https-followup/narrow-recovery-events-reachable.png
docs/customer-experience/evidence/https-followup/narrow-recovery-help-reachable.png
docs/customer-experience/evidence/https-followup/narrow-rsvp-my-nights.png
docs/customer-experience/evidence/https-followup/results.json
docs/customer-experience/evidence/https-followup/tooling.log
docs/customer-experience/evidence/install.log
docs/customer-experience/evidence/interactions.log
docs/customer-experience/evidence/interactions/browser-results.json
docs/customer-experience/evidence/interactions/desktop-checkout-validation.png
docs/customer-experience/evidence/interactions/desktop-discovery-empty.png
docs/customer-experience/evidence/interactions/desktop-discovery-filter.png
docs/customer-experience/evidence/interactions/desktop-my-nights-empty.png
docs/customer-experience/evidence/interactions/desktop-my-nights-error.png
docs/customer-experience/evidence/interactions/desktop-my-nights.png
docs/customer-experience/evidence/interactions/desktop-notifications.png
docs/customer-experience/evidence/interactions/desktop-rsvp-error.png
docs/customer-experience/evidence/interactions/mobile-checkout-validation.png
docs/customer-experience/evidence/interactions/mobile-discovery-empty.png
docs/customer-experience/evidence/interactions/mobile-discovery-filter.png
docs/customer-experience/evidence/interactions/mobile-my-nights-empty.png
docs/customer-experience/evidence/interactions/mobile-my-nights-error.png
docs/customer-experience/evidence/interactions/mobile-my-nights.png
docs/customer-experience/evidence/interactions/mobile-notifications.png
docs/customer-experience/evidence/interactions/mobile-rsvp-error.png
docs/customer-experience/evidence/interactions/narrow-checkout-validation.png
docs/customer-experience/evidence/interactions/narrow-discovery-empty.png
docs/customer-experience/evidence/interactions/narrow-discovery-filter.png
docs/customer-experience/evidence/interactions/narrow-my-nights-empty.png
docs/customer-experience/evidence/interactions/narrow-my-nights-error.png
docs/customer-experience/evidence/interactions/narrow-my-nights.png
docs/customer-experience/evidence/interactions/narrow-notifications.png
docs/customer-experience/evidence/interactions/narrow-rsvp-error.png
docs/customer-experience/evidence/lint.log
docs/customer-experience/evidence/mobile-audit.json
docs/customer-experience/evidence/navigation-followup/lint.log
docs/customer-experience/evidence/navigation-followup/local-chromium-results.json
docs/customer-experience/evidence/navigation-followup/original-webkit-results-from-job-log.json
docs/customer-experience/evidence/navigation-followup/tooling.log
docs/customer-experience/evidence/prepare-local.log
docs/customer-experience/evidence/root-audit.json
docs/customer-experience/evidence/source.json
docs/customer-experience/evidence/tests.log
docs/customer-experience/evidence/trigger-review.json
docs/customer-experience/evidence/types.log
scripts/capture-iphone-layouts.mjs
scripts/customer-experience/capture.mjs
scripts/customer-experience/check.mjs
scripts/customer-experience/compiled-check.mjs
scripts/customer-experience/harness/image.tsx
scripts/customer-experience/harness/index.html
scripts/customer-experience/harness/link.tsx
scripts/customer-experience/harness/main.tsx
scripts/customer-experience/harness/navigation.ts
scripts/customer-experience/serve.mjs
styles/customer.css
tests/browser-audit-harness.test.mjs
tests/browser-environment.test.mjs
tests/e2e/catalogue.ts
tests/e2e/discovery-pass-access.spec.ts
tests/e2e/my-nights-studio.spec.ts
tests/e2e/payment-labels.spec.ts
tests/e2e/room-identity.spec.ts
tests/mobile-ui.test.mjs
```
</details>


## Approved test completion and publication follow-up

The user explicitly approved customer PR publication/read-only checks, bounded exact-source admission, ready/verified merge/deployment, and the named host-navigation fix/release record on2026-11-02. This supersedes the earlier publication deferral. The first PR tool attempt was rejected before this explicit approval; the outcome will be state-checked before one supported retry.

Four stale tests now use the exact current recovery heading/button and Home music-reset label. Home still has its filter disclosure; its alignment/keyboard/forced-colour/axe checks are retained. The Drop's native-select tests remain separate. No assertions were removed or broadened. All five affected existing tests passed on desktop and mobile Chromium:10 passes,0 retries. They used the compiled app with isolated temporary fictional D1, blocked Worker outbound service and blocked external browser traffic; recovery writes remained fixture-intercepted. The temporary runner/config and raw evidence are preserved under evidence/stale-e2e. Fixture cleanup passed. The server logged local certificate handshake diagnostics; this is not a zero-console-error acceptance run and does not replace full161. No new certificate bypass was added to product or shared test configuration. Local WebKit remains unavailable.

Typecheck and affected-file lint passed; fresh normal root npm audit returned0 vulnerabilities. A separate trusted-wrapper audit probe reached npm but failed DNS (EAI_AGAIN); it is not fresh security proof. The candidate workflow may use32b595 as a distinct immutable main ancestor; its checkout verifier and saved-clean-report policy validation passed. The prior controls-only748a5abc applies to historical release admission, not the clean-audit candidate build gate. Future final candidate/runtime evidence must bind the independently approved controls baseline.

Included exactly the approved host branch diff through9ebe6fa: two added test lines in tests/e2e/host-brand-identity.spec.ts (wait for actual Events heading after URL change), and the release record in docs/operations/dual-hosting.md from8ef3e35/9ebe6fa. No host application code changed. The host test's actual browser execution remains part of fresh hosted candidate checks; no local host-flow pass is claimed here. This inclusion is explicitly authorised and is not an alternate route around the prior denial.

This follow-up supersedes the earlier191-path count; the handoff supplies the revised exact complete inventory. Application bytes remain identical to accepted browser sources; only tests, documentation and verification evidence changed. Security controls are still untouched in this snapshot. Full candidate dispatch waits until the exact frozen snapshot and independently reviewed controls identity are coordinated.
