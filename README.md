# BeCore Tickets

Curated party discovery and ticketing for Accra. The application includes the
customer experience, organiser submissions and workspaces, named role-based
operations access, configurable booking fees, Paystack payment initialization
and webhooks, ticket records, and gate operations. Paid tickets also unlock
**The Room**, a private real-time space for verified attendees and authorised
event staff.

## Runtime

The production application runs on the existing Tickets VPS service, behind the
Cloudflare TLS/security edge. It uses Node.js, local transactional SQLite,
persistent delivery jobs and WebSocket Rooms. Cloudflare Workers, D1 and Durable
Objects remain the preserved fallback deployment; that copy is write-frozen while
the VPS owns production. A return must transfer current data through the reviewed
handover procedure, never just switch DNS to stale data.

The shared application uses Vinext, React, TypeScript and Drizzle ORM. SeevPlus
Mobile Money and separately gated USDC checkout are available alongside the
Paystack integration. Provider availability and commercial acceptance are distinct
from mocked tests. See [dual-hosting operations](docs/operations/dual-hosting.md)
and [SeevPlus](docs/runbooks/seevplus.md).

## Local setup

Requires Node.js 22.13 or newer.

1. Run `npm ci`.
2. Copy `.dev.vars.example` to `.dev.vars` and replace every example value.
3. Run `npm run db:migrate:local`.
4. Run `npm run dev`.

Never commit `.dev.vars`, Paystack keys, administrator credentials, or
Cloudflare credentials.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:vps`
- `python3 -m unittest discover -s ops/vps -p 'test_*.py'`
- `npm run build:vps && node scripts/verify-vps-runtime.mjs`
- `npx wrangler deploy --dry-run`
- `npm run test:e2e:production` after deployment
- `D1_EXPORT_FILE=/path/to/export.sql npm run recovery:rehearse`

## Deployment

Production release is an explicit main-only **Release verified Tickets VPS code**
workflow. It requires the exact merged source, successful VPS-runtime artifact,
equivalent-tree three-browser candidate verification and the expected active
revision. Reviewed additive migrations get a private integrity-checked pre-change
backup; the updater preserves the prior code release and verifies local and public
health before reporting success. Normal Cloudflare deployment is intentionally
blocked while the VPS is the active writer.

Successful releases trigger source-bound production browser audits. The scheduled
**Tickets encrypted backup** workflow verifies a complete isolated restore and
stores encrypted off-host evidence with 35-day retention. Restore and fallback
procedures, single-writer constraints and dated runtime receipts are documented in
[dual-hosting operations](docs/operations/dual-hosting.md). Historical D1 recovery
is described separately in [the D1 runbook](docs/runbooks/d1-recovery.md); it is not
proof that the live VPS was restored.

Production credentials remain in private service-managed configuration and the
existing secret stores. Required credentials depend on enabled payment/email
features. Never place secret values in source, artifacts or logs. Existing owner
bootstrap, account recovery and credential changes must use their documented
flows; a release must not recreate the owner or replace authentication secrets.

Public and staff mutations are protected without customer-facing challenges:
same-origin enforcement, hashed per-identity/IP rate limits, account lockouts,
honeypot screening, strict input validation and provider-side payment checks.

After migration `0008`, visit `/admin/bootstrap` once and use
`ADMIN_ACCESS_KEY` to create the first named owner. The route closes as soon as
the first staff account exists. Confirm the owner can sign in, then remove the
legacy bootstrap secret with `wrangler secret delete ADMIN_ACCESS_KEY`. Owners
can create named curator, finance, organiser, gate and moderator accounts from
`/admin/accounts`; organiser, gate and moderator accounts can be scoped to
specific events. Temporary passwords must be changed on first sign-in.

`EMAIL_FROM` is a non-secret Worker variable. Its domain must be verified with
the transactional email provider before customer delivery is enabled. The
email contains an itemised receipt and one-time wallet recovery link; it never
contains a reusable QR code.

Paystack must remain in test mode until the business account, webhook, refund,
settlement and reconciliation checks have passed.

## Optional SeevPlus payments

SeevPlus Mobile Money checkout and separately gated USDC checkout are available
behind explicit configuration
flag. Setup, sandbox tests, recovery behavior and refund/settlement limits are
documented in [the SeevPlus runbook](docs/runbooks/seevplus.md). Paystack remains
the default; no SeevPlus credentials are included in the repository.

## Operational security

Staff sessions are random opaque credentials; only their SHA-256 hashes are
stored in the active transactional database. Passwords use PBKDF2-HMAC-SHA-256 with 600,000 iterations and
per-account salts. Five consecutive failures lock an account for 15 minutes.
State-changing operations enforce same-origin requests, named permissions and
event assignments, and sensitive activity is written to the operational audit
log. Public writes and sign-in use the runtime rate-limit adapter. Scheduled operation
health and durable alerts are retained in the active database; monitoring and
provider limits must be checked independently of a successful build.

## The Room access model

Room access is never granted by an event URL. Checkout creates a one-time,
hashed order claim. After the signed Paystack webhook marks the order paid, the
return flow exchanges that claim for an HttpOnly attendee session and assigns
the issued tickets. Every WebSocket connection then re-checks the session,
ticket assignment and ticket status in the active database before reaching the
event's isolated Room runtime. Full processed refunds, voided tickets and suspended profiles lose
access automatically.

The Room supports text, replies, reactions, pinned organiser announcements,
presence, reporting, blocking, moderation removal, rate limiting, automatic
reconnection and temporary Flashes. Flash image bytes are privately served from
the active database and permanently erased when the Room closes; only moderation metadata remains.
The text conversation becomes a 72-hour post-event read-only archive.
