# Cloudflare and VPS deployments

The owner confirmed on 28 September 2026 that Tickets must retain both working
deployments. This is not retirement of Cloudflare. Both builds use the same
application source and release identity. The VPS is the alternate event host;
Cloudflare remains the live host until the data and capacity gates pass.

## Authority and switching

Exactly one deployment may accept writes, run scheduled jobs, consume delivery
tasks or accept Room mutations. DNS changes alone are not a handover. Existing
connections, callbacks, background jobs and alternate hostnames must also be
accounted for. There is no automatic failback to a stale database.

For either direction: prepare the target release, pause the source's writers,
drain in-flight work, create a consistent encrypted backup, transfer application
and Room state, verify integrity and exact records, activate the destination,
then switch routing and verify public journeys. Keep the source closed to writes.
If the destination has accepted any writes, returning to the source requires a
reverse transfer of those records. Preserve sessions, ticket/QR identities,
payment idempotency, push keys and wallet signing identity.

Cloudflare Free was already found inadequate for the event workload. Retaining
its deployment does not make it a safe automatic event failover target. A return
must account for the destination's then-current quota and capacity.

## Current evidence

- Production source at start: `27560025f22ac3f796b6c53947f42d2a7eec3d22`.
- Preparation branch: `feat/vps-event-20260928`, pull request 191.
- Hermes access: existing GitHub/Tailscale connection, isolated operational
  branch `ops/tickets-vps-event-20260928` in `bechirobob/bubble-wash`. No Bubble
  Wash application changes are part of this work.
- Read-only host run `36488530453`: 4 cores, 5,441 MiB memory available, 30 GiB
  disk available; existing isolated Tickets preview active.
- Runtime run `36488866754` on `88648a5db96e265c27ef53fb8d46dfd7be726c3f`
  passed dependency audit, lint, types, Worker tests, 459 tests against Node
  bindings, adapter atomicity/persistence tests, both builds, and real HTTP,
  private QR access, Room WebSocket, restart and revocation verification.

### 29 September checkpoint

- Installed isolated release `a947aee5e3274b8812ffade5b63817c5b4804c69`:
  runtime build `36501449127` passed all checks, including dependency audit after
  patching fast-uri to 3.1.7 and Undici to 7.29.1. Node 24.21.0 is bundled in each
  release; the service uses at most two CPU cores and 1 GiB memory.
- Actual-host rehearsal `36501483855`: wallet p95 5,193 ms, My Nights at 600
  guests 3,101 ms, 1,200 competing scans 8,414 ms, 600 Room joins 3,918 ms.
  All 72,000 chat deliveries succeeded (p95 302 ms); restart reconnect timed out.
  This is **not** a passing capacity result. No latency threshold was relaxed.
- This increment groups standalone writes as well as batches, loads private
  routes before reporting readiness, and fetches history reactions once per
  snapshot instead of once per message. The rehearsal now verifies each viewer's
  own reaction flags after restart and reports all completed timing phases.
- Host configuration check `36501535792` found only the private preview JSON
  containing `ENVIRONMENT`; there is no production key file in the Tickets
  configuration directory. Known project checkouts also contain no private
  environment configuration. Do not extract or print Worker secret values.
- Follow-up host run `36502412541`, release `4f70f500`: wallets now pass at
  4,270 ms and Room recovery completes. Gate scans remain over target at
  6,031 ms and 599 reconnects at 7,775 ms. All 72,000 deliveries pass (130 ms).
- The next increment avoids unchanged Room policy writes, reuses only the
  shared recent message rows with invalidation on every message mutation, and
  retains fresh per-viewer authorization, blocks and reactions. The busiest
  three APIs call their existing shared handlers directly on Node, preserving
  security headers and adding a 32 KiB request-body limit. HTTP regressions
  cover missing sessions, foreign origins, oversized bodies and private headers.
- Next action: pass the complete actual-host rehearsal for this increment, then
  securely provision the missing original configuration and implement/rehearse
  the bidirectional data handover. The write freeze, live D1/Room transfers,
  encrypted off-host restore and public routing switch are not implemented or
  verified by the preview installer.

The 600-guest network rehearsal uses a temporary local database and paid-ticket
fixtures. It exercises private wallets, duplicate gate scans, 600 Room joins,
72,000 message deliveries, revocation and recovery after restart. It never
contacts payment/email providers and cannot be pointed at production. It is a
bounded rehearsal, not a full event-length soak or proof of provider delivery.

## Remaining activation gates

1. Updated isolated VPS installation and capacity/recovery evidence under its
   service resource limits.
2. Private production configuration, including credentials held only in the
   Worker. The current Actions inventory is incomplete: Apple Wallet auth,
   OpenAI, staff decoy and VAPID values are not available to that runner. A
   Cloudflare secret-name listing does not reveal the values. Never place
   plaintext keys or customer snapshots in source, logs or workflow artifacts.
3. Tested consistent D1/Room export and import in both directions, with a real
   source-writer freeze and pending delivery reconciliation.
4. Encrypted off-host backup and restore rehearsal, secured origin routing,
   and verification of the exact public release and callback paths.

No live routing or customer data has changed during preparation.

### Verified capacity and encrypted configuration handover

Release `31989632c066fc5f6673353832483f9cde670fc0` passed the complete
600-guest rehearsal on Hermes (run `36503361777`): wallet p95 1,953 ms,
1,200 competing scans 2,729 ms, 72,000 chat deliveries with zero errors,
and 599 reconnects after restart 2,506 ms. Peak application memory was
approximately 182 MiB under the two-core/1-GiB service limit. All exact-source
browser, native and runtime checks passed. These are same-host loopback tests,
not public internet or payment/email delivery verification.

The owner confirmed Cloudflare holds the sole credential copies and explicitly
authorized key/data transfer and subsequent integration work. The recipient key
was created on Hermes by run `36505027149`; its private half remains root-only
under `/etc/becore-tickets/handover`. The checked-in recipient contains only the
public key and fingerprint. The new named Worker entrypoint is internal-only,
disabled without temporary recipient/expiry bindings, and encrypts an explicit
configuration allowlist before returning anything. It never returns plaintext
or accepts a caller-selected destination. A short-lived authenticated collector
is removed along with the temporary bindings after collection. Only encrypted
output may be stored in runner artifacts. VPS import authenticates metadata,
expiry and revision, and writes `runtime.pending.json` with mode 0600 without
activating the service or overwriting a different existing configuration.

Next action: release the tested dormant entrypoint, collect and decrypt the
configuration on Hermes, then implement consistent D1/Room handover. No live
data transfer, freeze or traffic switch is claimed by these preparation changes.

### Data rehearsal checkpoint

- D1 encrypted export `36505772936` succeeded from live source `27560025`.
  Actual Hermes restore `36505904761` passed SQLite integrity and foreign-key
  validation. Root-only inactive state is retained at
  `/var/lib/becore-tickets-handover/rehearsal-36505772936`.
- All database tables were preserved, including 2 orders, 1 ticket, 2
  registrations, 3 attendee sessions and 45 staff sessions. No customer rows or
  plaintext SQL crossed tool output or unencrypted workflow artifacts.
- The next Room increment adds an internal encrypted snapshot of all three
  Room tables, their schemas, the message sequence high-water mark and alarm.
  It preserves Cloudflare object IDs and derives the Node filename from the
  original event slug; removed/empty Rooms are retained as unmapped objects.
  Exports fail rather than truncate if an object exceeds the bounded snapshot
  size. These remain rehearsal snapshots, not a coordinated write freeze.
- The actual internal Service Binding configuration call was exercised with
  synthetic credentials under Miniflare: only allowlisted values survived
  decryption, while the public Worker handler returned 404. SQL restore tests
  cover binary values, referential integrity, rollback, reactions, deleted
  sequence numbers and alarm preservation.
- Next: complete configuration collection after the verified entrypoint is
  live; release and run encrypted Room snapshot/restore; then implement and
  verify the final writer freeze, bidirectional handover and origin switch.

## 29 September export continuation (historical checkpoint)

The previous chat stopped with an untested, uncommitted reverse-export helper.
Continuation source is `ops/vps-standby-completion-20260929` in
`bechirobob/tickets`; operational workflows remain on
`ops/tickets-vps-event-20260928` in `bechirobob/bubble-wash`.

Verified:
- Actual Hermes round-trip: 107 database tables / 430 rows and all six Rooms,
  including schema, row content, sequence state and writer guards on disposable
  copies. Runs 36511437666 and 36512907584.
- Updated standby runtime `5807f6ea9a7baef998cf379dc298ce636caf1f60` installed
  by 36511549703; actual-host 600-guest rehearsal passed. 72,000 chat deliveries,
  zero errors; restart recovery passed. This uses synthetic customer fixtures.
- Real restored data launched behind a private local Caddy proxy in 36512450226.
  Public pages and event reads passed; unsigned callbacks were rejected.
  Egress and background jobs were disabled. Probe units and copied data removed.
- Fixed reverse SQL statement overflow for large poster blobs using bounded
  staging statements, retaining finished-value constraints. Nine local handover
  tests and focused lint passed. Real D1 synthetic large-poster and full-schema
  imports passed (36512872487 and 36513236464).

The full private-data return import was subsequently completed by recovery run
36535200847; see the final continuation record below. Earlier failed targets
were removed and their manifests must not be replayed.

Cloudflare remains the live writer. The VPS data is a rehearsal snapshot.
No coordinated D1/Room/queue freeze, live traffic cutover, automatic failover or
live Durable Object reverse import is claimed. Preserve these distinctions.


### Recovery continuation: dependency-ordered phased return

The previously displayed operation was stopped: return verification 36514138922
failed, rather than remaining active. Production routing and source data were
unchanged. Subsequent diagnostics identified `D1_RESET_DO`; separate schema/data
imports then exposed `FOREIGN KEY constraint failed` in run 36516716042.
The exporter now creates schema/indexes first, emits parent-table rows before
children, and installs triggers after data. This avoids relying on deferred
constraints across D1 import transaction boundaries and avoids replaying trigger
side effects. Cyclic populated foreign-key graphs fail closed for a dedicated
import. Eleven local regression checks and focused ESLint pass.

Source code: `1978b651c41fff11bdb39681fd39222714e1612b`.
Private Hermes metadata run 36534979412 confirmed identical schema, row and
sequence digests for all 107 tables / 430 rows. Preparation 36535071347 and
private upload 36535132498 succeeded. Exact-state D1 verification **passed** in run
36535200847 at `1ba9ab96958e3dbf20153ea4998acf316795debb` on
29 September 2026 at 07:13 UTC (08:13 Malabo). All three imports completed;
foreign-key validation and exact schema, all 107 tables / 430 rows, and sequence
digests matched. The disposable database was removed successfully. There is no
remaining export/import job running. Do not retry its cleaned-up manifest.

Required scope complete: the stopped standby SQL export/return rehearsal is
resolved. Exact-source isolated checks passed in 36535071452 (11 tests).
Production HTTPS returned HTTP 200 during final verification. Existing six-Room
restore and VPS runtime/capacity evidence above remains separate; no new live
Room reverse import is claimed.

Next action only for a future activation task: implement and verify a coordinated
D1/Room/queue writer freeze, obtain a fresh consistent snapshot, reconcile pending
deliveries and verify secured public routing. The rehearsal snapshot must never
be activated as though it were current production data. Cloudflare remains the only live writer;
this task completes standby/export verification, not live cutover or automatic
failover. No second live writer is authorized.

### Final standby recovery closeout — 29 September, 07:24 UTC

The requested stopped-operation recovery is complete. Rechecked successful return
verification 36535200847 and isolated regression run 36535071452. Fresh host
inventory 36536113775 confirmed release
`5807f6ea9a7baef998cf379dc298ce636caf1f60`, active isolated preview, root-private
pending configuration, and no active production configuration. Host closeout
36536379015 succeeded and atomically recorded the verified Cloudflare SQL return
in `standby-verification.json`, retaining `cutoverReady: false` and
`activated: false`. No recovery operation is still running.

Final public HTTPS check returned 200. Production reports source
`6b6fd02cf2b94501b0fdc0122c4d7a647444366c`, Worker version
`04643a11-6330-4d65-a245-a36150078087`. No live routing, credentials, payments,
messages, source writes or customer data were changed by this closeout.

This closes the failed standby SQL-return task, not the separate live activation.
The outstanding live activation gates remain: coordinated writer freeze and
drain, fresh D1/Room snapshot, pending-delivery reconciliation, live Room reverse
import, and secured public routing/rollback verification. Keep both deployments
and never activate rehearsal data as current production.

### Rehearsal cleanup — 29 September, 07:34 UTC

Owner instruction: completed rehearsal data must not accumulate on the VPS.
Run 36537243355 removed both historical D1/Room rehearsal directories after
checking their non-activation manifests and absence of open file handles.
Run 36537364276 removed six obsolete preview revisions and the unused original
preview database files, preserving the currently configured preview state.
Total removed file content: 13933705 bytes (approximately 13.9 MB).
Remaining filesystem free space: 26,445,312,000 bytes (approximately 26.4 GB).

The current isolated preview health check passed, with zero orders and zero
tickets. Production, credentials, release binaries and the small verification
record were preserved. The old rehearsal snapshots no longer exist and the old
return scripts/manifests must not be replayed; any further data rehearsal needs
a newly captured encrypted snapshot.

Retention rule for future handovers: remove disposable snapshot copies and
obsolete preview state after successful verification; retain concise evidence.
Keep active state and genuine recovery backups separate from disposable test
copies. This closeout performed cleanup; it does not claim a new automatic
snapshot-retention job was installed.

### Authorized live handover implementation — 29 September

Owner explicitly requested completion of stages 1–5, including live switching.
Working branch: `feat/vps-live-handover-20260929`. Production remains unchanged
while the coordinated controls are implemented and tested. No source pause has
been issued and no second live writer has started.

Implemented dormant admission/drain tracking for HTTP (including response streams
and deferred tasks), queues, scheduled work and asynchronous Room operations.
Leases persist until completion and never automatically expire. Added private
source pause/freeze/status RPC, persistent per-Room SQL write exclusion, and
atomic Room reverse import preserving sequence high-water marks and history.
Copied the already-installed moderation adapter from release 5807f6e into the
shared candidate to avoid overwriting that host-only improvement.

Focused validation: typecheck, lint, 13 Worker handover/Room tests, and actual
SQLite Durable Object reverse-import test pass. Full candidate CI is next.
Host routing preflight 36538325880 succeeded: Caddy currently has only the Tickets
fallback and email imports; production origin routing and a dedicated Tickets
backup directory are not yet installed.

Next: complete and verify the operator controller, fresh encrypted snapshot
installation, pending-delivery reconciliation, secured origin routing and reverse
transfer orchestration before touching live traffic. Rehearsal data was removed
at the owner's request; retain only disposable test state during each test.

### Live-transfer operator checkpoint — 29 September

The source has not yet been paused or switched. VPS origin preparation succeeded
in host run 36539784306: a Tickets-only Origin CA certificate, a hostname-specific
strict TLS rule, and a maintenance-only Caddy vhost. Existing DNS/custom-domain
routing remains on the Worker. Host scope verification 36540517418 confirmed the
existing root-private operator token can read the Worker, D1 and queue.

Preflight 36540913127 found one paid and one expired order, no visible queue
messages, no pending refunds/payouts or announcement campaigns, 14 delivered
email records and six historical failed email records. This is a read-only
inventory, not final paused-state reconciliation.

The live operator now has explicit prepare, capture, activate, abort and rollback
stages with a root-private durable journal. Frozen transport checks every row,
schema and sequence. Capture includes a disposable D1 reverse import and an
actual frozen Room restore/compare. Activation requires a fresh verified stage;
rollback stops the VPS and imports fresh data into a new D1 before rebinding.
Ordinary Cloudflare deployment now refuses to reclaim a VPS-owned hostname and
resolves the current D1 binding after any reverse transfer.

Local validation: 17 Node handover/adapter tests and 469 VPS application tests
passed; typecheck and lint passed (one pre-existing moderation export warning).
Latest operator/API integration verification, exact final candidate CI, release
installation, backup scheduling and public switch remain pending. Do not treat
this checkpoint or a rehearsal manifest as activation evidence.

#### Final failure-path verification

Host installation/load test 36543063748 passed for candidate 4920367: 600 guest
wallets, 1,200 duplicate scan races, 600 Room joins, 72,000 message deliveries
with zero errors, and 599 reconnects after restart. Synthetic state was removed.
Production remained on Cloudflare.

Disposable routing round trip 36544226237 passed and removed its temporary
hostname/Worker/DNS. The real API requires removing the owned VPS A record before
restoring a Worker custom domain; domain deletion returns HTTP 200 with an empty
body. Both behaviors are now handled and verified by readback.

Additional failure-path tests pass: abort recovers an SQL freeze even if the
admission-phase update was interrupted; another transfer cannot unlock it.
Frozen Rooms retain their alarm in private SQL state and cancel platform alarm
execution until resume, preventing retry exhaustion from losing an alarm.
Database digest transport preserves full-precision real values as well as
64-bit integers. Successful empty API responses are distinguished from errors.

Encrypted backup/restore scripts passed a local disposable round trip, binary
row comparison, tamper rejection and seven-copy retention check. The proposed
nightly off-host workflow is draft BubbleWash PR 42: its inactive-writer test
passed, but that repository's unrelated dependency audit failed. Do not merge
or deploy that application's code as part of Tickets. Direct R2 access through
the current VPS operator token returned 403. A first private off-host backup can
be run from the isolated backup branch; automatic off-host scheduling is not yet
established. Final source deployment and live pause/switch are still pending.

### Separate Tickets operations — owner direction, 29 September

Tickets must not share BubbleWash application operations. The earlier operational
branch in the BubbleWash repository was a connection workaround and is retired
for further Tickets work. Do not repair or deploy BubbleWash dependencies to
enable Tickets backups.

The Tickets repository now owns its isolated VPS installer and nightly encrypted
backup workflows. They use GitHub OIDC with repository variables `TICKETS_TS_CLIENT_ID` and
`TICKETS_TS_AUDIENCE`, and a dedicated `tag:tickets-ci` identity permitted to
reach Hermes. Trust is restricted to `repo:bechirobob/tickets:ref:refs/heads/main`;
no long-lived Tailscale client secret is required. Do not copy credentials into
source, logs, artifacts, or chat. The connection has not yet been provisioned or
verified; missing access is a live-switch blocker.

Tickets retains its own `becore-tickets` Unix runtime user, systemd services,
`/srv/becore-tickets` release directory, `/var/lib/becore-tickets` production data,
`/etc/becore-tickets` configuration and `/var/backups/becore-tickets` backups.
No BubbleWash application files, database, service or dependencies were changed.

Recovery check 36546057745 found no live-transfer journal, no Tickets production
service and no off-host backup receipt. Public events returned HTTP 200; public
revision remained 6b6fd02cf2b94501b0fdc0122c4d7a647444366c.
The already-started isolated installer run 36546211410 completed successfully for
runtime 082888a007afe4fec83a7f2f795917e77edf7738, including runtime, actual-host
capacity/restart and bounded HTTP checks. Temporary rehearsal state was removed.
The prior mobile WebKit candidate retry was still running when this record was
written. No live source pause or traffic switch was issued.

Next: provision the dedicated Tickets connection, verify its read-only reachability,
finish exact-candidate CI, then complete the backup and controlled transfer gates.

### Dedicated access preparation — 29 September

The owner confirmed full discretion to continue and clarified that Tickets stays
on Hermes alongside BubbleWash, with separate application resources. The
Tailscale owner browser session is authenticated; Hermes is connected. Prepared
GitHub main-only OIDC trust with auth_keys scope; do not grant policy, user, DNS
or credential administration scopes. The new trust and SSH authorization have
not been submitted. Browser policy requires confirmation at the point of granting
new server access, even with earlier general authorization. No live switch occurred.

The three repository-owned workflows now use OIDC and fail closed when their
client ID/audience variables are absent. YAML and shell syntax checks pass.
Next: finish and confirm the prepared trust/SSH policy, configure its public ID
and audience in Tickets, then run the main-branch access probe and release gates.


## Verified Hermes setup; live transfer blocked — 29 September 2026 10:43 UTC

Tickets remains on the same Hermes server as BubbleWash, using its own OS user, directories, configuration, state, workflows, Tailscale identity, and backup procedures. Do not use the BubbleWash repository connection for Tickets operations.

Production source and installed VPS release: `1acd916c7414b30665c4f903dd2ce3ccf10609a0`. The earlier application commit `7b4d472` passed all three browser jobs (run 36550243182) and 489 local VPS tests; the final change only corrects public OIDC identifiers. Final exact-release VPS build 36553270881, Cloudflare deployment 36553270938, dedicated access/isolation check 36553270782, and Hermes installer/rehearsal 36553359253 all succeeded. Rehearsal passed 600 wallets, 1,200 duplicate scan races, 72,000 deliveries with zero errors, 599 reconnects, and 40/40 HTTP checks. Synthetic state was removed.

The working OIDC trust subject is `repo:bechirobob@85619137/tickets@1330037012:ref:refs/heads/main`, with auth_keys scope and tag:tickets-ci. Its public client ID/audience are pinned in the four Tickets workflows on main. The original repository variables point to the first, nonworking subject and are unused. Tailscale's existing Hermes host tag is named tag:bubblewash-prod; this identifies the shared server, not a shared application account. No app resource was merged. A separate tag:tickets-ci SSH rule permits approved deployment access to root on Hermes.

Preparation run 36554204239 succeeded at 10:13:47 UTC, transfer `034c4f23-82b8-402c-91a6-aaba1f6625f0`. After the full drain window, capture run 36555991275 failed closed because HTTP operation records did not drain. Its abort handler resumed source admission and queue delivery. No source freeze, data transfer, production VPS activation, or DNS switch completed; no fresh preactivation off-host backup was produced.

Read-only diagnostic runs 36556399739, 36556717578, 36556836912, 36556931408, and 36557079885 found 116 HTTP records from 10:11:51.638–10:14:07.037 UTC. Newer GET/HEAD probes returned 200 and cleared normally. Worker telemetry showed canceled GET invocations and Network connection lost errors during that period. Existing records lack a request identifier that can conclusively match them to completed/canceled invocations; timestamp proximity is insufficient grounds to delete them. Do not expire, delete, or ignore these records merely because they are old. Do not replay external deliveries or payments to clear this blocker.

Normal source operation was restored and verified in run **36557251677**: Cloudflare is the sole writer, source admission active, queue unpaused, HANDOVER_TRACKING=0, all 116 unresolved records preserved. Private Hermes journal phase is aborted. The preview runtime remains installed and verified. Recurring backup workflow is installed but skips while VPS is not the active writer; do not claim a production VPS backup succeeded.

Next work is a focused repair of HTTP lifecycle tracking and defensible reconciliation of the preserved records, including completed/canceled invocation evidence and any related side effects. Then repeat the guarded prepare/capture/off-host-backup/activate process using an exact verified release. Capture must fail closed until outstanding work is reconciled. Keep one active writer throughout. Main is 1acd916; the recovery branch contains diagnostic/checkpoint commits after the already merged PR #195.

### HTTP lifecycle repair — 29 September recovery

The root cause is a gap before cleanup registration: a disconnected client can
terminate admission/rendering before the old wrapper registers waitUntil. HEAD
responses can also discard an unread application stream. The repair registers
the handler lifetime before its first await, pumps streams with cleanup already
registered, and drains HEAD rendering explicitly. Non-personal operation IDs are
logged at admission/release for exact future invocation correlation.

Local typecheck, focused ESLint and 10 handover control/entrypoint tests pass,
including new render-lifetime, HEAD and stream-cancellation regressions. The
historical 116 records remain intact; the zero-outstanding-work capture gate
has not been weakened. No migration, resend or BubbleWash changes were made.

Next: exact-candidate CI and release of the lifecycle fix, then reconcile the
historical records using conclusive invocation/side-effect evidence before
prepare/capture/backup/activate. Timestamp proximity is not proof. Do not
repeat setup, access provisioning, or the already-passed host capacity work.


### Guarded legacy reconciliation

Read-only evidence run 36558791879 confirmed the exact historical set of 116
HTTP records (SHA-256 1ce09ef54981765646448a424926738d477790a85ccb8dc31b646c3d3716b4eb),
no pending payments/refunds/payouts/campaigns, no visible email queue messages,
and only delivered/failed email outcomes. Complete 15-second telemetry windows
avoid the earlier 2,000-event truncation. This is aggregate evidence, not an
assertion that a UUID has been matched to a completed invocation.

The candidate supports only that exact incident inventory. After admission and
queue pause, all other operations must drain and every Room must freeze. SQL
triggers then fence every source business table, including against old requests.
Only after checking terminal durable work under that physical fence are the
116 rows moved atomically into a preserved reconciliation ledger with the digest,
evidence run, counts and method; completion is explicitly not claimed. Any
changed/additional record or unresolved durable work still blocks capture.
Abort restores the original obligations before releasing the SQL fence. A
successful switch keeps the old source fenced; reverse transfer uses a fresh D1.
No customer data is deleted, no providers are replayed, and no BubbleWash resource
is touched. This replaces missing lifecycle evidence with enforced write
exclusion and explicit side-effect reconciliation, not time-based expiry.


### Active completion job — 29 September 2026

PR #196 passed all three candidate browser jobs in run 36559523736 and merged
as 18d1a08e0e77f862870aecd6b9fbcec4705c3bb8. Its tree matches tested candidate
85ce0a16d59bcaa606737b9750d78b325c25f1ec exactly. Production durable-work inspection
36560462791 returned zero for all twelve counters; source remains Cloudflare
until the guarded activation stage.

**Do not restart setup or replay a transfer.** Inspect completion run
36561390383 first (workflow on branch ops/tickets-operator-request).
It waits for exact-release runtime verification 36561278089 and source
deployment 36561278033, then dispatches the existing main-only installer,
prepare, the required 16-minute drain, capture with verified off-host backup,
activate, public health/route checks, production backup and browser verification.
Every dispatched run ID is printed in the completion log. The authoritative
Hermes journal is /var/lib/becore-tickets-handover/live-transfer.json.
If a stage fails, inspect its logs and journal phase before any replay; recover
paused/frozen state explicitly where needed. BubbleWash remains out of scope.


Preparation run 36562005115 completed at 2026-09-29T11:29:26Z.
Transfer 01b7d630-9512-4ddd-a6a9-d64d1591de73 is **prepared**; public source remains
active on Cloudflare. Installer 36561619608 passed the 600-guest,
72,000-delivery, restart and real-network checks with zero errors. The completion
job 36561390383 is now in its required 16-minute wait, with capture
expected around 11:46 UTC. Do not dispatch another prepare or capture while
that completion job is active. Inspect its run log for automatically dispatched
capture/activation/backup/browser runs.


## Recovery correction — 2026-09-29 11:54 UTC
Completion controller 36561390383 was cancelled before capture after detecting
fresh Cloudflare cancellation records. Source remains active; the prepared
transfer 01b7d630-9512-4ddd-a6a9-d64d1591de73 and original 11:29 preparation time
remain valid. Do not reinstall or re-arm tracking merely because chat disconnects.

Private terminal observer installed in 36563124626 stops fresh accumulation.
Exact platform invocation evidence retired 148 records in 36563513120, preserving
the proof. Three explicitly identified records have incomplete platform logs
(36564168953), so they are NOT claimed completed or expired. The same exclusive
SQL fence, Room freeze, twelve terminal durable-work checks, preserved archive
and abort restoration used for the original incident must reconcile them.
Unknown records still block. Room freeze now recognizes the same exact incident
inventory as source freeze; previously it incorrectly required zero before the
source had archived the incident. Preparation can refresh a verified release
while preserving the existing transfer and drain time, only while untouched and
active on the same database with tracking still armed.

Pending: candidate checks, release deployment/runtime artifact, install new
release, refresh existing preparation, capture/backup/activate, public health,
production backup and browser audit. Terminal utility source lives in branch
ops/tickets-terminal-observer. BubbleWash remains untouched.
