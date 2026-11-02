> Historical read-only assessment of the existing fixture. The subsequently approved narrower implementation and successful cleanup are recorded in `dashboard-pass.md` and `evidence/authenticated/results.json`. The old script described below was not used.

# Read-only assessment of authenticated browser fixtures

No credential was generated and no fixture setup was executed for this assessment.

## Existing script and storage

`scripts/prepare-operations-browser-fixture.mjs` creates:

- One owner password (`Audit9!` plus 20 random bytes encoded as hex), a 16-byte salt and a PBKDF2-SHA256 proof (600,000 iterations). The local account stores `client-pbkdf2-sha256-v1` plus the SHA256 digest of that proof; the plain password is only in the fixture JSON.
- Two independent 32-byte base64url staff session tokens: owner and assigned organiser. SHA256 hashes are inserted directly into local `staff_sessions`, with one-hour expiration.
- One 32-byte base64url registration access token, hashed into a local RSVP grant, also expiring in one hour.
- Local fictional owner, organiser and removable gate accounts. The latter two have placeholder password hashes, not usable passwords; the organiser is reached through its seeded session.

The script writes `.wrangler/operations-fixture.sql` and `.wrangler/operations-fixture.json` with creation mode 0600, and uses only `wrangler d1 execute DB --local --persist-to .wrangler/state`. SQL contains hashes and fictional records; JSON contains the raw password/tokens. `.wrangler/` is gitignored. Explicit 0600 creation does not itself repair permissions on an already existing file. Local D1 persists under `.wrangler/state/v3`; the script does not automatically delete accounts or files after a run. The password/account has no automatic expiration. Seeded sessions/access grants expire in one hour. Real app login creates a normal twelve-hour staff session; expiry does not erase fixture files.

These credentials correspond only to rows in isolated local D1, not external accounts, providers, production staff, GitHub or Cloudflare. They do not grant external access unless someone improperly copied those rows/hashes into another database. That must never be done. No provider settings or secrets are needed for this fixture. The compiled worker is served on loopback HTTPS `127.0.0.1:8791`; its test configuration disables tail observers and supplies a fixed test-only login decoy secret. This is not a hosted preview or a phone-access solution.

## How existing browser tests sign in

`tests/e2e/operations.spec.ts` normally injects `bct_staff` using the fixture token before each case. Organiser cases inject the organiser token. These are seeded sessions that the normal `readAdminSession` database lookup validates (hash, active account, revocation and expiry); the app's authorization code is not disabled. However, this setup skips the login procedure for most cases and directly manufactures session records. It therefore falls under the current explicit instruction not to invent identity tokens.

The same suite also has `owner signs in through the real password flow and signs out`: it clears cookies, visits `/admin/login`, fills the local owner email/password, submits the real login form, reaches `/admin/operations`, and signs out. The application creates and validates that session normally. This demonstrates that authenticated integration testing can use normal app authentication rather than cookie injection if local test-account setup is authorized.

## Narrow next decision (not performed)

A suitable authorization would allow temporary fictional owner and organiser password accounts **only in a dedicated local test database**, normal browser password sign-in, and deletion of that dedicated database plus secret files after verification. It would not authorize provider credentials, production accounts, direct session/grant token seeding, incoming/outgoing invitations, external access or deployment. This would require a bounded local fixture variant because the existing script always generates sessions and the organiser lacks a usable password. No variant or credentials were generated during this inspection.

Keep passwords/cookies out of committed logs/screenshots, disable login traces that could capture secrets, inspect fixture bindings for outgoing network/queues before running, and use only fictional records. Reusing the existing script wholesale would require broader permission for its direct session and registration grant seeding; that is unnecessary for ordinary owner/organiser form sign-in.
