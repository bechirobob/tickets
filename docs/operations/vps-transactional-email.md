# Tickets transactional mail on Hermes

Sender: **BeCore Tickets <tickets@becoreops.com>**. Campaigns and event announcements remain on Resend. The application uses Resend unless `TRANSACTIONAL_EMAIL_PROVIDER=vps`; a missing VPS credential never silently changes provider.

The isolated `becore-tickets-mail` container uses Postfix, OpenDKIM and an authenticated HTTPS outbox at `mail.becoreops.com`. Port 8826 is published on loopback only; no SMTP port is published. Caddy exposes only health, send and status endpoints. Requests are bound to their exact body, path and a five-minute timestamp using HMAC. Host secrets are under `/etc/becore-tickets-mail`, mode 0700. Message storage is under `/var/lib/becore-tickets-mail`; payloads are purged seven days after terminal status. Postfix queue data persists independently of container replacement.

`ops/email/install.py SOURCE FULL_COMMIT_SHA` builds from an immutable checkout, preserves existing mail services and Caddy sites, and creates a separate 2048-bit DKIM selector. It adds the VPS IPv4 address to the existing SPF record without removing other providers or changing DMARC. It stores the API signing key in the existing Worker secret store. It does **not** enable sending. Failed installation restores the prior container and keeps diagnostics in a root-only file.

Before activation:

1. Confirm DNS-only `mail.becoreops.com A 51.195.20.137`, the dedicated `ticketsvps202609` DKIM record, SPF authorization, HTTPS, signature enforcement and the paused state.
2. In the VPS provider account, set **51.195.20.137 PTR to mail.becoreops.com**. The current reverse hostname is unrelated and does not resolve. Cloudflare DNS cannot set provider-owned reverse DNS. No provider credential was found in the existing connection.
3. Verify matching forward/reverse DNS, deliver a controlled owner test, and inspect SPF, DKIM and DMARC results in the received message. Recipient SMTP acceptance alone does not establish inbox placement.
4. Publish the tested application revision. Enable the host control flag `/etc/becore-tickets-mail/control/sending-enabled` only for the controlled test/verified activation, then set Worker secret `TRANSACTIONAL_EMAIL_PROVIDER=vps`. Keep the existing Resend credential for campaigns and already queued Resend deliveries.
5. Verify a real transactional journey and delivery status. Initial server allowance is 2,000 new messages in a rolling day; this is a safety limit, not a delivery or reputation guarantee.

Each D1 payload pins its provider. Old payloads default to Resend, and provider rollback does not move previously accepted messages to another sender. The VPS deduplicates by the application key; an ambiguous SMTP DATA result is held for reconciliation instead of being resent. Postfix retries temporary SMTP failures for up to 30 minutes. The dashboard distinguishes accepted, deferred, delivered-to-recipient-server and rejected messages through scheduled status polling.

Rollback new traffic by setting `TRANSACTIONAL_EMAIL_PROVIDER=resend`. Keep the VPS running to finish or reconcile already accepted messages; do not delete its queue or database. Removing the host flag pauses new API acceptance and handoff, but does not cancel messages already in Postfix. To stop queued SMTP delivery in an incident, stop the container while preserving its volumes. Reinstall a previous immutable revision to roll back the service.

Validation: Python outbox/security/recovery tests are in the candidate workflow; Worker tests cover provider selection, request signing, retry pinning and delivery reconciliation. Production delivery remains unverified until the activation checks above pass. The separate Cloudflare Error 1027 incident can still block the application itself; this mail service does not repair that quota incident.
