# Event capacity verification

The supported test target is **400 distinct guests at one event**. Passing these
checks establishes application behavior in an isolated environment; it does not
certify Cloudflare account quotas, Seev throughput, Resend delivery, venue Wi-Fi,
or physical scanning devices. No customer data or live providers are used.

## Repeatable checks

Run `npm run test:capacity` for real workerd route handlers, isolated D1 and
Durable Object WebSockets. Run `npm run build`, `node scripts/prepare-deploy.mjs`,
then `node scripts/capacity/http.mjs` for the compiled application over actual
loopback HTTP. The latter deliberately has no configurable destination URL and
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
- Notification insertion uses one SQL statement per 50 recipients rather than
  one statement per person. This reduces query count, **not** the number of rows
  stored or the external push/email workload.

## Evidence that prompted fixes

The initial isolated measurements had no request failures but My Nights p95 was
9,989 ms at 400 simultaneous reads and 19,709 ms at 800. A passing correctness test
alone was therefore insufficient. Explicit latency thresholds now block release
if this slowdown returns. The report in each workflow artifact supersedes earlier
measurements; local and CI hardware timings must not be treated as production SLAs.

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
