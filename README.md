# BeCore Tickets

Curated party discovery and ticketing for Accra. The application includes the
customer experience, organiser submissions, BeCore curation, configurable
booking fees, Paystack payment initialization and webhooks, ticket records, and
gate operations. Paid tickets also unlock **The Room**, a private real-time
space for verified attendees and authorised event staff.

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

The Worker is built from `main`. CI validates the application, applies pending
versioned D1 migrations, and only then deploys the Worker. This order keeps the
currently deployed code compatible while the additive schema update is applied
and prevents new routes from reaching an older database schema.

Production requires the following encrypted Worker secrets:

- `ADMIN_ACCESS_KEY`
- `ADMIN_SESSION_SECRET`
- `PAYSTACK_SECRET_KEY`

Paystack must remain in test mode until the business account, webhook, refund,
settlement and reconciliation checks have passed.

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
