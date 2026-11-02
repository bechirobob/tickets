# Customer journey preview

Isolated branch: `feat/customer-journeys-preview-20261101`.
Exact starting commit: `4bb0532f4b14450451fa7bbe0bab49e436aa8354`.
The base was fetched by exact object ID and inspected before creating a separate
worktree. It includes the prior dashboard integration and dependency correction as
source. This is not evidence that PR #392 was deployed.

## Changes

- Discovery keeps applied date, area, music and search refinements visible in a
  compact text row. Clear filters restores upcoming events and keyboard focus;
  the empty result action explains what it will show.
- Checkout marks the field needing attention and associates it with the error.
  Name/email/phone errors also appear beside their inputs, above the mobile fold
  when the corresponding field receives focus. Stable accessible labels remain
  separate from error descriptions. Email input disables autocapitalisation and
  spellchecking. Validation conditions, payloads, pricing, fees, providers,
  idempotency, consent and payment handling are unchanged.
- RSVP opening moves focus to the name field; closing restores the trigger.
  Submission failures are alerts. Existing draft retention and duplicate guards
  remain intact. Email input uses the appropriate mobile settings.
- My Nights changing tabs clears an unrelated search and creates a history entry,
  so Back/Forward restores the selected view. Existing pass and Room links remain.

No global theme, font, imagery, icons, dependencies, backend or operational
configuration was changed. No changes to Room or Flashes source, release admission
controls or inventories. No live data, purchases, RSVPs, invitation responses,
messages, emails, credentials, merges or deployments were used.

## Journey review and deliberate scope

Read root AGENTS.md; no additional repository or workspace `.agents/skills` were
present. Reviewed discovery state, actual checkout, registration, My Nights,
header/menu and notification implementations, and the Yorke signup/token routes.
Yorke in this base is a year-end early-access signup with welcome communication
and withdrawal, explicitly not an RSVP or ticket. Its existing consent,
withdrawal and communication flow is preserved; no invented invitation-response
booking flow was added. The existing My Nights design already prioritises passes
and Room access. Menus and notifications were tested rather than redesigned.

Reviewed the vendored official BoardUI Input implementation, MIT licence and
provenance (`ec5c5eb3e29c2441be63b9422cd54f411ef23466`). Native controls already
satisfy this pass without moving the dashboard React Aria/styling adapter into
public journeys. No new BoardUI source was integrated or claimed in this pass;
the base's existing integration and provenance are unchanged.

## Verification

- Locked install succeeded using a writable temporary npm cache. Initial install
  failed because the default home cache was not writable; no dependency changed.
- Repository: 288 passed. UI: 308 passed. Tooling: 75 passed.
- Password client: 11 passed. Worker: 90 files / 1,145 tests passed, including
  existing Yorke, payment/registration, Room and Flashes coverage.
- Production build and local preparation passed; rendered HTML: 5 passed.
- Typecheck passed. Lint: zero errors, five existing warnings in untouched files.
- Root and mobile npm audits: zero vulnerabilities each.
- Real Chromium 154 component tests passed at 1440×1000, 390×844 and 320×740.
  Discovery search/date/clear/empty/pagination; checkout validation focus and
  descriptions; pending/interrupted synthetic payment submissions and retained
  idempotency key; unchecked optional consent; RSVP focus, errors and retained
  draft; My Nights loading/error/retry/empty, pass/Room URLs, tab search reset,
  Back/Forward; menu keyboard opening/Escape and notification dialog restoration.
  All captured screens checked for horizontal overflow. Targeted axe scans of
  the new filter summary and checkout delivery fields reported no violations.
- Inspected desktop checkout, mobile checkout, discovery, My Nights, RSVP error
  and narrow discovery screenshots. Synthetic ticket price GH₵100 + fee GH₵5
  remains GH₵105 in the inspected checkout.

Earlier verification failures were fixed: checkout copy restored to its existing
contract; preview router uses a separate navigation event rather than fabricating
popstate; the menu check scrolls its anchor into view; validation label text stays
stable while the associated error appears. Screenshots caught and corrected dark
filter text and feedback too far from the mobile field.

### Boundaries

Browser tests mount real source client components with local Next adapters and
intercept all API requests with fictional responses; external requests are
blocked. They do not establish browser-to-database integration, real payment
success, QR issuance/scanning, email delivery, production auth, physical iPhone
or Safari/WebKit behaviour. Existing Worker/repository tests provide separate
regression evidence, not a claim those journeys were manually exercised end to
end. Full production-targeting E2E suite and live transactions deliberately unrun.
Room/Flashes visual rendering was not newly captured; their source was unchanged
and their existing regression suites passed. No real invitation was submitted.

## Evidence and access

`evidence/` contains 24 actual screenshots, browser results, build/type/lint/test
logs, both audits, trigger review and source hashes. Screenshots use fictional
fixtures and existing public poster art, not production customer records.

Local-only harness: `node scripts/customer-preview/serve.mjs`, then
`node scripts/customer-preview/check.mjs` (uses installed `/usr/bin/chromium`).
The server binds 127.0.0.1:8796 and rejects API requests; the test supplies synthetic
responses. This loopback address is NOT a user-accessible hosted preview.
No permitted external hosting mechanism was established, and none was created.

The supported Library prepared-upload helper was invoked once for six inspected
screenshots. It failed before upload with `hosted apps tools/list request failed:
network`. No Library IDs were returned; there is no confirmed Library upload.
No alternative transfer route or browser download was attempted.

Branch push only after inspection of candidate and current main workflow
triggers (recorded in `evidence/trigger-review.json`): none match this branch;
production push workflows require main or other exact branch names. No PR,
workflow dispatch, merge or deployment was requested by this increment.

Outstanding review: assess this focused source-only pass and its screenshots.
Physical iPhone/Safari and an authorised hosted preview remain separate validation.
