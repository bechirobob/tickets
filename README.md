# BeCore Tickets

Curated party discovery and ticketing for Accra. The application includes the
customer experience, organiser submissions, BeCore curation, configurable
booking fees, Paystack payment initialization and webhooks, ticket records, and
gate operations.

## Runtime

- Cloudflare Workers
- D1 for transactional application records
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

The Worker is built from `main`. The deployment command is `npm run deploy`.
Cloudflare automatically provisions the draft D1 and R2 bindings during the
first deployment, then the deployment script applies the versioned D1
migrations.

Production requires the following encrypted Worker secrets:

- `ADMIN_ACCESS_KEY`
- `ADMIN_SESSION_SECRET`
- `PAYSTACK_SECRET_KEY`

Paystack must remain in test mode until the business account, webhook, refund,
settlement and reconciliation checks have passed.
