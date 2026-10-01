# BeCore Tickets full production audit — 1 October 2026

## Executive result

The full-system audit repaired the 14 original finding groups and additional defects exposed by complete candidate testing. The final candidate passed the hosted core, three-engine browser, packaged-client, iPhone capture, operator and isolated capacity gates. Exact-main runtime verification passed. [PR 220](https://github.com/bechirobob/tickets/pull/220) was merged and the [VPS release](https://github.com/bechirobob/tickets/actions/runs/36933006034) completed successfully, including all three retired-preview checks.

Post-release readiness passed its source, rollback, owner-guard and database-integrity assertions. The first [production browser audit](https://github.com/bechirobob/tickets/actions/runs/36933434401) completed with **FAILURE** while the deployed revision remained stable. Its failures comprised a confirmed Chromium metrics test-header error and inconsistent public-artwork response headers. A subsequent read-only probe verified canonical artwork loading and the expected policy without any application, security or cache change. The [final targeted three-engine verification](https://github.com/bechirobob/tickets/actions/runs/36938458090) passed all 12 unchanged checks with zero retries on attempt 1, completing at 23:06:23 UTC.

The audit is complete within the agreed scope, with no remaining confirmed launch-blocking platform defect. Two low-severity clipping defects and two deferred test-harness maintenance items remain. This conclusion is bounded by the verified evidence and accepted exclusions below. The four historical operational-alert failures were classified and then permanently removed with explicit user approval; independent verification confirmed all four targets absent and the other 14 delivery records preserved. The user reports completing checks on their phone and laptop; that acceptance is recorded as user-reported and does not require repeating those checks. The user has deliberately deferred real USDC settlement until customer demand and accepts it as untested, not a readiness blocker. Signed native/store acceptance is not inferred from the phone/laptop statement.

The real RSVP event remains intentionally **Coming soon**. Kofi remains **Verified host** and existing SeevPlus USDC availability is preserved. The audit did not change the event date, publication, pricing or audience, and did not perform real financial transactions, outbound customer emails or credential changes. Final event details are outside this audit’s readiness scope. The separately approved permanent removal of the exact four historical alert failures is complete and independently verified; protected backups were retained and no message was resent.

## Readiness by journey

- **RSVP:** verified customer, recovery, host and Operations flows passed. The real event remains intentionally Coming soon; final event details are outside this readiness audit.
- **Paid tickets:** isolated checkout, provider-signature, callback, dispute/refund-state and entitlement regressions passed. USDC stays enabled and correctly labelled; real USDC settlement is deliberately deferred and accepted as untested. No real provider transaction, refund or payout is claimed.
- **Packaged client:** build, public-catalogue, artwork and app/web parity gates passed. Phone/laptop acceptance is user-reported. Private journeys intentionally use the browser; signed native distribution and store approval are not established by this audit.

## Scope and exact source

Inventory covers 48 Next page routes, 80 API handlers, public and private customer journeys, all Operations routes, background jobs, durable email delivery, Room WebSockets, SQLite persistence, migrations, VPS release and backups, the preserved Cloudflare fallback, and the separately locked Android/iPhone client. Full route and API appendices are retained below.

| Identity | Verified value |
| --- | --- |
| Audit baseline repository main | `dc034f675121c556e673ecd714e0b334b6b69ee2` |
| Pre-release live application and retained rollback | `7b9db84ddff94a8b54324241dc855d3ab9ac8a8f` |
| Fully tested candidate | [`53f5a0615b80f59d1e84a0098061fed4330fb107`](https://github.com/bechirobob/tickets/commit/53f5a0615b80f59d1e84a0098061fed4330fb107) |
| Merged and released application | [`473bbf40afe1a77a722c8399f91c4dd95f3e40ce`](https://github.com/bechirobob/tickets/commit/473bbf40afe1a77a722c8399f91c4dd95f3e40ce) |
| Identical candidate and merged tree | `51004be28aeae024e286f50b8ddb8c76690db246` |
| Later verification-only diagnostics main | [`33c654f36a1e845f7eb8a920d3ebaabb72d7abab`](https://github.com/bechirobob/tickets/commit/33c654f36a1e845f7eb8a920d3ebaabb72d7abab), tree `be0a1c5b2ebef333ddd7caec5dea955b3f2ab7e8`; live application remains `473bbf40` |

Production-write scenarios were exercised in disposable fixtures or intercepted browser APIs. September Worker/D1 audit and capacity results are historical context, not current VPS production measurements. Tests sharing a fixture or repeated across runtimes are not added together as a unique test count.

Readiness disposition concerns actual platform and operational defects. Canonical public-artwork behavior passed the read-only probe; final targeted verification passed in all three engines. Deferred USDC settlement, final event details and repetition of the user’s completed phone/laptop checks are not readiness prerequisites. USDC remains enabled and correctly labelled. The user’s device checks were not independently reproduced by this audit; no signed-native or store-acceptance result is inferred.

## Repaired findings

| Severity | Defect and user impact | Repair and regression evidence |
| --- | --- | --- |
| High | A live waitlist offer could override cancelled/postponed event restrictions and concurrent requests could reuse it to create more than one checkout | Restrict override to sold-out state, validate and claim the unexpired offer inside the order transaction; concurrent Seev requests create one order/provider call, cancelled/postponed create none |
| High | Stale dispute reminders could reopen terminal state, unknown resolution restore admission, and a partial accepted dispute mark an entire order refunded | Fence terminal provider decisions and atomic winning updates; require explicit remaining-balance evidence for a full refund, keep partial/unknown outcomes under review with admission suspended |
| Medium | Concurrent staff demotion/disable requests could remove the last active owner; concurrent failed logins lost increments and avoided lockout | Add exact additive database owner guard; atomic failure counters preserve lockout; test two simultaneous owner changes and ten concurrent failed logins |
| Medium | A temporary-password account could read organizer activity; password/support actions lacked some dedicated abuse controls | Enforce the same permission boundary and bounded identity throttles; malformed support payloads return validation errors; refund request conversations deduplicate transactionally |
| Medium | Draft/future/withdrawn uploaded event posters were anonymously readable with long-lived caching | Require curation authorization until actual public publication; private previews no-store, public responses revalidate. Previously cached browser copies remain a residual until prior expiry |
| Medium | Valid Room guests could multiply their flood allowance across unlimited sockets | Shared per-attendee action/slow-mode budget, four connections per identity and 2,048 per Room, reject excess with retryable 1013 without evicting current guests; reconnect/revocation/window and 600-guest headroom regressions |
| Medium | Most API parsers trusted transport/body size implicitly, and upload checks relied on Content-Length | Bound actual stream bytes before JSON/text/form parsing, preserving tighter route limits and exact signed webhook bytes; exercise absent/forged lengths and oversized streams |
| Medium | VPS confirmation scheduler called an unimplemented batch queue method; stale queue consumers could delete newer lease work | Implement durable deduplicated batch enqueue; fence acknowledge/retry by claimed attempt; five queue/rate-limit adapter tests now run through the established VPS suite |
| Medium | Receipts created during missing email configuration could remain without a retry; explicit receipt resend reused callback deduplication identity | Preserve due retries without burning provider budget; separate deliberate resend identity while retaining payment-callback idempotency |
| Medium | Reconciliation could call provider/local lifecycle mismatches matched and silently truncate after ten pages; legacy Paystack dispute requests used an incorrect field and lacked required context | Record lifecycle mismatches, including missing or unknown provider status, and fail visibly at incomplete pagination; send documented refund_amount/message and require real provider evidence for a challenge; replace the unsupported Challenge button with an explicit Paystack Disputes dashboard link. No provider action performed |
| Medium | Private owner/host/team links became unusable after initial temporary failures once their bearer fragment was stripped | Bounded in-page inspection retry keeps the token only in memory, distinguishes expired links and never auto-submits a consequential action |
| Medium | RSVP confirmation could hang or report success for an empty successful response; promoter refresh left stale figures looking current | Bounded requests, validated success shape, single-flight loading, explicit stale-report feedback and recovery regressions |
| Low | Privacy retry lacked loading/single-flight state; settings confirmation did not verify saved=true; organizer sign-in dropped its selected workspace context | Preserve settings through failures, confirm actual application success, carry only allowlisted route context through authentication |
| Low | One Room entry test scrolled past a visible conversation before observer state settled; README and scheduled dependency coverage lagged runtime/mobile architecture | Maintain bounded playback-readiness assertion without changing Room behavior; correct VPS/fallback overview and include the independent mobile lockfile in recurring audit |

These 14 finding groups are the original remediation ledger. Additional defects found during candidate verification and their corrected gates are recorded below.

Provider-contract references: [Paystack dispute API](https://paystack.com/docs/api/dispute/)
[dispute lifecycle guidance](https://paystack.com/docs/payments/manage-disputes/)
and [transaction verification states](https://paystack.com/docs/payments/verify-payments/).
Tests use isolated fixtures and mocked provider calls. Focused suites overlap and
must not be added together as a full-suite count.

## Final verification and receipt ledger

All linked run numbers are repository receipts. PASS means a completed successful run unless the row explicitly states otherwise. Intentional skips, earlier failed candidates and corrected test-harness runs remain separately disclosed.

| Gate | Receipt and result | What it establishes |
| --- | --- | --- |
| Exact-candidate core and browser matrix | [36929202481](https://github.com/bechirobob/tickets/actions/runs/36929202481), PASS, all 4 jobs, attempt 1 | Candidate identity, dependency audit, lint, types, build, schema, Worker dry run, 615 Worker tests, 82 repository tests, 44 UI tests, 2 password-client tests and 4 rendered checks |
| Desktop Chromium | Same candidate run, PASS | Public: 168 passed, 70 intentional skips. Operations: 53 passed, 1 intentional skip |
| Mobile Chromium | Same candidate run, PASS | Public and Operations phases passed; Operations: 54 passed |
| Mobile WebKit | Same candidate run, PASS | Public: 174 passed, 64 intentional skips. Operations: 54 passed |
| Repeated and specialist browser phases | Same candidate run, PASS in each engine | 6 keyboard cases, 1 Seev checkout, 1 USDC checkout, 5 RSVP cases and 3 repeated host cases per engine |
| Packaged mobile | [36929202557](https://github.com/bechirobob/tickets/actions/runs/36929202557), PASS, all 3 jobs | Android/iOS build and client-browser gates; phone/laptop acceptance is separately user-reported. Signing-distribution and store acceptance are not inferred |
| Exact-source iPhone capture | [36929202607](https://github.com/bechirobob/tickets/actions/runs/36929202607), PASS | 16 groups, 74 overlapping viewport captures plus 6 baseline comparison captures, and 4 app/web parity checks; selected changed final pixels inspected |
| Release operator | [36929202845](https://github.com/bechirobob/tickets/actions/runs/36929202845), PASS | 120 tests; separately reproduced staged-operator layout also passed 120 tests |
| Compiled runtime and capacity | [36929202508](https://github.com/bechirobob/tickets/actions/runs/36929202508), PASS | Real compiled same-socket rejection/reuse regression; 600 synthetic guests, 1,200 scan races, 72,000 Room deliveries, approximately 29 ms p95, zero delivery errors and 599 reconnects after restart |
| Exact-main VPS runtime | [36932032916](https://github.com/bechirobob/tickets/actions/runs/36932032916), PASS, both jobs | 615 Worker tests, 615 VPS tests, 23 Node tests, 120 operator tests and compiled runtime verification before and after dependency pruning |
| Main release | [36933006034](https://github.com/bechirobob/tickets/actions/runs/36933006034), PASS | Main release job completed at 22:08:08 UTC; all three retired-preview jobs subsequently passed |
| Post-release readiness | [36933390205](https://github.com/bechirobob/tickets/actions/runs/36933390205), PASS | Observed at 22:10:25 UTC: released revision `473bbf40`, rollback `7b9db84`, one active owner, owner guard present, both database checks OK and zero foreign-key violations |
| First post-release production browser audit | [36933434401](https://github.com/bechirobob/tickets/actions/runs/36933434401), FAILURE | Desktop: 155 passed, 79 skipped, 4 failed. Mobile Chromium: 164 passed, 70 skipped, 4 failed. WebKit: 164 passed, 73 skipped, 1 failed. Released source `473bbf40` was stable before and after every engine |
| Historical delivery classification | [36935505744](https://github.com/bechirobob/tickets/actions/runs/36935505744), completed read-only receipt at 22:30:54 UTC | All 4 failures are historical `operational_alert` records with category `transactional_email_not_configured`; no onboarding failures, state changes or resends |
| Public-artwork policy probe | [36937051736](https://github.com/bechirobob/tickets/actions/runs/36937051736), PASS | Live `473bbf40`; all 24 direct samples returned 200 and CORP `cross-origin`; canonical images loaded in all 3 fresh Chromium controls, including an ordinary unrouted browser |
| Authorized four-record removal | [36937809865](https://github.com/bechirobob/tickets/actions/runs/36937809865), PASS at 22:54:29 UTC | Exactly 4 approved historical failures deleted; other 14 delivery row hashes and all other table counts unchanged; integrity and foreign-key checks passed |
| Independent removal verification | [36938116637](https://github.com/bechirobob/tickets/actions/runs/36938116637), PASS at 22:57:49 UTC | Targets absent; 14 delivered, 0 failed, 0 queued; database quick check OK, foreign-key violations zero, health 200 on live `473bbf40` |
| Final targeted production browser verification | [36938458090](https://github.com/bechirobob/tickets/actions/runs/36938458090), PASS, attempt 1, completed 23:06:23 UTC | All 3 jobs passed: 4 unchanged original tests per engine, 12 checks total, zero retries; exact clean application `473bbf40` and stable live identity before/after; endpoint-only analytics-exclusion overlay, no application change |

The capacity measurements come from an isolated hosted runner, not the live VPS. They establish the tested behavior and load in that environment; they are not a production SLA or field-performance promise.

The exact-main deployable runtime is [artifact 11196044822](https://github.com/bechirobob/tickets/actions/runs/36932032916/artifacts/11196044822), SHA-256 `8a523afed37e197bb2ccf30c080ec8e771c0afac8c61b04a08e5a62b5622f495`. The source-bound iPhone artifact is [11195107868](https://github.com/bechirobob/tickets/actions/runs/36929202607/artifacts/11195107868), SHA-256 `d0ea69e4166c40d337209105b594873397628b0bdf80428b45e0eda440309b62`.

### First production browser failure and targeted verification

[Run 36933434401](https://github.com/bechirobob/tickets/actions/runs/36933434401) completed with failure. Every engine verified stable production revision `473bbf40afe1a77a722c8399f91c4dd95f3e40ce` before and after its audit. Desktop recorded 155 passed, 79 skipped and 4 failed; mobile Chromium recorded 164 passed, 70 skipped and 4 failed; WebKit recorded 164 passed, 73 skipped and 1 failed. The [release verification sequence](https://github.com/bechirobob/tickets/actions/runs/36932986427) stopped after this failed browser stage; its preceding release and post-release readiness stages had passed.

The failures fall into two classes:

1. **Confirmed test-harness cause:** Chromium runtime-metric checks applied the global `x-becore-analytics` test header to a third-party Cloudflare beacon request, causing CORS rejection. This establishes a test-header isolation defect, not an ordinary visitor failure. The failed run remains a failure and is not relabelled green.
2. **Public-artwork header inconsistency in the first run:** the desktop direct API response reported `cross-origin`, but its browser image request failed with `NotSameOrigin`. Both mobile direct API responses reported `same-origin`. This first-run evidence is retained. The subsequent read-only probe below established current canonical loading and expected headers at the observed edge; it did not alter the application or security policy.

The [public-artwork probe 36937051736](https://github.com/bechirobob/tickets/actions/runs/36937051736) passed on live `473bbf40`, with matching health/version before and after and unchanged source. All 24 direct samples returned 200 with CORP `cross-origin`. Both canonical public images decoded in all three fresh Chromium controls: original global test header, ordinary browser without routing, and endpoint-scoped test header. The ordinary unrouted control is important because routing disables browser HTTP cache; cache-busted success alone was not accepted as canonical evidence.

The first canonical Cloudflare responses were `EXPIRED`, followed by `HIT` responses. This supports stale edge policy as the explanation for the earlier inconsistency; it is not proof of every Cloudflare point of presence. No cache purge, application change, security-policy change or deployment rerun was used. Probe [artifact 11198458588](https://github.com/bechirobob/tickets/actions/runs/36937051736/artifacts/11198458588), SHA-256 `76ea4bb2c17251ab794bb003aa14af831dbd796cb47356fa95421594139cb8e3`, retains the sanitized observations.

[Targeted run 36938458090](https://github.com/bechirobob/tickets/actions/runs/36938458090) completed successfully on attempt 1 at 23:06:23 UTC. Workflow/test source was `f2ea9d5463dd772211818d889e6ddc2aa997acec`; the tested application remained `473bbf40afe1a77a722c8399f91c4dd95f3e40ce`, tree `51004be28aeae024e286f50b8ddb8c76690db246`. All three jobs passed with 4 tests each and zero retries: [desktop 110624139152](https://github.com/bechirobob/tickets/actions/runs/36938458090/job/110624139152), [mobile Chromium 110624139443](https://github.com/bechirobob/tickets/actions/runs/36938458090/job/110624139443), and [WebKit 110624139556](https://github.com/bechirobob/tickets/actions/runs/36938458090/job/110624139556). Mobile Chromium logged 4 passes in 12.2 seconds at 23:06:20 UTC, with clean source and matching live identity at 23:06:06 and 23:06:20 UTC; the other engines likewise retained matching before/after identity.

The same four original assertions were used in each engine. A test-only overlay confined the analytics-exclusion header to its intended endpoint; no application edit, security-policy change, cache purge or new release was required. Sanitized result artifacts are retained:

| Engine | Artifact | SHA-256 |
| --- | --- | --- |
| Desktop Chromium | [11198709024](https://github.com/bechirobob/tickets/actions/runs/36938458090/artifacts/11198709024) | `8c3f8c7bd03ce736cdb1f0a88b02a010fc95b55a98dd51038ef92d4c4aa9fb48` |
| Mobile Chromium | [11198689799](https://github.com/bechirobob/tickets/actions/runs/36938458090/artifacts/11198689799) | `a9c22a5204496c047546d41f74e2b476859cc9b77e075b1f766ee565f4e9517d` |
| Mobile WebKit | [11199445531](https://github.com/bechirobob/tickets/actions/runs/36938458090/artifacts/11199445531) | `6dbcf6b7522014f3b8aac6b899dbf9f0d68fa9e31ca58ea3576cb53cc1176c0a` |

This completes the bounded verification of the original failing classes. It does not rename the first full production audit as successful or claim a full production-suite rerun. The read-only probe’s observed-edge limitation remains. The endpoint-only header correction exists in the test overlay; maintained main still has global-header behavior, so integrating that correction remains deferred maintenance alongside the disclosure helper.

## Rendered route coverage and evidence provenance

All 48 reachable page routes have current audit evidence: 47 have inspected representative raster captures, and `/payment/return` has rendered functional coverage without a dedicated retained successful PNG. This is representative route/state coverage, not proof of every possible state.

- Desktop public, private and Operations images were inspected. Coverage includes all 13 admin routes, organizer areas and event views, recovery/error/retry states, realistic lists, menus, overlays, keyboard navigation and accessibility assertions.
- The original iPhone review inspected all 80 captures from candidate `bfd0706`. Changed artwork, payment logos and host images were then reviewed from `b9ba236`. A direct `b9ba236` to `53f5a061` diff has no page, component or style changes, so those unchanged layouts remain valid dated evidence. They are not relabelled as new final-source captures.
- Exact `53f5a061` iPhone capture succeeded. Seven selected final pictures were inspected: Home top/footer, host footer, both signed-out Privacy views, My Nights and Buzz access. Final complete private-access pictures supersede the incomplete earlier loading captures. The report does not claim that all 80 final pictures were independently reopened.
- Room insertion traces from `bfd0706` verify all five messages animating and visible at their own insertion in normal and 280-pixel-high viewports, with reduced-motion captures. They do not establish simultaneous visibility of all five messages in a short viewport. These automated traces are distinct from the user’s reported device checks.
- Three desktop loopback samples from `b9ba236` observed LCP of 324 ms, 532 ms and 316 ms, and maximum CLS of 0.001442, 0 and 0.000790 for Home, Drop and a fixture event. All returned 200 with matching source, no page exceptions, no failed critical assets and no broken loaded images. Expected anonymous-session 401 console records were retained. These are short hosted lab observations, not live field Core Web Vitals or device benchmarks.

### Expanded disclosures and Provider record interaction

The maintained disclosure-opening loop used a changing locator set and opened alternating panels. Green route tests therefore did not, by themselves, prove every answer was open. A test-only, source-pinned overlay used the existing final build without rebuilding or changing application code. Its permanent suite maintenance remains deferred while application source is frozen.

| Receipt | Actual result and retained diagnosis |
| --- | --- |
| [Original overlay 36930902164](https://github.com/bechirobob/tickets/actions/runs/36930902164) | 39 passed, 6 failed. Three public Help checks used an owner session and correctly reached admin Help, where 16 answers exist rather than 28. Two mobile registration cases and one mobile Chromium host case enumerated before route-specific data was ready. These failures remain retained |
| [Corrected Help and touch overlay 36931685282](https://github.com/bechirobob/tickets/actions/runs/36931685282) | PASS. Anonymous public Help asserted the exact route and 28 of 28 open answers in all three engines; both mobile emulated-tap cases passed; desktop touch deliberately skipped |
| [Corrected registration and host overlay 36932094616](https://github.com/bechirobob/tickets/actions/runs/36932094616) | PASS. Two targeted routes per engine, zero retries, with explicit loaded-data assertions before unchanged disclosure, axe and overflow checks |

Together these establish 47 distinct passing cases across separately pinned runs, not one fictitious all-green original run. Repeated controls are not double-counted. All 16 admin Help answers were inspected in each engine. All 28 public Help answers are readable in the complete desktop raster. Mobile full-page stitching obscures portions of the final Flash/VIP lines, so every word does not have unobscured mobile raster proof.

The Provider record button opens through pointer input and natural Tab/Enter in all three engines. Its mobile target measures 44 × 40 CSS pixels, and both mobile engines passed emulated touchscreen activation with zero financial writes. The text remains cramped/clipped; verified activation does not erase that visual defect. The user’s reported phone/laptop acceptance is separate evidence, and no repeat device test is requested here.

Overlay patch SHA-256 receipts: original `01b7e01c3a3c517d53c9cdd47455d8e9879041bb3e642d9b8ff6f2b4f3e7ebf5`; corrected Help/touch `e8fe1aa62375a67fb1e408b8f264a41d88e26bf020a7e4a7ab5d18ccf5b8cea3`; corrected route readiness `61000ff0adc5d24181a657c6b85b9966b2b9e07ce350b9b9acdd493059cfbffd`.

## Operational evidence and release safety

### Pre-release observations with original times retained

The [readiness check 36932032844](https://github.com/bechirobob/tickets/actions/runs/36932032844) at 21:57:30 UTC still observed the old live revision `7b9db84`. It found one active owner; the new owner guard was absent, as expected before this release. Database quick checks passed and foreign-key violations were zero. Fresh background-job failures, pending queue, overdue work, alerts, pending confirmations/refunds and the reported order backlog were zero. Four failed delivery records were present; their age and cause were not classified at that observation. The later read-only classification below established their historical dates and common cause; none was resent.

Existing SeevPlus and USDC production configuration was enabled. Canonical/effective configuration equality, key presence, the private backup key and independent Cloudflare recovery-key escrow metadata were verified without exposing values. Resend domain metadata was verified; fresh email delivery, current quota and final sending-allowance responses were not tested. Observed available disk was approximately 22.034 GB, runtime memory approximately 179 MB and process restart count zero. These values are retained as pre-release observations and are superseded for current runtime resources by the post-release receipt below.

The Caddyfile policy was inspected; the configuration actually loaded by the running proxy was not independently verified. Neither source inspection nor expected proxy behavior is a substitute for that check.

### Post-release observations

The independently reviewed [readiness job 110607876249](https://github.com/bechirobob/tickets/actions/runs/36933390205/job/110607876249) observed production at 22:10:25 UTC on 1 October. Service and local health were active on `473bbf40afe1a77a722c8399f91c4dd95f3e40ce`, with current pointer matching and previous pointer `7b9db84ddff94a8b54324241dc855d3ab9ac8a8f`.

- One active owner; new owner-update guard present.
- Application and operations database quick checks OK; foreign-key violations zero in both.
- Minute, five-minute and delivery-loop jobs had fresh success timestamps and zero recorded failures.
- Queued/overdue operations, open alerts, pending confirmations, payment refunds and orders were zero. This is the observed state, not a claim that a real purchase was tested.
- Delivery records: 14 delivered and 4 failed, with the failed count unchanged from pre-release. Age and cause were unclassified at this observation; the later metadata-only receipt below closed that classification. No resend occurred.
- Existing SeevPlus/USDC production flags and required configuration presence were confirmed. Sending-domain metadata was verified, but the receipt explicitly says actual delivery and quota were not tested.
- Private backup key presence and independent Cloudflare escrow metadata were confirmed. The recovery-key value was not read, and replacement-host recovery was not tested; metadata does not prove that recovery exercise.
- Memory: 62,943,232 bytes (62.94 MB). Automatic restarts: zero. Free disk: 21,202,653,184 bytes (21.203 GB), approximately 0.832 GB below the pre-release observation after retaining the new release. Retention was enabled and active; no audit cleanup had occurred at this 22:10 observation. The later separately approved four-record removal is recorded below.

The receipt still reports the proxy's loaded configuration as unverified. The latest off-host, restore-tested backup remains the 07:50 UTC receipt below; this check did not create or restore a new backup.

### Historical email failures classified

The main-only [diagnostics job 110614688247](https://github.com/bechirobob/tickets/actions/runs/36935505744/job/110614688247), observed at 22:30:54 UTC on 1 October, classified all four failed rows without changing delivery state or exposing recipients. Diagnostics source was `63f32cc9a284730136c88c04278630819f1e0dec`; the active application remained `473bbf40afe1a77a722c8399f91c4dd95f3e40ce`. Main had advanced only through a diagnostics-workflow change, not a new application release.

- All four records are `operational_alert`, with exact failure category `transactional_email_not_configured`.
- Creation and last-update dates range from 13 August 2026 at 07:15:35 UTC to 15 September 2026 at 22:25:41 UTC. Each has one recorded attempt, no next-retry timestamp and no update in the preceding 24 hours; none is currently due under retry selection.
- Failed onboarding-related records: zero. Each failed row has a later delivered record of the same kind to the same recipient. Six operational alerts were delivered from 16 to 29 September.
- Later successful delivery does **not** establish that any of the original four messages was resent or delivered. This diagnostic performed zero writes and zero resends, and exported neither recipient values nor free-form error content.

The age-and-cause classification is complete and the unclassified-mail concern is removed from the residual findings. Fresh end-to-end email delivery and current quota remain separate evidence boundaries.

### Approved historical-alert removal and independent verification

After the permanent effect was explained, the user approved deletion of exactly the four classified historical operational-alert failure records. The fingerprint-pinned [removal job 110622074559](https://github.com/bechirobob/tickets/actions/runs/36937809865/job/110622074559) completed at 22:54:29 UTC. Exactly four records were deleted. The other 14 delivery row hashes and all other table counts were unchanged; database quick check passed and foreign-key violations remained zero. Live application revision remained `473bbf40afe1a77a722c8399f91c4dd95f3e40ce`.

The separate [verification job 110623062361](https://github.com/bechirobob/tickets/actions/runs/36938116637/job/110623062361) passed at 22:57:49 UTC: all four targets were absent, with 14 delivered records, zero failed and zero queued; quick check remained OK, foreign-key violations were zero, and health returned 200 on the same live revision. The spent deletion code was removed; later main `33c654f36a1e845f7eb8a920d3ebaabb72d7abab` contains verification-only diagnostics.

Protected existing backups were retained, recipient values were not exported, and no message was resent. This was the exact authorized removal, not a general retention purge. The earlier 14-delivered/4-failed snapshots remain dated historical observations and do not describe the post-removal database.

### Backups and recovery

The [daily backup 36832627387](https://github.com/bechirobob/tickets/actions/runs/36832627387) completed at 07:50 UTC on 1 October: encrypted backup, full isolated restore verification and off-host upload all passed. [Artifact 11147432902](https://github.com/bechirobob/tickets/actions/runs/36832627387/artifacts/11147432902) has 35-day retention, expiring 5 November; SHA-256 `734620c7da93efe5e430e05215d5762f2a85b3585923cca3eb40f58d2f3558fa`. This is current-day backup evidence from workflow revision `4cd96fb13e99b4eddd22466e03142d934b4bba49`, not a post-release restore.

Backup consistency is per database, not an atomic cross-database snapshot. The restore proves decryptability and checked database integrity in isolation on the existing host. It does not prove total-host-loss recovery on a replacement machine, a guaranteed recovery time or zero data loss. Scheduled cadence is best effort; the actual receipt time remains the relevant observation.

### Migration and rollback

Migration `0060_staff_owner_integrity.sql` adds a narrow database guard against concurrently removing the last active owner through role/status changes. It rewrites no account or customer row. Existing DELETE behavior remains separately guarded. The release transaction takes a private verified pre-migration backup, and its rollback policy preserves this additive guard when application code rolls back. The reviewed release updater admits this exact migration without broadening its generic migration grammar.

The completed release JSON reported `active=true`, `publicVerified=true`, released revision `473bbf40afe1a77a722c8399f91c4dd95f3e40ce`, previous revision `7b9db84ddff94a8b54324241dc855d3ab9ac8a8f`, `dataMigration=true` and `cryptoEnableRequested=false`. The last field means this release did not request enabling crypto; it does not say existing USDC was disabled. No earlier cleanup, handover or failed deployment was replayed.

## Remaining findings and decisions

### Confirmed defects and operational follow-up

| Priority | Finding and impact | Evidence and next step |
| --- | --- | --- |
| Low | Desktop Fees datetime suffix clips inside its control | Visible in inspected desktop captures; mobile 412/390 views show the supplied text. Correct in a bounded layout change and rerun affected rendering checks |
| Low | Orders Provider record label is cramped/clipped in compact button styling | Verified across captures; pointer, keyboard and emulated touch work. Correct label layout without changing financial action behavior |
| Test maintenance | Maintained disclosure helper can leave alternating answers closed | The bounded overlays establish stable expansion and route-specific loaded-state checks. Port these reviewed harness corrections into maintained coverage in a separately verified change |
| Test maintenance | Maintained main still applies the analytics-exclusion header globally | The endpoint-only overlay passed all 12 final targeted checks. Port this reviewed fixture isolation into maintained coverage; it is not an application defect or a new application release |

Optional wording and visual-affordance observations are not additional confirmed interaction defects: the RSVP breakdown says “1 · 1 guests” and has tight spacing; the numbers are not disputed. The optional host-review note field has an indistinct boundary, but no failed interaction or accessibility assertion was established. Partial mock data that produces contradictory publication or email counts is excluded from the product-defect list.

### Accepted scope and remaining evidence boundaries

These boundaries distinguish what was verified, what the user accepted or deferred, and what remains a product decision. They do not introduce new launch prerequisites beyond actual platform and operational defects.

1. **USDC settlement deliberately deferred:** the user accepts real USDC settlement as untested until customer demand; it is not a readiness blocker. Existing USDC availability and correct labels remain enabled. Isolated checkout/webhook tests do not establish real settlement. No real payment, refund or payout was performed in this audit; partial or unknown dispute outcomes remain under review with admission suspended, and unknown provider status does not certify reconciliation.
2. **Phone and laptop checks accepted as user-reported:** the user says these checks are complete. They were not independently reproduced, and this report does not request repetition. The statement does not establish signed native distribution or store acceptance. The packaged client caches only public event data; private My Nights, RSVP, recovery and checkout intentionally use secure browser journeys. Native private-session handoff, private offline passes and store acceptance remain outside the verified result without becoming new prerequisites for this audit.
3. **Email evidence:** fresh end-to-end delivery, current account allowance/quota and audience capacity were not tested. Successful live authenticated announcement-preview images and a settled sending-allowance response remain unverified. Loopback CSP-blocked preview images do not by themselves prove a same-origin production defect. The four historical alert failures were classified, permanently removed with explicit approval, and independently verified absent.
4. **Privacy and retention product decisions:** existing preferences are not an account deletion/export service. General session, access-grant, audit, financial, consent and operational retention requires a defined policy before a generalized purge. This audit did not add a legal-compliance certification or a new deletion/export launch prerequisite. The completed, separately approved removal of four identified obsolete alert failures does not authorize a general retention cleanup.
5. **Recovery and proxy evidence:** the encrypted isolated restore and escrow metadata do not prove replacement-host recovery or independent recovery-key retrieval under total host loss. The proxy’s loaded configuration remains unverified. The canonical public-artwork probe and targeted three-engine browser matrix passed, without a claim about every CDN location.
6. **Visual evidence limits:** `/payment/return` remains functional-only; populated saved offline QR, the host empty-next-event state, the new-password invitation variant, unobscured final mobile Help lines and 320-pixel discovery dock scroll reachability lack separate complete visual proof. WebKit service-worker offline emulation remains intentionally skipped. These are limits of the retained automated/raster evidence, not requests to repeat the user’s device checks.
7. **Previously cached draft media:** the repaired origin protects unpublished assets and revalidates public responses, but prior browser/CDN copies can persist under old cache headers until expiry. No actual leaked production identifier was established, and no assertion is made that old copies were recalled instantly.

## Earlier failures and corrected verification

These records distinguish first failures from successful corrected candidates. No failing candidate was deployed.

- Candidate `901e5c7`: build, lint, types and rendered checks passed; Worker suite passed 606 of 607. An old gate fixture demoted its only owner and was correctly blocked by the new invariant. Retaining a second fixture owner preserved the assertions; focused Worker and VPS gate suites each passed 4 of 4.
- Candidate `bfd0706`, [browser run 36922315765](https://github.com/bechirobob/tickets/actions/runs/36922315765): core passed 607 Worker tests plus 82 repository, 44 UI, 2 password-client and 4 rendered checks, schema and Worker dry run. Its three-engine browser matrix was not green. All engines found privacy helper-text contrast of 4.02:1, and compiled Operations writes exposed an audit-introduced cross-realm Request-wrapper integration failure. The contrast was corrected to the existing readable color; the parser now reconstructs from URL and explicit metadata while retaining exact signed bytes, cancellation and security checks. Foreign-wrapper and navigation-mode regressions reproduce the failure before repair; subsequent complete final-source gates passed.
- Native pixels from that candidate exposed omitted payment-logo assets, portrait identity lost after URL normalization and public artwork blocked by same-origin embedding policy. The corrected client bundles all seven payment marks and uses normalized artwork identity. Cross-origin embedding is limited to safe public artwork and verified published poster responses; private/draft/denied media remains protected. No credentialed CORS permission was added.
- Candidate `b9ba236` exposed a second integration regression: declared-length rejection returned 413 but left unread input blocking a reused connection. The next legitimate request failed. Cancelling the rejected body preserves the cap and allows the transport to drain. The deterministic same-socket test failed before repair and passed afterwards; final Worker and VPS parser suites each passed 13 of 13 and the final compiled gate verifies the actual socket boundary.
- [Native browser run 36926635801](https://github.com/bechirobob/tickets/actions/runs/36926635801) had 14 passed and 2 failed because a new geometry assertion incorrectly rejected the intentionally faded kicker overlap. The corrected assertion retains exact portrait size, title/action geometry and no-overflow checks. This was a test-contract correction, not removal of the artwork regression test.
- [iPhone run 36926635772](https://github.com/bechirobob/tickets/actions/runs/36926635772) stopped after its Wrangler development proxy exited during capture. It was incomplete, not a route pass or evidence of a service outage. The capture runner was changed to the established direct compiled-Worker harness with explicit exit diagnostics; final run 36929202607 completed.
- [Desktop candidate run 36926635790](https://github.com/bechirobob/tickets/actions/runs/36926635790) passed 167 public cases and all 53 Operations cases plus repeat/provider/RSVP/keyboard phases. Its remaining public failure used a synthetic document blocked by Chromium local-network protection before image requests reached the server. The fixture now serves a real document on a separate loopback port, retaining actual image loading, CORP checks and browser security defaults. Final candidate browser phases passed.
- The six first-overlay failures and their cookie/loaded-data causes are retained above. The corrected overlays did not change application source or rebuild the candidate.

## Security and execution qualifications

Fresh server and mobile dependency audits found zero known advisories, including development dependencies, on 1 October. The current tracked-source scan found no selected live-key pattern. A nonprinting scan of added lines across 517 locally reachable main-history commits also found no selected high-confidence provider, GitHub, AWS or private-key pattern. These are bounded scans, not a forensic assurance of every secret or remote branch, an external penetration test or legal-compliance certification.

Early local build and lint attempts ended with SIGKILL 137 and were incomplete. A later bounded VPS build enabled compiled HTTP/WebSocket verification. A local full VPS attempt passed 23 Node tests and 592 Vitest cases across 67 files, but three child processes exited unexpectedly; it was not counted as a release pass. The later exact-main hosted runtime gate completed successfully and supplies the full release evidence. Local Chromium socket restrictions and a cloud-browser navigation timeout likewise did not establish a product defect; the hosted browser artifacts supplied the inspected rendering evidence.

## Appendix A Full route and state inventory

**R** means a representative route/state has inspected raster evidence, with source reuse and dates described above. **F** means rendered functional coverage without a dedicated retained successful raster. Neither means every state or third-party service is certified. Phone/laptop acceptance is separately user-reported and is not being requested again. The complete final three-engine gate applies subject to documented suite restrictions and intentional skips.

| Route | Covered states and source suites | Closure and specific evidence limits |
| --- | --- | --- |
| `/` | public-journey, published-catalogue, room-demo, room-natural-entry: single/multiple hero, pause, reduced motion, discovery filters, Room arrival/reactions, short viewport, footer/nav | **R** — Desktop expanded Home; full iPhone overlaps; exact 53f5a061 hero/footer; Room insertion traces. Desktop offscreen lazy imagery is not used as asset proof |
| `/events` | public-journey, discovery-segments, discovery-pass-access, customer-feedback: search/no results, date/filter expansion, history restoration, narrow 320-pixel layout, reduced motion | **R** — Desktop filters/date/search, narrow 320-pixel layout and app/web overlapping Drop views. Two 320-pixel full-page images retain dock occlusion-at-capture limitation |
| `/event/[slug]` | published-catalogue, event-details, cuppy-guest, customer-feedback, payment-labels: real flyer, host, Coming soon, extras/disclosures, share/copy fallback, RSVP expansion, availability | **R** — Both fixture events, 800/1280-pixel Cuppy views, mobile overlaps; exact 53f5a061 host portrait. Live publication remains intentional sole Coming soon RSVP |
| `/rsvp/[slug]` | host-profile and isolated registration suite: free RSVP, paid guidance, interest, Coming soon/schedule unavailable, failed send draft and success | **R** — Direct October form, isolated guest form/retry/success |
| `/checkout/[slug]` | public-journey, checkout-preview-retired, seevplus-checkout, seevplus-crypto-checkout: availability redirects, paid form/hydration, buyer validation, provider failure, labels/USDC | **R** — Coming-soon redirect and isolated MoMo/USDC form/provider-failure captures. No real payment/provider acceptance |
| `/payment/return` | payment-return: pending polling/refresh, authenticated resume, missing ownership/error without false success | **F** — Three rendered functional cases cover pending/reload, authenticated resume and non-owner recovery. No dedicated successful PNG; do not count visual acceptance |
| `/hosts` | public-journey, host-profile, room-identity: list, Kofi Verified host, navigation | **R** — Desktop directory identity/portrait/card |
| `/hosts/[slug]` | host-profile: portrait loaded, public socials, real next event, readable mobile layout | **R** — Kofi profile and invalid-slug recovery; empty-next-event state not separately captured |
| `/about` | public-journey and room-identity: prose/identity/navigation, expanded state if any | **R** — Complete desktop text/sections/actions |
| `/help` | public-journey, room-identity: every visible details expanded, identity/hydration/readability | **R** — Corrected anonymous 28/28 overlay in all engines; full tall captures inspected. Mobile fixed-bar stitching obscures a few final Flash/VIP lines, so not every word has unobscured per-engine raster proof |
| `/privacy` | public-journey, room-identity: policy/readability/no overflow/navigation | **R** — Full desktop legal notice and mobile accessible entrance; legal interpretation not audited |
| `/terms` | public-journey, room-identity: policy/readability/no overflow/navigation | **R** — Full desktop policy reading column; legal interpretation not audited |
| `/my-nights` | my-nights-studio, member-navigation, discovery-pass-access, confirmation-notifications: private recovery, empty/error/retry, search/filter, active/history, cancelled/waitlist, notification settings | **R** — Hub, inactive payment, filters/recovery, final iPhone private access |
| `/my-nights/[slug]` | my-nights-hub: single/group passes, already-scanned no QR, perks/purchase/support expansion, question draft preservation, details/history links | **R** — Ticket/group/plan/perks/support and invalid-slug recovery |
| `/my-nights/access` | customer-feedback: recovery/transfer fragments removed, deliberate claim, failure/retry, keyboard/readability | **R** — Recovery and transfer failures/actions readable; functional claim tests use isolated responses |
| `/tickets` | public-journey and guest-clarity: legacy pass access, secure-recovery guidance | **R** — Legacy access/empty recovery shell |
| `/notifications` | notifications, member-navigation, confirmation-notifications: large 14-item feed, long expanded text, loading/error/retry/private, unread/all, mark-read recovery, device preferences | **R** — Signed-out Buzz, 14-item compact feed/loading/filter, blocked device preferences; live delivery external |
| `/account/privacy` | public-journey, navigation-audit, private-link-recovery: signed out, load failure/retry/loading, save failure retained choices/success | **R** — Corrected signed-in retry/save-error/success label contrast and exact final signed-out page |
| `/room/[slug]` | room-identity, room-features: authenticated isolated socket, announcement target, reaction actions/focus, VIP sheet, Flash inbox/view/expiry/report/delete failures, delayed camera permission | **R** — Conversation/actions/Flash/VIP failure/private invalid route; camera/push not independently reproduced by this automated evidence; device acceptance separately user-reported |
| `/rsvp/access` | registration + private-link-recovery: missing/expired link, deliberate confirmation, malformed response, confirmed/requested/waitlist/interested | **R** — Recovered valid confirmation plus non-admission response tests; real email excluded |
| `/announcements/unsubscribe` | route-completeness: no token guidance, token POST form, done acknowledgement; mutation interception asserts zero submissions | **R** — Missing token, token form and done acknowledgement all captured; zero submit |
| `/organizer/join` | host-onboarding: full form, policy checkbox, failed save retains details, success/back | **R** — Populated isolated onboarding form; actual outbound email not exercised |
| `/organizer/join/confirm` | host-onboarding + private-link-recovery: inspect, token stripped, deliberate confirmation, temporary-failure retry and expired | **R** — Recovered token inspection; expired/malformed contracts tested |
| `/organizer/activate` | organizer-activation + private-link-recovery: missing/expired, matching passwords, failed save, inspect retry | **R** — Password-ready and inspection recovery views; no real credentials changed |
| `/organizer/team/accept` | operations + private-link-recovery: assignment/deep-link destination, existing password preserved, inspection failure/retry/expired | **R** — Recovered existing-account invitation; new-password variant lacks separate raster |
| `/organizer/submit` | organizer-submission, room-identity, public-journey: form labels/disclosures, invalid inputs, failure recovery, identity | **R** — People, Party and Flyer steps plus error/retry functional coverage |
| `/organizer/workspace` | operations: every nav area, event overview/details/tickets/guests/Room/VIP/insights/requests; coupons/questions/promoter/team; help/settings/desk; large lists/errors/preserved drafts | **R** — Every top-level area and event view; captured states do not mean every nested disclosure was opened |
| `/organizer/analytics` | operations: event/range/views/filter/export, RSVP count, contact exclusion, readable controls | **R** — Summary, sales, reach, door/Room and expanded status/source/link views; minor count typography retained |
| `/organizer` | Operations alias/login test: server alias to workspace then correct sign-in returnTo | **R** — Alias sign-in PNG plus validated returnTo assertion |
| `/organizer/assistant` | Operations deep-link test: alias to workspace `area=desk` with validated event retained through login | **R** — Assistant/task sign-in PNG plus validated destination assertion |
| `/promoter` | private-link-recovery: private report valid/refresh/503/stale/timeout/retry, in-memory token | **R** — Recovered report and busy/stale/error/timeout functional evidence; no real payout |
| `/scan` | operations: camera start/result/repeated start/failure, offline queue conflict/reload/review, disconnected status, large RSVP door desk | **R** — Scanner/manual door desk, failure-retained draft; offline duplicate/reload functional tests. Physical admission/camera not independently reproduced by these fixtures; phone/laptop acceptance separately user-reported |
| `/admin` | operations: queue list/expanded submission, review, exact owner-approval link; auth returnTo | **R** — Submission queue and final overlay visible disclosures |
| `/admin/account` | operations: account form, password/security state, nav/layout | **R** — Account/security forms; no real credential or passkey enrollment |
| `/admin/accounts` | operations: staff list/removal safety/current-owner protected, expanded menus | **R** — Staff/roles/event allocation/removal confirmation; final expanded overlay |
| `/admin/bootstrap` | route-completeness first-owner fields/help expanded with zero mutations; Operations seeded-DB redirect to sign-in | **R** — Empty local setup fields/help, and seeded redirect sign-in; no account created |
| `/admin/events` | operations: real inventory, event draft/tier numeric validation/failure retention, remove test event, expanded fields | **R** — Inventory/editor/removal state plus final overlay |
| `/admin/fees` | operations: fee controls/expanded panels/layout | **R** — Expanded controls; desktop datetime suffix clipping retained |
| `/admin/help` | operations: help expansion, mobile menu focus/escape/leave | **R** — Final 53f5a061 overlay 16/16 actual answers inspected and strict axe passed |
| `/admin/hosts` | operations: application view, approval exact form, local review/no event | **R** — Expanded approval in all engines after exact readiness correction; weak optional-note field boundary retained as low affordance polish |
| `/admin/login` | public-journey + operations: startup hydration, values retained, isolated real password sign-in/sign-out, returnTo | **R** — Seeded private sign-in + validated deep links; empty fixture's bootstrap render labelled separately |
| `/admin/operations` | operations: checks/incidents/approvals separate focused views, errors/readability | **R** — Checks/activity/approvals and final expanded overlay |
| `/admin/orders` | operations: orders vs reports/free registration, provider scope, uncertain save, filters; explicit Paystack dispute-dashboard handoff | **R** — Filters/provider/dispute handoff; label clipping retained; pointer, natural keyboard and measured emulated touch verified |
| `/admin/promoters` | operations: promoter list/expanded controls | **R** — Create-link controls/empty incomplete state and final overlay |
| `/admin/recover` | owner-recovery + private-link-recovery: setup email, no token history, matching passwords/error, initial inspection retry/expired | **R** — Password/email recovery and token-inspection retry |
| `/admin/registrations` | operations: settings/roster/guest-email tabs, loading guards, pointer stability, save-copy failure and clipboard readiness | **R** — Setup/roster/guest-email/readiness states plus final three-engine Recent signups/More options expansion |
| `/admin/rooms` | operations: Room controls/memory failed save retains draft, expanded content | **R** — Chat/host update/memory/empty moderation and failure-retained draft |
| `/admin/support` | operations: support conversation/failed reply retention, expanded content | **R** — Selected conversation/reply form and failure-retained draft |

Additional non-Next routes: `/offline-ticket.html` has branded empty/no-ticket rendering and Chromium offline-shell coverage; populated saved QR pixels are not established and WebKit service-worker emulation is intentionally skipped. `/manifest.webmanifest` has identity/adaptive-icon assertions. Six invalid dynamic event/checkout/RSVP/My Nights/Room/host routes have inspected recovery screenshots and axe checks. No first-owner account or production record was created to obtain route evidence.

## Appendix B API route inventory

All 80 API route handlers are listed. This is the source routing map, not a claim that every method received a separate live mutation test. Protected and write scenarios are exercised in isolated suites.

| Route | Exported methods |
| --- | --- |
| `/api/admin/accounts` | GET, POST, PATCH, DELETE |
| `/api/admin/audience` | GET, POST |
| `/api/admin/bootstrap` | POST |
| `/api/admin/campaigns` | GET, POST |
| `/api/admin/check-in` | GET, POST, DELETE |
| `/api/admin/door` | GET, POST |
| `/api/admin/events/removal` | GET, POST |
| `/api/admin/events` | GET, PATCH |
| `/api/admin/host-applications` | GET, PATCH |
| `/api/admin/operations` | GET, POST |
| `/api/admin/orders` | GET, POST |
| `/api/admin/organizer-activity` | GET, POST |
| `/api/admin/organizer-invitations` | GET, POST |
| `/api/admin/passkeys` | GET, POST, DELETE |
| `/api/admin/promoters` | GET, POST |
| `/api/admin/recovery` | POST |
| `/api/admin/registrations` | GET, POST |
| `/api/admin/rooms/flashes/[id]` | GET, DELETE |
| `/api/admin/rooms` | GET, POST, DELETE |
| `/api/admin/session` | GET, POST, PUT, PATCH, DELETE |
| `/api/admin/submissions` | GET, PATCH |
| `/api/admin/support` | GET, POST |
| `/api/admin/workspace` | GET |
| `/api/analytics` | POST |
| `/api/announcements/unsubscribe` | POST |
| `/api/calendar/[slug]` | GET |
| `/api/config/booking-fee` | GET, POST |
| `/api/customer/experience/[slug]` | GET, PATCH |
| `/api/customer/my-nights` | GET |
| `/api/customer/notifications/preferences/[slug]` | GET, PATCH |
| `/api/customer/notifications` | GET, PATCH |
| `/api/customer/notifications/subscription` | GET, POST, DELETE |
| `/api/customer/notifications/test` | POST |
| `/api/customer/preferences` | GET, POST |
| `/api/customer/privacy` | GET, PUT |
| `/api/customer/recovery/claim` | GET, POST |
| `/api/customer/recovery` | POST |
| `/api/customer/registrations` | GET, POST |
| `/api/customer/returns` | GET, POST, DELETE |
| `/api/customer/session` | POST, GET, DELETE |
| `/api/customer/support/[slug]` | GET, POST |
| `/api/customer/tickets` | POST |
| `/api/customer/transfers/claim` | GET, POST |
| `/api/customer/transfers` | GET, POST, DELETE |
| `/api/customer/wallet/[ticketId]` | GET |
| `/api/customer/wallet/config` | GET |
| `/api/email/webhook` | POST |
| `/api/host-applications/confirm` | POST |
| `/api/host-applications` | POST |
| `/api/media/[id]` | GET |
| `/api/organizer/activate` | POST |
| `/api/organizer/analytics` | GET |
| `/api/organizer/assistant/events` | GET |
| `/api/organizer/assistant` | POST |
| `/api/organizer/business` | GET, POST |
| `/api/organizer/reports` | GET, PATCH |
| `/api/organizer/team/accept` | POST |
| `/api/organizer/workspace` | GET, PATCH, POST |
| `/api/payments/initialize` | POST |
| `/api/payments/quote` | POST |
| `/api/payments/seevplus/webhook` | POST |
| `/api/payments/webhook` | POST |
| `/api/promoter` | POST |
| `/api/public/events` | GET |
| `/api/registrations/claim` | POST |
| `/api/registrations` | POST |
| `/api/rooms/[slug]/access` | GET |
| `/api/rooms/[slug]/block` | POST, DELETE |
| `/api/rooms/[slug]/flashes/[id]/report` | POST |
| `/api/rooms/[slug]/flashes/[id]` | POST, PATCH, GET, DELETE |
| `/api/rooms/[slug]/flashes` | GET, POST |
| `/api/rooms/[slug]/report` | POST |
| `/api/rooms/[slug]/vip` | GET, POST |
| `/api/submissions` | POST |
| `/api/version` | GET |
| `/api/waitlist` | POST |
| `/api/wallet/apple/v1/devices/[deviceLibraryId]/registrations/[passTypeIdentifier]/[serialNumber]` | POST, DELETE |
| `/api/wallet/apple/v1/devices/[deviceLibraryId]/registrations/[passTypeIdentifier]` | GET |
| `/api/wallet/apple/v1/log` | POST |
| `/api/wallet/apple/v1/passes/[passTypeIdentifier]/[serialNumber]` | GET |
