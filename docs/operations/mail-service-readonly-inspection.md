# Installed mail-service inspection proposal

Prepared locally against application release 885bd1b2d97ff687fe884c86314ae9b368d4abff.
This is an operator diagnostic, not a deployment or provider activation. The
Room-only application patch eb056e6 is separate and is not applied here.

## Reviewed access route

Existing repository workflows use the pinned Tailscale action
306e68a486fd2350f2bfc3b19fcd143891a4a2d8 with the existing Tickets CI identity and
root@hermes. No new credentials, access grants, host, or identity are proposed.
The exact-main/predecessor-gated workflow added with this diagnostic runs the
focused tests before its only remote command:

    tailscale ssh root@hermes 'python3 -B -' < ops/vps/inspect-mail-service-readonly.py

This preparation has not executed that command. Do not use
an old workflow with stale revision pins. Do not run historical mail installers,
verification send routines, or external SMTP/API requests.

## Exact reads

- Shared nonblocking existing /run/lock/becore-tickets-deploy.lock, opened read-only.
- systemctl show becore-tickets.service, ActiveState and WorkingDirectory only;
  requires the exact application release above.
- docker inspect becore-tickets-mail, selecting only container ID, image ID,
  running boolean and start timestamp. Never inspect Config.Env or full metadata.
- /etc/becore-tickets-mail/revision: bounded no-follow read, regular root-owned
  file, not group/world writable; exactly a 40-character hexadecimal revision.
- GET http://127.0.0.1:8826/healthz: no proxy, no redirects, bounded body. Exports
  only the known service name, validated revision and sendingEnabled boolean.
- docker exec becore-tickets-mail python3 -B -c [fixed reader]: no-follow,
  read-only /app/mailer.py, bounded regular root-owned non-writable source under
  verified /app directory. Source is parsed as AST, never imported/executed and
  never emitted. The temporary Python process does not write bytecode or files.
- Repeat identity, marker and health to reject concurrent service replacement or
  configuration changes. The app shared lock is not claimed to be a mail-service
  deployment lock; stable observations reduce but do not eliminate that limitation.

Output: app/mail revisions, image/container IDs, source SHA-256, known supported
kind names, unknown-kind count, Room/Host-pass support booleans, health metadata,
and whether the historical seven-day terminal-payload cleanup syntax is present.
This last field is only static evidence, not proof cleanup executes or covers WAL,
backups, SMTP spool, logs or nonterminal messages. Unknown source syntax stays
unknown; never infer a retention duration from a comment or partial string match.
Errors emit only a fixed stage, allowlisted category and bounded HTTP status or
command exit code when available. Raw exceptions and subprocess stderr are never
printed. Source descriptor/path identity is checked before and after its read.

Not read: keys, DKIM files, application or container environments, database files,
mail logs/journal, recipients, payloads, message IDs, provider-status endpoints.
No configuration changes, sends, retries, unsuppression, routing changes, volume
changes or cleanup. event_host_pass remains outside the proposed route.

## Separate historical bounce question: source-only findings

Historical protocol dc8355093f42cb00501d9f587e494b25811af884 stores messages columns
id, payload_hash, payload, status, queue_id, detail, created_at, updated_at,
attempts, next_attempt. There is no SMTP-code/DSN-code column. reconcile_line
replaces bounce detail with a generic rejection sentence. DSN 5.1.1 may cause a
hashed-address suppression but is not retained as a structured code.

Codes might survive in /var/log/becore-tickets-mail/mail.log, mapped inside the
container to /mail-log/mail.log. Current retention/rotation and historical content
are unknown. No assumption is made about journald retaining Postfix evidence.

If separately reviewed, the smallest database lookup is a read-only, query-only,
bounded transaction against /var/lib/becore-tickets-mail/outbox.sqlite:

    SELECT queue_id,status FROM messages
    WHERE id IN (?,?,?,?) AND status='bounced'

The four bound provider IDs must be privately resolved and verified against the
exact approved historical cohort first; do not guess them or put them in source,
command arguments or logs. If these are not VPS IDs, stop rather than scanning
unrelated service data. Keep queue IDs only in memory. Do not select payload,
recipient, detail or all messages. Open mode=ro (not immutable against live WAL),
PRAGMA query_only=ON, explicit read transaction, timeout/progress bound, and
assert zero changes. Return counts only for no match/ambiguous evidence.

Any later log scan must be separately reviewed: exact known log path(s), bounded
bytes/time, no symlinks/unverified rotations, matching only those in-memory queue
IDs and postfix/smtp records in the approved UTC observation window. Extract only
validated numeric DSN and SMTP codes; aggregate counts with unknown/missing
categories. Never return raw lines, remote hostnames, identifiers, addresses or
SMTP response text. No automatic resend or unsuppression follows from this
inspection, including when detailed codes are absent.
