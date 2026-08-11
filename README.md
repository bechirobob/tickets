# BeCore Tickets

Curated party discovery and ticketing for Accra. The application includes the
customer experience, organiser submissions and workspaces, named role-based
operations access, configurable booking fees, Paystack payment initialization
and webhooks, ticket records, and gate operations. Paid tickets also unlock
**The Room**, a private real-time space for verified attendees and authorised
event staff.

## Runtime

- Cloudflare Workers
- D1 for transactional application records
- Durable Objects with hibernating WebSockets for one isolated Room per event
- R2 for organiser poster uploads
- Paystack Ghana for Mobile Money checkout
- Vinext, React, TypeScript and Drizzle ORM

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
- `npx wrangler deploy --dry-run`

## Deployment

The Worker is built from `main`. CI generates binding types, audits production
dependencies, lints, type-checks, runs the complete test suite, performs a
Wrangler dry-run, captures the current D1 time-travel bookmark, applies pending
versioned D1 migrations, and only then deploys the Worker. This order keeps the
currently deployed code compatible while the additive schema update is applied
and gives operators a precise pre-migration recovery point.

Production requires the following encrypted Worker secrets:

- `ADMIN_ACCESS_KEY` (one-time owner bootstrap only)
- `PAYSTACK_SECRET_KEY`
- `RESEND_API_KEY`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Turnstile is required for production sign-in, owner bootstrap, checkout,
ticket recovery and organiser submission. The production application fails
closed when either key is missing. Create a Turnstile widget for the production
hostname and add both keys before deploying.

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

## Operational security

Staff sessions are random opaque credentials; only their SHA-256 hashes are
stored in D1. Passwords use PBKDF2-HMAC-SHA-256 with 600,000 iterations and
per-account salts. Five consecutive failures lock an account for 15 minutes.
State-changing operations enforce same-origin requests, named permissions and
event assignments, and sensitive activity is written to the operational audit
log. Public writes and sign-in are protected by Cloudflare rate-limit bindings.
Worker logs are enabled at 100%, traces are sampled at 5%, and scheduled
operational failures create durable alerts in D1.

## The Room access model

Room access is never granted by an event URL. Checkout creates a one-time,
hashed order claim. After the signed Paystack webhook marks the order paid, the
return flow exchanges that claim for an HttpOnly attendee session and assigns
the issued tickets. Every WebSocket connection then re-checks the session,
ticket assignment and ticket status in D1 before reaching the event's Durable
Object. Full processed refunds, voided tickets and suspended profiles lose
access automatically.

Version one supports text, replies, reactions, pinned organiser announcements,
presence, reporting, blocking, moderation removal, rate limiting and a
72-hour post-event read-only archive. Direct messages and attendee media uploads
are intentionally excluded from this release.
