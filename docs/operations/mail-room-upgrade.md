# Exact Room mail-service upgrade

Publication alone does not activate this upgrade. The automatic first run is
read-only preflight. Applying the additive mail schema and planned mail-only pause
requires separate explicit approval after the actual preflight result is reviewed.
A CLI flag alone is not approval. No guest test send is part of this workflow.

Inputs pinned in the upgrade operator:
- App release 885bd1b2d97ff687fe884c86314ae9b368d4abff.
- Installed mail revision dc8355093f42cb00501d9f587e494b25811af884.
- Image sha256:667781d8921b05766d04090a3dd4a34bc62ae3b6ae3cd2202a8b5e9747753300.
- Installed source fea4874c1877a4c227302c8030da6d4f6b2855450de27a7362f021d854e40c5b.
- Replacement source 37ed2a28acda640f73af4e2db90b5cb9f41b434a016a5b85c978ae579d413fc3.
- New release revision is a reviewed 40-hex pipeline input, distinct from old.

Replacement source is the independently reviewed Room-only allowlist plus two
nullable numeric-code fields. It does not add event_host_pass, change routing,
backfill/reset a cursor, modify templates, or resend anything. Actual installed
baseline installer is NOT invoked. No DNS/Caddy changes, package installation,
credentials, permissions expansion, spool purge, DB restore or rollback deletion.

## Files and execution contract

The exact workflow defaults to read-only preflight on its normal main merge.
A separate manual apply operation requires explicit approval for the mail pause,
service replacement and additive schema. Its confirmation text is an operator
safeguard, not a substitute for that approval. The workflow verifies the fixed
predecessor, eight-path inventory and exact source hashes, runs the tests, then
passes only reviewed public Python sources through stdin to the existing service
operator identity. Modules are loaded in memory; no host source staging files,
new credentials, secret arguments or private payload uploads are introduced.
The existing metadata helper gains only an optional health timeout parameter;
default callers are unchanged. Rerunning an uncertain apply is prohibited.

The preflight is read-only: verifies config/source/app provider and returns only
matched booleans, vps enum, signing-key-valid boolean, aggregate in-flight/spool
counts and an explicit snapshot-not-authorization flag. It does not build, pause,
write a journal, create a sending marker, or stop/start a process. A busy snapshot
is not authorization to retry/force restart later.

## What the upgrade changes

1. Verify exact old source/image/revision/app and an explicit non-secret Docker
   projection. Verify immutable image environment defaults and exact release env
   through allowlisted booleans/tokens inside Docker templates, never raw env values.
   Unknown/more-permissive projected settings fail with fixed check names.
2. Privately verify the actual application MainPID uses the known effective
   runtime JSON bridge, canonical/effective private files match, both use the
   established ownership/mode, and the flat string-only shape matches code-release.
   Only existing provider=vps and signing-key-length-valid boolean pass. No settings
   or credentials are created. Stable descriptors/paths protect config-file reads.
3. Build a derived image offline from the exact installed image with only COPY of
   reviewed mailer.py. No RUN/package/network build instructions. Retain the image.
4. Under existing exclusive deployment lock revalidate everything; refuse any old
   journal/pause marker or occupied rollback name. Create a root-only durable
   operation journal containing phases and code/container identity, not recipients.
5. Acquire bounded BEGIN IMMEDIATE as the existing mail UID/GID 10000. Root is
   restored only for Docker/control work while the connection holds the fence.
   Validate DB/sidecar ownership. Refuse any submitting/accepted/delayed/review
   row or any Postfix queue record; unknown output/timeout also refuses.
6. Journal and rename the existing protected sending marker, preserving its inode,
   bytes, ownership and mode. Keep the DB fence through the 40-second-bounded stop
   and stopped-state verification. Retain old container under unique rollback name.
7. Release the no-change DB transaction; start identical-config replacement with
   sending paused. Verify exact source/health/allowlist and both nullable fields.
8. Atomically update revision, journal the enable boundary durably, then restore
   the exact original marker. Verify health/config and journal completion.

## Rollback and interruption

Every stop of a replacement requires its exact config identity plus a newly held
DB fence and empty Postfix queue. If a handoff exists, do not pause/stop it; leave
it running and record manual_reconciliation_required. If a stop/start result is
uncertain, do not repeat it, enable another process or blindly restart. Existing
in-progress journal/pause markers refuse a fresh run. Inspect the recorded boundary
and actual processes before proposing a separately reviewed recovery.

When the replacement is running and proven quiescent, guarded rollback pauses it,
stops and retains it under a failed name, restores the retained old container,
verifies paused old health, and restores the original marker. It never restores an
old DB snapshot, deletes added columns, resets queued rows, purges mail, or removes
images/rollback containers. A stopped/exited/unknown replacement unable to provide
queue proof requires manual reconciliation instead of speculative rollback.

After enabling, a failed health check uses the same fence. An active handoff blocks
rollback; natural mail already handed off is never retried automatically.

## Verification and honest limits

- 24 local operator tests: exact projection rejection, offline tar contents, actual
  SQLite fence, marker preservation/enable ordering, successful synthetic upgrade,
  paused failure rollback, post-enable busy refusal, uncertain stop/start, existing
  journal refusal, safe errors, aggregate preflight and private provider checks.
- Actual absent-WAL/SHM test runs under this local unprivileged test account set as
  the fixture mail UID; a separate mocked privilege-sequence test proves entering
  UID/GID 10000 before SQLite work and restoring root after errors. No root/UID10000
  production execution occurred here.
- 25 service tests separately pass in tickets-mail-numeric-codes, including actual
  signed local HTTP Room-kind receipt/status roundtrip with injected no-network
  transport, additive migration/rollback and numeric parser/privacy behavior.
- Non-secret Docker defaults such as memory-swap, masked paths and log driver are
  explicit fail-closed expectations, not live observations. A differing safe value
  must be reviewed from bounded diagnostics, never silently cloned/accepted.
- These are synthetic mechanism/operator tests, not Docker deployment proof.
  No live preflight, live pause, migration, restart or email has been executed.

Failure output distinguishes read-only preflight from potentially mutating upgrade,
includes only fixed stage/check/category and bounded status/exit code, and marks
uncertain/manual outcomes. It never claims read_only=true after an upgrade attempt.

## Bounded readiness and pause duration

Readiness has one monotonic 60-second deadline, health calls capped at five seconds
or remaining time, and source inspection capped at fifteen seconds or remaining
time. Only unavailable health is retried. A confirmed wrong revision/sending flag,
source hash or kind fails immediately into guarded rollback, not another poll.
The metadata helper delta only exposes the existing health timeout as an optional
parameter with the same ten-second default for other callers.

Image build is capped at 120 seconds and occurs before the pause. Each Docker stop
allows 40 seconds around Docker's 30-second graceful-stop window; other Docker
commands generally allow 20 seconds. SQLite lock acquisition allows five seconds.
A successful startup or guarded rollback can therefore delay mail for minutes,
not a guaranteed few seconds. There is no claimed whole-operation wall-clock SLA:
filesystem durability operations or interrupted/manual reconciliation can leave
sending paused until safely resolved. The preflight does not pause mail.

Preflight now checks the same protected root/control/DB-parent directories,
original sending-marker metadata and both rollback-name collisions as apply.
Errors expose only fixed allowlisted check names, not filesystem/config values.
