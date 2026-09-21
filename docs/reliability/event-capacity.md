# Event capacity verification

The supported test target is **400 distinct guests at one event**. Passing these
checks establishes application behavior in an isolated environment; it does not
certify Cloudflare account quotas, Seev throughput, Resend delivery, venue Wi-Fi,
or physical scanning devices. No customer data or live providers are used.

## Repeatable checks

Run `npm run test:capacity` for real workerd route handlers, isolated D1 and
Durable Object WebSockets. Run `npm run build`, `node scripts/prepare-deploy.mjs`,
then `node scripts/capacity/http.mjs` for the compiled application over actual
loopback HTTP using the compiled Worker in Miniflare/workerd directly, without
Wrangler’s development inspector/proxy. The latter deliberately has no configurable destination URL and
strips provider/Cloudflare credentials from its child processes.

The **Event capacity verification** GitHub Actions workflow runs both sequentially
and preserves `measurements.json`, `http-measurements.json`, runner specification,
and logs as a 30-day artifact. These are the measured results for that exact SHA.
The full application test suite, browser journeys and release checks run separately.

| Scenario | Workload and invariant |
| --- | --- |
| Checkout burst | 500 distinct buyers race for 400 admissions from one public IP; exactly 400 succeed |
| Sold out | Another 100 buyers cannot reserve or issue extra admissions |
| Payment replay | 800 signed callback requests for 400 mocked payments issue exactly 400 tickets |
| Private access | 400 independent sessions receive only their own order and unique QR |
| My Nights | Bursts of 100, 400 and 800 in-flight requests; 400 identities |
| Gate races | 800 simultaneous scans, two per ticket; exactly 400 valid and 400 duplicate outcomes |
| Room | 400 simultaneous live connections, 120 messages at 2/sec for 60s, all 48,000 recipient deliveries |
| Revocation | A silent revoked socket receives no next private message and is closed |
| Reconnect | 399 valid guests reconnect in a burst and all receive the next message; revoked guest remains denied |
| HTTP ramp | 50, 100, 200, 400, 800 and 1,600 in-flight requests using up to 400 identities |
| HTTP sustained | Open-loop 40 requests/sec for 60s (2,400 requests), with generator lateness recorded |
| Recovery | A normal authenticated HTTP read still succeeds after load |

The route suite fails on any unexpected response, incorrect ownership, duplicate
admission, overselling, message loss, or p95 latency above 5 seconds for reads,
wallets, scanning and socket connection, or 10 seconds for checkout/callback bursts.
Room delivery p95 must be below 5 seconds. The HTTP target through 400 in-flight
requests requires zero errors and p95 below 5 seconds. Higher HTTP levels are
exploratory: their results remain visible even if they exceed that target. Sustained
HTTP traffic requires zero errors, p95 below 3 seconds, and p95 scheduler lateness
below 250 ms. A 60-second run is **not** an event-length soak test.

## Changes made for capacity

- Settled registrations and signed-out screens do not poll while idle. Pending
  registrations refresh at 60–70 seconds, pause when hidden/offline, and back off
  after failure. Returning to the page refreshes stale state.
- Session authorization still runs on every protected request. Only activity
  bookkeeping is coalesced to at most one write per session per five minutes.
- Shared networks have a separate 600/minute checkout guard. The per-customer
  guard remains 10/minute. These are protective controls, not throughput promises.
- My Nights aggregates the guest's own tickets once, avoiding a join against all
  event tickets and the cross-product of updates and host questions.
- Checkout reuses the fresh server-side fee quote and leaves global expired-hold
  cleanup to the scheduled worker. Atomic inventory checks still exclude expired
  holds and protect the last available admission.
- Gate scans read current assignment and event availability together, and batch
  the two successful-entry audit writes. Atomic duplicate-entry protection stays
  in place.
- Notification insertion uses one SQL statement per 50 recipients rather than
  one statement per person. This reduces query count, **not** the number of rows
  stored or the external push/email workload.

## Evidence that prompted fixes

The initial isolated measurements had no request failures but My Nights p95 was
9,989 ms at 400 simultaneous reads and 19,709 ms at 800. A passing correctness test
alone was therefore insufficient. Explicit latency thresholds now block release
if this slowdown returns. The report in each workflow artifact supersedes earlier
measurements; local and CI hardware timings must not be treated as production SLAs.

An earlier compiled HTTP run through `wrangler dev` served 400 requests at
p95 2,364 ms and 800 at 4,817 ms with zero errors, but its local serving process
exited during 1,600 simultaneous requests and failed recovery. Diagnostic logs
reported a disconnected development proxy stream. Direct workerd testing of the
same compiled application survived that overload and served the next request,
although the 1,600-request burst still had connection errors. The canonical HTTP
harness now excludes that development proxy. This distinction does not establish
Cloudflare production capacity or promise reliable operation at 1,600 requests.

## Limits requiring separate verification

- [Workers Free](https://developers.cloudflare.com/workers/platform/limits/):
  100,000 requests/day and a CPU-time allowance; D1 has per-invocation query limits.
- [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/): 5 million rows
  read/day and 100,000 rows written/day. Index updates can add to billed writes.
- Room notification history currently stores one row per eligible recipient per
  message. The baseline 120-message/400-guest test created **47,880 notification
  rows**, before counting index writes or other activity. Free-tier capacity for a
  long, busy Room must not be inferred from a 60-second local test.
- [Resend Free](https://resend.com/docs/knowledge-base/account-quotas-and-limits):
  100 transactional emails/day and 3,000/month. Receipt, recovery and other mail
  share the allowance. The owner is handling account plans; a queue cannot remove
  a provider quota.
- Seev is mocked here, including successful verification and signed callbacks.
  Actual provider latency, outages and production rate limits remain unmeasured.
- Web Push providers and camera/Flash media are not load-tested by this suite.
- The local runtime does not enforce the full Cloudflare account quota/CPU model.
  A separate remote staging test on the chosen plan is still needed for a hosted
  capacity guarantee. Never run this synthetic fixture against production.

Rollback: the prior production source is `a5440f83376df2cc647619b72d814974dc2c5eec`.
These changes introduce no schema migration or destructive data operation.

## Hosted launch rehearsal — 21 September 2026

Production remains `edbaa5550785873fdbe2f068c62da401776445ce`, Worker version
`6caccf1f-4a7f-4111-ab5d-594fe680fb90`. PR #168 completed its release and browser
checks; mobile Chrome required one job rerun after a browser process crash.

Read-only inspection run `35666957074`, source `07ccb2ff67090b1ed8666f2c75f458cc80533054`:

- Cloudflare account and Worker report usage model `standard`. The subscriptions
  response contains two **zone** Free plans; this does not conclusively identify
  the Workers billing plan. Do not confuse a domain plan with Workers billing.
- Account-wide D1 analytics at 23:18 UTC: 119,384 rows read and 4,682 rows written
  that UTC day. These are a snapshot, not reserved quota or a capacity promise.
- On The Guest List (`sun-chasers-labadi`) is published, undated RSVP, capacity
  **50**, Room access on, **approval_required=0**. The owner's edited announcement
  draft says the host confirms places. Current automatic approval and that copy
  differ; do not silently change a host's existing event settings or imply that
  the test target of 400 has changed its capacity.
- Marketing reports ready with six contacts. Transactional credentials exist,
  but the Resend billing tier/remaining allowance is unverified. In-app delivery
  records are not provider quota evidence. No mail is sent by this inspection.

`Hosted capacity readiness` uses a new Worker/database named for its GitHub run.
It requires low account-wide usage before provisioning, a random access key, a
20-minute access expiry, and allows only the version, My Nights and Room socket
read endpoints. It has no provider secrets, queues, cron jobs or production
bindings. Artifacts contain aggregate metrics only; fixture tokens stay on the
runner. Cleanup verifies resource ownership before removing the test resources.

The hosted workload is bounded: 50/100/200/400-read bursts, 40 reads/sec for one
minute, 400 Room connections and one message with all 400 deliveries and 399
stored recipient notifications, then a recovery read. This is **not** an
event-length soak or live payment/email delivery test. The one-minute 120-message
Room flood is intentionally excluded: its 47,880 notification rows plus indexes
can exceed the free account's 100,000 daily write allowance.

Public RSVP deliberately submits directly without creating a guest account or
sending a confirmation email. Approved guests use the host's door list. Existing
`rsvp-audience` tests cover this route, host approval and duplicate door admission.
The verified-account RSVP path is separate and must not be described as the
current default public signup experience.

The isolated verified-account host-approval test now follows the original guest session through
approval, one confirmation notice across repeated scheduler runs, My Nights,
one QR pass, successful gate entry and duplicate rejection. Focused registration
and Seev tests: **41 passed locally**; provider traffic remains mocked.

Hosted run `35667444448` on `788c7a9283dd4b6ed4c1f3f02431dfbf9e0f115f` failed
during setup: Wrangler's remote SQL-file import writes progress lines even with
`--json`, so parsing its entire stdout failed after import. The owned database was
successfully deleted; no hosted application load ran. Remove the optional import
metadata parser and use exit status plus the application/data assertions.

Next: run and inspect the corrected bounded hosted rehearsal, confirm cleanup,
and record final CI evidence here.

Hosted run `35667672658`, source `95a315ad8d1a63f8655d6c7bc4ca09e6980f628b`,
provisioned successfully and found a real latency failure: 50/100/200/400-request
bursts had zero correctness failures, but p95 rose from 869 / 1,392 / 2,577 to
**5,702 ms** at 400, exceeding the existing 5-second budget. The test stopped
before sustained reads/Room; cleanup succeeded. This is not a 400-guest pass.

Follow-up: combine My Nights authorization and private feed in one D1 snapshot,
removing a sequential database round trip while preserving fresh session checks,
coalesced activity writes, empty authenticated feeds, privacy and ordering. Added
regressions for revoked/expired/inactive identities and empty versus other guest
feeds. The hosted runner now preserves latency failures while collecting the
remaining bounded phases; correctness errors still stop immediately. Budgets
are unchanged. Public RSVP/host door-list focused suite: 19 additional tests
passed; the verified-account/email path remains explicitly separate.
