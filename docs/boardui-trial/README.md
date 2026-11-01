# Tickets × BoardUI: isolated guest-list trial

This branch is a review candidate, not a release. Do not merge or deploy it as an adoption decision. Main, scanner/dependency PR #392 and recovery-maintenance PR #393 are unchanged.

## What to review

The `/boardui-trial` work area uses 2,400 fictional guests for one fictional Accra event. It groups search, arrival filter and name sorting above a compact, paginated guest list. Adding and editing happen in a contextual dialog; editing preserves the current filter and page. Cancel/Escape discard changes. Saving provides live feedback. Reload resets all edits. There are no payments, emails, persistence, customer records or live integrations.

The Tickets logo, native font stack, Lucide icons, restrained surfaces and concise language remain. This is a new work-area arrangement, not a reskin of a production screen. It is deliberately not a full navigation redesign: the event context is a label, not a fake link, and no unrelated workflows have been added.

## Genuine free source

- Official BoardUI repository: https://github.com/BoardUI/boardui
- Pinned source commit: `ec5c5eb3e29c2441be63b9422cd54f411ef23466`.
- Imported components: Button, Input with Label/HintText, Table, Pagination; plus their class-merging and directional-icon helpers.
- `components/boardui/LICENSE` retains the MIT notice, including copyright (c) 2026 Mertcan Dundar Esmergul (BoardUI).
- `components/boardui/PROVENANCE.json` records original paths, SHA-256 hashes and adaptations.
- New direct dependencies only: `react-aria-components@1.17.0` and `tailwind-merge@3.6.0`; 11 new transitive/package entries in total. Existing package versions are unchanged. No starter, AI SDK, paid source, Pro keys, second icon library, or React/Next downgrade.
- Native HTML dialog, select and checkbox are composed with these components; they are not represented as BoardUI components.

Adaptations: imports are namespaced; Remix icons become existing Lucide icons; the starter's template-localization hook is removed while labels remain explicit; the compact pager displays first/current/last with 44px targets. Tickets-scoped CSS supplies the visual adapter rather than importing BoardUI global styles. No existing global stylesheet is replaced.

React Aria 3.48.0 tries to inject a touch-action style, which Tickets' `style-src 'self'` correctly blocks. The trial supplies the same rule in an external stylesheet with React Aria's existing stylesheet ID. This prevents duplicate injection without changing CSP. It is a version-specific integration detail that must be rechecked on upgrades; final browser checks assert no security-policy violations.

## Reproduce locally

Base: `63f2ead2fb3eaae03696f408b12e9e18cfcee265` (verified against origin/main). The local checkout was clean before this branch. Neither unmerged dependency/recovery branch was used as the base.

```sh
npm ci
npm run build
node scripts/boardui-trial/serve.mjs
# In a second terminal, with Chromium installed:
node scripts/boardui-trial/browser-check.mjs
```

`BOARDUI_CHROMIUM` can specify a Chromium executable instead of `/usr/bin/chromium`. The local server binds only to 127.0.0.1:8788. It serves the actual Vinext build with no production bindings, remote resources, schedules, queues or credentials. Browser tests block external hosts and stub optional root-shell API requests; those root-shell endpoints are not validated by this trial.

The loopback route was verified, but it is not a user-accessible hosted preview. This environment has no verified authorised external preview URL, and this task forbids deployment/access changes. Screenshots and the source/evidence package are the review deliverables. No ChatGPT-gated site is presented as independent access.

## Verification

- Actual Vinext build: passed on baseline and trial; React 19.2.8, Next 16.4.1, Tailwind 4.2.1, Vinext 1.0.0-beta.9 retained.
- TypeScript: passed.
- ESLint: zero errors; two warnings. One inherited `import/no-anonymous-default-export` warning in `ops/moderation/worker.ts`; one `@next/next/no-css-tags` warning on the deliberate external CSP adapter link in the trial page. Neither warning is suppressed.
- Existing tests: 288 repository, 308 UI, 72 tooling, 11 password-client and 5 rendered-build tests passed (684 total). The rendered tests use the existing local build-preparation step with deployment credential variables explicitly removed. No deployment runs.
- Chromium 154.0.8037.57: desktop 1440×1050, mobile simulation 390×844, narrow simulation 320×740. Search, empty state, filter, sort, first/last-page boundaries, page reset after query changes, edit without losing filter/page, keyboard-only form entry, validation, dialog focus wrapping, Escape/cancel, focus restoration, repeated opens/submits, long names and reload reset passed.
- Axe scans: zero violations in tested list and dialog states. This does not replace assistive-technology testing.
- Final tested pages: no uncaught page errors or security-policy violations. Screenshots visually inspected on desktop, mobile and narrow layouts.
- Full Worker test suite, real iPhone/Safari, WebKit and screen readers were not tested. Playwright browser installation failed with HTTP 403 `Domain forbidden` from the official CDN; the already-installed Chromium was used instead. The environment's system browser is not the repository's pinned release-test image.

## Bundle comparison

Same clean base and environment, emitted `dist/client` JavaScript and CSS; gzip calculated per file with deterministic mtime. These are whole-build totals, not route-level network cost or field performance.

| Output | Baseline bytes / gzip | Trial bytes / gzip | Gzip change |
| --- | ---: | ---: | ---: |
| JavaScript | 1,431,505 / 448,978 | 1,671,471 / 519,223 | +70,245 |
| CSS | 667,679 / 128,504 | 678,193 / 131,065 | +2,561 |
| Total | 2,099,184 / 577,482 | 2,349,664 / 650,288 | +72,806 |

No speed or Core Web Vitals improvement is claimed. Device profiling and route-specific loading measurements remain needed before adoption.

## Audit and recommendation

Final `npm audit` ran without omissions or exceptions: both clean baseline and trial have **21 moderate, zero high, zero critical** findings. The underlying advisories concern glob cancellation and minimatch amplification and their inherited dependency paths. No existing package versions were changed to conceal them. Raw baseline and trial audits are retained. An intermediate npm-normalized lockfile yielded 19; restoring unrelated original lock metadata made the comparison equivalent and both final results 21. Release/admission inventories were not edited.

This is a useful, concrete design trial: the selected components work with Tickets' stack and allow its identity to survive. It does not yet justify project-wide adoption. Review the workflow and screenshots first; then resolve the inherited audit findings and verify Safari/device performance, screen-reader use, and the CSP adapter before any wider integration.

The source and verification evidence are in this branch and the accompanying Library package. The final delivery records the confirmed Library IDs separately; local paths are not treated as delivered attachments.
