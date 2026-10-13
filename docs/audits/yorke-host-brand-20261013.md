# The Yorke Way host identity

## Scope and display contract

- Base: `c2058fb39bb6d9a93ef622aad08b1e9e2d22488f`.
- Keep Kofi Bills / Henry Yorke as the person: original portrait, verified state, biography and social links stay unchanged.
- Revised after visual review: titlecase “The Yorke Way” above the personal name, 14px / 20px desktop and 13px / 18px mobile, weight 600 and a 6px name gap. Verification sits with location. Original logo becomes a lower-right portrait seal, 52px desktop / 36px mobile, with a 3px background ring and 8px / 6px offset. No standalone brand row, card, shadow or glow.
- Event host credits mirror the brand-above-name hierarchy, with verification/location metadata below. Portraits align with names and links retain 44px hit areas. Keep the brand in the host directory. Preserve flyers, event copy, Club House Inc credit, booking behavior and financial data.
- Derive event presentation only from actual `event_hosts` relationships, including secondary hosts. Do not infer ownership from names or event copy.

## Implementation

`0067_host_brand_identity.sql` adds nullable `brand_name` and `brand_logo_url` columns. Its data update requires both `id = 'host:kofi-bills'` and `slug = 'kofi-bills'`. The migration makes no event, account, permission or financial edits. Apply the migration before deploying code that selects these columns. Existing code tolerates the additional nullable columns on rollback; no destructive down migration is needed.

The logo SVG uses the source JPEG unchanged: 127004 bytes; SHA-256 `0c59d6b196a9a81753d05dd3ebfa03ea2810bccc457533741c0c6e9e3a598216`. Its viewport is `199 420 771 771`; its mask is the original circle centered at `(584.5, 805.5)` with radius `385.5`. This preserves geometry and excludes the screenshot backdrop without redrawing or raster editing.

The public catalogue retains its legacy `host` projection and adds an optional `hosts` list. Both use an explicit display-field allowlist. The shared cache parser accepts legacy responses without the new fields and validates image destinations using its existing HTTPS rules. Native builds and native deployment are outside this change.

## Verification

- Final local `npm run typecheck`, `npm run lint` and `npm test` passed. The aggregate rebuilt production assets and passed 49 tooling, 185 repository, 64 UI/static-render, 2 password-client, 5 rendered-asset and 890 Worker assertions. Lint reports one pre-existing warning in `ops/moderation/worker.ts`.
- The Worker runner returned success for all 81 files; logs also contain intentional failure-path output and a teardown RPC warning. These are not responsive browser evidence.
- Additional focused VPS tests passed 7/7; shared mobile parser regressions passed 7/7 (plus its existing 4/4 suite). Browser test discovery lists nine desktop/mobile cases (the narrow phone case skips the desktop context); those cases were not executed locally.
- Migration tests compare all pre-existing tables and original host fields, test exact-identity guards and missing target behavior, and pin source-image byte fidelity.
- Worker/VPS tests cover current and future links, primary/secondary hosts, missing relations, unbranded hosts, minimal API projection and unchanged event data.
- Static rendering tests cover the actual EventScreen with branded and unbranded hosts; these do not establish responsive visual quality.
- `tests/e2e/host-brand-identity.spec.ts` covers profile identity, logo loading/size, event credit, portrait/flyer preservation, profile navigation, accessibility and horizontal overflow for the configured desktop/mobile browser projects.

## Unverified and release requirements

No responsive screenshot evidence was produced in the local cloud executor: Chromium failed at launch with socket access denied, including escalation. No fixture was labeled as live. The browser cases must run in a supported hosted browser environment before treating visual verification as passed.

No release-control files were changed and no publish, merge, live migration or deployment was performed. The existing reviewed release path must separately authorize/accept the additive host schema and data change; this patch does not bypass that boundary.

## Hosted visual approval preparation

The existing Booking consent previews workflow now captures the exact candidate immediately after local migration seeding, before consent-specific fixtures alter event data. Its existing build is reused; all original checks, triggers and read-only permissions remain unchanged. No deployment, secrets or native-app pipeline is introduced.

The focused browser cases capture the profile, full event and event-story/host section at 1280px desktop and 390px mobile CSS widths, plus 320px phone profile and event-host evidence. Only eight specifically named PNGs plus a source SHA/tree, dimensions and SHA-256 manifest are uploaded as `host-brand-previews-<candidate SHA>`, with three-day retention. The artifact explicitly identifies migration-seeded candidate pages rather than live production. Packaging regression tests verify the allowlist, hashes and source/dimension rejection. Actual hosted rendering and user visual approval remain required before publishing to the live service.
