# Tickets VPS maintenance fallback

Requested 22 September 2026: show a branded outage page instead of Cloudflare's
Workers quota message, using the existing Hermes VPS. No hosting plan upgrade.

## Implementation

- Static, self-contained page: https://tickets-status.becoreops.com/ on Hermes
  (`51.195.20.137`). Caddy returns HTTP 503, Retry-After, no-store and noindex.
- Production DNS, Worker custom domain, app code and database are unchanged.
- A monitor-controlled Cloudflare Single Redirect targets only HTML GET/HEAD page visits
  on `tickets.becoreops.com`. API paths, API writes and payment callbacks are
  excluded. Query strings are not copied to the fallback host.
- The VPS monitor probes `/api/version` once a minute. Only HTTP 429 with
  Cloudflare's Error 1027 activates fallback. The fallback host must be healthy.
  Three consecutive valid application responses disable the redirect.
- The monitor updates only its exact managed rule, refuses changed rule content,
  writes state atomically and does not log credentials or customer data.
- There is a detection and propagation window; this is not an instantaneous
  replacement for the first failing request. API services remain unavailable
  until the original quota problem clears. This does not cover a Cloudflare-wide
  outage, because the redirect itself is served by Cloudflare.

## Active and verified — 22 September 2026

**Automatic switching is connected and active.** The systemd timer is enabled
across restarts and checks once a minute. The current Cloudflare quota outage
activated the redirect. Normal visitors now reach the branded maintenance page.

- Deployed runtime: Tickets `dc4c0b4ad1ef31ad2e58b8210a35d6bac0ca2b0c`.
  Later changes add verification, operational records and tests only.
- Page SHA-256:
  `278c9fa029b630e9a273f559c77c35fa1f65dc630c166078303d6062e6461a30`.
- Private activation succeeded in Tickets run `35724143368`, using the existing
  Tickets Actions Cloudflare secret directly over SSH to Hermes. No credential
  was copied into source, logs, artifacts, chat or another repository.
- The ephemeral SSH key was limited to the verified runner IP, an expiring
  authorization and the fixed activation command. Its public metadata was the
  only artifact. The server revoked the key after use; the runner destroyed the
  private key. The temporary gate and cleanup timer were removed.
- The Cloudflare connection lives in `/etc/becore-tickets-fallback.env`, owned by
  root with mode 0600. The monitor runs as a sandboxed systemd dynamic user.
- Final live verification: Bubble Wash run `35724735503`, source
  `3d76c617a2c852746388fe835bb3289713e1b887`.
  Confirmed timer enabled/active, service success, repeated scheduled quota
  detections, exact managed redirect enabled, HTML 302 to the fallback without
  copying query strings, API 429 without redirect even with HTML Accept, and
  branded fallback HTTP 503 with no-store. Browser navigation from the actual
  production URL displayed the branded maintenance page.
- Seven isolated monitor tests pass, including the complete recovery path:
  two persisted healthy checks perform no routing writes; the third disables
  only the managed rule and verifies the change. Live recovery has not yet
  occurred because the real quota block is still present. No fake production
  recovery or customer payment was triggered for testing.
- Existing Caddy site contents were preserved, configuration validation passed,
  and the existing Bubble Wash response remained HTTP 403 before/after initial
  installation. This preserves its baseline and does not establish its health.

The first follow-up verification used Python's default request identity, which
received HTTP 403; it now uses the actual monitor's request headers and confirms
HTTP 429 / Error 1027. A repeated cleanup attempted to stop an already-removed
transient timer; final verification is read-only and passed after that correction.

## Operation and credential rotation

No further user credential setup is required. The monitor currently uses the
existing Tickets deployment token, which also has deployment/DNS permissions.
It is stored privately on the VPS, not in the Bubble Wash repository. Future
rotation should use a dedicated token scoped to `becoreops.com` with
Zone > Single Redirect > Edit, delivered through the existing administrator SSH
connection to `activate-monitor.py` via stdin. Never print or commit the value.

Inspect `systemctl status becore-tickets-fallback.timer` and sanitized
`journalctl -u becore-tickets-fallback.service`. During a confirmed quota outage,
HTML navigation redirects to the VPS while APIs retain their original responses.
After three consecutive genuine `/api/version` responses identify the Tickets
service and a full commit revision, the monitor disables only its own redirect.
Unknown errors reset the recovery count and preserve the current routing state.

This improves the outage presentation; it does not restore bookings/payments
while Cloudflare blocks the original application. Allow approximately one check
interval plus Cloudflare propagation before the branded page takes over.

Managed zone: `bbf0174f839a0d22dbf6d9f4bd3cf53d`.
Ruleset: `c2e81ba1a73248c0a2974c1fc6889e28`.
Rule: `33ad93cad5f1407bb22bd3cca2686db5`.

The operational host workflow is isolated on the Bubble Wash branch because that
repository already has the verified Tailscale connection. It does not deploy or
change the Bubble Wash application. The Tickets main branch and the concurrent
quota/release fix have not been changed.

## Rollback

Stop automatic changes with `systemctl disable --now becore-tickets-fallback.timer`
and disable the exact managed Cloudflare redirect. Do not remove unrelated rules.
The original Caddy configuration, before adding this site, is saved on Hermes at
`/var/backups/becore-tickets-fallback/1790077070887758744-001bae4fa47b/Caddyfile`.
For full removal, remove only the fallback import/site after comparing current
config to that snapshot; validate Caddy before reload. Avoid restoring an old
whole-file snapshot over later unrelated site changes. Remove only the dedicated
fallback DNS record if retiring the hostname.

References: [Cloudflare redirects](https://developers.cloudflare.com/rules/url-forwarding/),
[redirect API permissions](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/create-api/#required-api-token-permissions),
[Workers quota](https://developers.cloudflare.com/workers/platform/limits/#daily-requests).

## Functional VPS runtime — preparation in progress

The owner authorized a VPS application deployment and allows it to become the
primary host. A small progress log is not a database replication mechanism.
The target is one authoritative application database on Hermes, with atomic
SQLite WAL transactions, persistent delivery jobs and Room state. Never let an
old Cloudflare copy and the VPS independently sell tickets. An automatic return
to an older writable Cloudflare database is explicitly unsafe.

Source branch: `feat/vps-primary-runtime`. The Node runtime reuses the existing
application, authorization and payment logic; only the Cloudflare runtime
bindings are adapted. Hermes has Node 22.22.2, four cores, approximately 5 GB
available RAM and 33 GB free disk at the initial read-only capacity check
(Bubble Wash run `35726516617`). The application artifact is built in CI, not
on the shared VPS. Production preview listens only on `127.0.0.1:3118`, runs as
an unprivileged account, uses separate preview state, disables scheduled work
and denies outbound network access through its systemd unit. Caddy and DNS
remain on the verified branded maintenance setup until handoff is complete.

Storage policy: Tickets journal namespace has a 32 MB budget and seven-day
retention; release cleanup retains the newest three releases plus any active
and rollback pointers. Obsolete releases must also be older than two days.
Incomplete temporary uploads expire after one day. Cleanup never visits the
application database, Room state, financial records or customer tickets.
Persistent delivery work is deduplicated and capped at 10,000 pending tasks;
acknowledged tasks are removed. Unresolved work is not discarded because it is
old. Existing product expiry and analytics retention rules remain intact.

Initial complete CI run `35729472907` passed lint, TypeScript, dependency audit,
all existing application/Worker tests, 439 backend tests on Node, both builds,
retention checks, and real HTTP/QR/Room WebSocket checks with production-only
dependencies. Follow-up verification adds process restart persistence, exact
CSP nonce matching and persistent queue/rate-limit tests.

The read-only Cloudflare inventory at 12:49 UTC on 22 September 2026 confirmed
HTTP 429/Error 1027. The application database is
`8f8723c2-673a-4aba-b025-83c05d67d075`; Room namespace is
`683655a4b4924e54b31b9b7aad6e2e27`. Seev and Resend credentials are present in
the existing Tickets Actions secret store. Paystack, VAPID push keys, the staff
decoy key and Apple Wallet auth secret are Worker-only in that inventory.
Do not print, commit or attach private credentials or live database snapshots.

Before live activation:

1. Reconcile the latest deployed source, including the concurrently developed
   VPS email integration, with the tested runtime branch.
2. Transfer matching production credentials through the private operator path.
   Cloudflare's secret listing cannot reveal stored values. Preserve VAPID and
   wallet identity so existing subscriptions and passes continue working.
3. Stop all Cloudflare writes and scheduled/queue consumers, export D1 and every
   Room's full persistent state, import into private VPS production state, and
   verify counts, relationships, issued QR identities and pending deliveries.
4. Record the verified handoff in private `handoff.json` with source
   `cloudflare`, writer `vps`, and explicit sourceWritesStopped, roomsVerified
   and credentialsVerified flags. Active mode refuses a dirty release or a
   missing handoff. Those flags are an operator gate, not a substitute for the
   actual migration and checks.
5. Establish encrypted off-host backups and rehearse restoration. Configure
   Caddy to overwrite client-address headers and preserve the public hostname,
   session cookies, WebSockets and payment callback paths. Only then change
   production routing and disable the old maintenance redirect monitor.
6. Verify real production booking, host confirmation, ticket access, Room
   announcements and opted-in push; do not infer these from isolated fixtures.

Photo moderation and the organizer AI gateway still depend on Cloudflare APIs.
Photo moderation fails closed when its provider is unavailable. This preparation
therefore does not yet establish complete independence from every Cloudflare
service, or functional live failover.
