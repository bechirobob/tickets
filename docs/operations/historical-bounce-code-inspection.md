# Historical bounce numeric-code inspection

This package adds a read-only query/parser, gated runnable wrapper and fixed
predecessor workflow. When ordinarily merged from the exact predecessor, the
workflow runs one inspection attempt. At preparation time it has not been
published or executed. It does not deploy the app, call a provider or mutate data. Current application source is 885bd1b2; mail schema reference is
historical dc8355093f42cb00501d9f587e494b25811af884. Installed mail metadata/source was independently verified at 14:46:06 UTC:
revision dc8355093f42cb00501d9f587e494b25811af884, source SHA-256
fea4874c1877a4c227302c8030da6d4f6b2855450de27a7362f021d854e40c5b,
sendingEnabled true. The wrapper pins and rechecks these values at action time.

## Private selection contract

1. Find one uncancelled, fanned-out original first-host receipt for the fixed event
   and creation timestamp already used by the approved recovery.
2. Select exactly four distinct current original-inbox attendees and distinct
   RSVP booking contacts. Keep original recovery's current paid/valid assigned
   pass, active attendee, confirmed claimed RSVP matching order contact, Room
   access, active assigned host, event state, suspension/block/mute/push/opt-out
   checks. Instead of excluding bounce suppression, require it; exclude complaints.
   Exclude existing non-suppressed canonical first-host email jobs.
3. For each private contact, select its latest historical bad-delivery event, ordered by
   COALESCE(provider_event_at,updated_at) DESC,id DESC as in the private endpoint,
   with the exact four previously observed Oct19 event timestamps and a valid VPS provider ID.
   Read at most two rows to reject a tied latest timestamp. Older distinct events
   do not invalidate the exact identified latest event; newer events fail its pin.
   No private contact, attendee ID or provider ID is printed, persisted or placed
   in command arguments. No payload or failure text is selected.
4. Resolve exactly those four provider IDs in the mail outbox, selecting only
   id, queue_id, status and updated_at. Require four unique valid queue IDs,
   bounced status and Oct19 UTC last update. Never select payload, payload_hash,
   recipient, detail, suppressions or unrelated rows.

Scope limitation: the exact four event-time values plus original receipt/current
cohort predicates strongly bound this investigation but are not cryptographic
identity pins. All recipient/provider/queue linkage stays privately runtime-derived.
Ambiguity or changed timestamps stops inspection; never widen the query. Current
push, mute or consent changes may stop this historical lookup even when old bounce
evidence still exists. Report that limitation rather than silently relaxing it.

## Database discipline

Only /var/lib/becore-tickets/tickets.sqlite and
/var/lib/becore-tickets-mail/outbox.sqlite are allowed. Validate regular files,
trusted ownership passed from verified service accounts, no symlinks and safe
ancestor permissions. Use URI mode=ro (not immutable, which could miss live WAL),
PRAGMA query_only=ON, explicit read transaction, three-second lock timeout and
15-second progress bound. An authorizer permits only SELECT/READ/FUNCTION and
transaction operations, denying mutations, ATTACH and PRAGMA changes. Assert
zero total_changes. Existing WAL/shared-memory sidecars must both exist and pass
validation when either exists; no migration, checkpoint or new sidecar creation
is requested. SQLite's normal read locks/shared-memory coordination are not a
claim of an untouched kernel cache. The wrapper must retain the current deployment
lock/revision gate and keep private database snapshots open only as needed.

## Log discipline

Only two explicit uncompressed files in the existing container mount are read:
- /mail-log/mail.log
- /mail-log/mail.log.1

The existing mount must be bind-backed by /var/log/becore-tickets-mail, with
exact destination /mail-log. The root-owned 0750 directory device/inode must
match on host and inside the verified container before and after. This avoids
the observed group-writable host /var/log ancestor without relaxing its policy.
The same reviewed reader runs in memory in that container, with private queue
IDs passed over stdin, no command-line identities and no remote files written.

No directory listing, glob, journal dump, compressed/archive exploration or other
host log. Total 16 MiB and 15 seconds; lines capped at 16 KiB. Oversized files are
not silently tail-scanned. Missing files, bounded-out scans and missing evidence
remain unknown. Require non-symlink regular trusted-owner files, no writable-by-
others paths, stable open inode, and stable size/mtime during each read.

Only exact privately resolved queue IDs on postfix/smtp bounced records with
unambiguous Oct19 2026 UTC RFC3339 timestamps are considered. Old syslog formats
without year/timezone are deliberately untrusted; obtaining evidence from those
would require a separately reviewed provenance/timezone strategy, not guessing.
Extract numeric dsn=X.Y.Z and SMTP three-digit code only after the explicit
"said:" reply marker. Do not retain or export response text, recipient, remote
hostname/IP, queue/provider ID, payload or raw log line. Duplicate evidence across
two files collapses per message; conflicting numeric evidence is ambiguous.

Output is four-message aggregate counts, numeric-code pairs with counts, missing
file/incomplete-scan indicators and unknown/ambiguous counts. DSN 5.7.x means
security/policy class only, not proof that sender policy caused the rejection.
5.1.x is address-status class, 5.2.x mailbox-status class, 4.x transient class;
these classifications do not establish an exact cause or permit a resend.

## Runnable wrapper and ownership

The wrapper reuses inspect-mail-service-readonly.py's command, source/identity,
revision, health and safe-error functions. It holds the existing shared
nonblocking deployment lock and requires application release 885bd1b2. It checks
mail source hash/container/revision/health before and after, opens fresh private
read-only snapshots after the scan, and compares attendee/contact/provider pairs
and exact provider/queue/status/timestamp rows before printing aggregate output.
Any change withholds all results and emits only fixed stage/category metadata.
Container-reader failures retain a fixed internal stage/category, never raw errors.
Numeric aggregate output is independently bounded and validated before export.

Historical Dockerfile fixes tickets-mail UID/GID 10000. Historical start.sh owns
/data (host /var/lib/becore-tickets-mail) as 10000:10000 mode 0700, log directory as
root:10000 mode 0750 and mail.log as root:10000 mode 0640. Therefore mail SQLite
files require UID 10000, log files root UID 0, and app SQLite files the existing
becore-tickets account's pwd-resolved UID. No key file or full environment is used
to discover identity; ownership mismatch fails closed.

Because the live application predates these operator scripts, the included
workflow streams both exact reviewed files into memory rather than writing them
onto the host. Construct a Python module named tickets_mail_metadata,
exec the reviewed metadata source into its dictionary, register it in sys.modules,
then exec this reviewed bounce script as __main__. The metadata module name keeps
its own CLI inactive. Both source strings must come only from the exact checked-out
commit with predecessor/path gates, never downloaded external input. The wrapper
also supports normal local sibling-module import for tests. The workflow requires
the exact main predecessor pinned in the workflow, attempt one and its exact
changed-path inventory. Do not run it outside the approved operator context.

## Remaining gates

- Independent review of the complete wrapper/query/parser diff and exact fixed
  predecessor workflow remains required before remote execution.
- The four timestamp pins are COALESCE(provider_event_at,updated_at), not creation
  times. Do not reinterpret them or replace them with a broad date-only filter.
- Wrapper already verifies exact app revision, mail-service/source identity, lock
  and service owner IDs. Do not replace failed pins or discover alternative hosts.
- Wrapper rechecks private cohort and provider-to-queue pairing in fresh snapshots
  after scanning, and withholds output on changes. Keep errors fixed/redacted.
- All bounces remain suppressed. No resend, recipient edit, mailbox verification,
  retry, status update, provider switch or cleanup is authorized by these results.
