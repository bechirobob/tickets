# Tickets VPS maintenance fallback

Requested 22 September 2026: show a branded outage page instead of Cloudflare's
Workers quota message, using the existing Hermes VPS. No hosting plan upgrade.

## Implementation

- Static, self-contained page: https://tickets-status.becoreops.com/ on Hermes
  (`51.195.20.137`). Caddy returns HTTP 503, Retry-After, no-store and noindex.
- Production DNS, Worker custom domain, app code and database are unchanged.
- A disabled Cloudflare Single Redirect targets only HTML GET/HEAD page visits
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

## Verified evidence

- Tickets source branch: `feat/vps-maintenance-fallback`.
- Six isolated monitor tests pass: quota classification, verified recovery,
  three consecutive healthy probes, unhealthy fallback, one-rule-only mutation,
  and refusal to overwrite an externally changed rule.
- Cloudflare preparation passed in run `35722619237`; DNS resolves to Hermes and
  the managed redirect was verified disabled. No production traffic switched.
- VPS installation and public smoke checks passed in Bubble Wash run
  `35722989031`, using Tickets source
  `11e601c5554fe3f6a9eb08ad80cd75644f7ddd42`.
- Page SHA-256:
  `278c9fa029b630e9a273f559c77c35fa1f65dc630c166078303d6062e6461a30`.
- Live browser inspected the actual branded page. HTTP checks verified HTML 503,
  no-store, health marker, and JSON 503 for POST to an API path.
- Existing Caddy site contents were preserved, Caddy validation passed, and the
  existing Bubble Wash response remained HTTP 403 before/after installation.
  This is preservation evidence, not a claim that Bubble Wash is healthy.

Initial preparation failed because the existing API secret contained surrounding
whitespace; normalization fixed it. The initial public check ran before DNS was
ready. A later check incorrectly assumed the unrelated site's baseline was 200;
it now compares the observed response before and after installation. Final
checks passed after those specific corrections.

## Remaining connection and exact next action

**Automatic switching is not active.** The redirect remains disabled and the
systemd timer has not been enabled. The VPS connection is available to the
`bechirobob/bubble-wash` workflow; its Cloudflare fallback credential is missing.
The existing Cloudflare token is in `bechirobob/tickets`, and GitHub does not expose
its stored value for copying into another repository.

1. Store `TICKETS_FALLBACK_CLOUDFLARE_TOKEN` in the Bubble Wash repository's Actions
   secrets. Scope it to `becoreops.com` with Zone > Single Redirect > Edit.
   Do not paste the value into chat, source, logs or artifacts.
2. Rerun **Install Tickets fallback page** on `ops/inspect-tickets-fallback`.
   Its activation step sends the credential through Tailscale SSH stdin to a
   root-owned 0600 environment file, validates the exact rule and healthy page,
   starts the timer, and performs the first check.
3. Verify the production hostname redirects during a confirmed quota block,
   while `/api/version` is not redirected. Verify it stops redirecting after
   three valid app probes. Runtime failover and recovery remain unverified until
   activation. A passing static-page check is not evidence of automatic failover.

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
