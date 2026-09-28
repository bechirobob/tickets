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
