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

- Final local `npm run typecheck`, `npm run lint` and `npm test` passed. The aggregate rebuilt production assets and passed 49 tooling, 185 repository, 68 UI/static-render, 2 password-client, 5 rendered-asset and 890 Worker assertions. Lint reports one pre-existing warning in `ops/moderation/worker.ts`.
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

The focused browser cases capture the directory, profile, full event and event-story/host section at 1280px desktop and 390px mobile CSS widths, plus 320px phone profile and event-host evidence. Only ten specifically named PNGs plus a source SHA/tree, dimensions and SHA-256 manifest are uploaded as `host-brand-previews-<candidate SHA>`, with three-day retention. The artifact explicitly identifies migration-seeded candidate pages rather than live production. Packaging regression tests verify the allowlist, hashes and source/dimension rejection. Actual hosted rendering and user visual approval remain required before publishing to the live service.

## Approved seal expansion and display-name refinement

The user approved the portrait seal and requested it wherever Kofi appears as a host. One `HostPortrait` component now owns the original portrait plus logo seal on all existing public host portrait surfaces: profile, host directory, and every event/co-host credit. Directory data now projects the existing brand logo field. The profile uses Kofi Bills as the sole heading identity; `full_name` remains stored and the biography mentioning Henry Yorke is unchanged.

A read-only inventory found no other existing public host portrait rendering. Room messages and announcements use staff/attendee identities without a host ID; no Kofi association is inferred. Text-only host email attribution and social-preview metadata remain outside the visible portrait treatment.

The 320px screenshot showed an empty lazy-loaded portrait column. Code inspection found no width-specific hiding rule, but that test captured immediately without scrolling the image into view or waiting for decode. The screenshot helper now explicitly scrolls each actual host portrait into view and verifies natural dimensions and decode completion before capture. This addresses the observed evidence gap; the hosted recapture remains the proof of the final 320px result.

## Event host compactness refinement

The user's supplied screenshot showed excess space specifically inside the event host credit. Profile and directory composition, content, type sizes, portrait dimensions and approved logo seal are unchanged. Branded event credits now use 12px outer padding instead of 26px, a 2px brand/name gap instead of 4px, a 2px name/metadata gap instead of 6px, and no extra link margin instead of 12px. The 25px heading keeps its font size with tighter 1.15 leading rather than inherited 1.5. View Host retains its 44px minimum target; block-level flex prevents an extra inline line-box gap.

Hosted evidence records host-block height, individual box gaps, padding, type sizes, portrait/seal dimensions and link height at 1280px, 390px and 320px. The before measurement is explicitly a controlled comparison of the same candidate DOM under the exact prior spacing declarations from 7013070856ed3dc9cfb81693b5c70df19005c0e9; it is not a claim of rebuilding the old release. Candidate screenshots are captured before comparison; the temporary baseline style is removed before candidate geometry measurement. Packaging rejects mismatched source, reduced type sizes or targets below 44px. Actual numbers require the hosted run; CSS declarations alone are not claimed as rendered measurements.

The hosted comparison initially failed because an inline test stylesheet was correctly blocked by the production CSP. The helper now serves its temporary baseline through a same-origin, test-intercepted CSS URL without changing CSP. Candidate screenshots are captured first; missing comparison records are explicitly marked unavailable and the UI test outcome is recorded in the artifact manifest, so visual review does not imply that failed geometry checks passed.


## Event credit alignment and navigation button

The latest event-only refinement aligns the portrait top with the brand eyebrow by removing its top offset. View Host remains a navigation anchor, now presented as a compact event-ink/paper button with a 6px radius, 8px metadata gap, 44px minimum target and explicit hover/keyboard-focus states. A coordinated proportion pass gives the event portrait 80px width while keeping its 28px seal, 16px column gap and 16px outer padding; brand/name, name/metadata and metadata/button gaps are 2px, 4px and 8px. Browser checks cover top/left alignment, button dimensions and accessibility at 320px, 390px and 1280px. Profile, directory, source artwork, data and production CSP are unchanged.

The spacing comparison uses the current candidate portrait proportions under prior spacing declarations. It compares spacing on one DOM, not full previous-release geometry; actual rendered height is reported without imposing the prior 139.75px candidate height.


The ordinary Candidate WebKit suite later failed loading the test-intercepted historical stylesheet. The underlying resource-load cause is unproven. Current layout measurements and assertions now run unconditionally in every browser, including exact gaps, padding, type sizes, portrait/seal widths and minimum target height. Historical comparison is additional evidence only when BECORE_ISOLATED_PREVIEW is explicitly true; it still fails the requested test if unavailable. Production CSP and runtime are unchanged.
