# Tickets × BoardUI: isolated workspace trial

This branch is a review candidate, not a release. Do not merge or deploy it as an adoption decision. Main, scanner/dependency PR #392 and recovery-maintenance PR #393 are unchanged.

## What to review

The `/boardui-trial` work area uses 2,400 fictional guests for one fictional Accra event. It groups search, arrival filter and name sorting above a compact, paginated guest list. Adding and editing happen in a contextual dialog; editing preserves the current filter and page. Cancel/Escape discard changes. Saving provides live feedback. Reload resets all edits. There are no payments, emails, persistence, customer records or live integrations.

The Tickets logo, native font stack, Lucide icons, restrained surfaces and concise language remain. This is a new work-area arrangement, not a reskin of a production screen. The original list remains available; the connected workspace extension below demonstrates event navigation and contextual workflows.

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
- ESLint: zero errors; two warnings. One inherited `import/no-anonymous-default-export` warning in `ops/moderation/worker.ts`; one `@next/next/no-css-tags` warning on the deliberate external CSP adapter link in the shared trial layout. Neither warning is suppressed.
- Existing tests: 288 repository, 308 UI, 72 tooling, 11 password-client and 5 rendered-build tests passed (684 total). The rendered tests use the existing local build-preparation step with deployment credential variables explicitly removed. No deployment runs.
- Chromium 154.0.8037.57: desktop 1440×1050, mobile simulation 390×844, narrow simulation 320×740. Search, empty state, filter, sort, first/last-page boundaries, page reset after query changes, edit without losing filter/page, keyboard-only form entry, validation, dialog focus wrapping, Escape/cancel, focus restoration, repeated opens/submits, long names and reload reset passed.
- Axe scans: zero violations in tested list and dialog states. This does not replace assistive-technology testing.
- Final tested pages: no uncaught page errors or security-policy violations. Screenshots visually inspected on desktop, mobile and narrow layouts.
- Follow-up dismissal/touch checks: `node scripts/boardui-trial/dismissal-touch-check.mjs` passed 18 flow groups across desktop mouse and Chromium touch emulation at 390×844 and 320×740. Each explicit Cancel/Close control discarded dirty name, email and arrival edits, restored all original values on reopen, preserved query/filter/sort/page/rows, and restored trigger focus across three repeated edit cycles per control. New-guest cancellation/closing created no records and reopened empty. The backdrop deliberately does not dismiss this native dialog; clicking/tapping outside retained the unfinished draft until explicit Cancel. Pointer-driven add, checkbox, edit/save and next/previous navigation also passed. Recorded pointer events were exclusively `mouse` in the desktop scenario and `touch` in both emulated mobile scenarios. No application changes were required.
- Touch-test limits: text was entered using Playwright `fill` and select values through `selectOption`; taps exercised actual pointer activation of list/dialog controls. This does not test an OS virtual keyboard, keyboard occlusion, native select-picker gestures, real touch hardware, Safari or iPhone. The new test script passes focused ESLint with no warnings. Three additional dismissal screenshots were visually inspected; structured outcomes are in `evidence/dismissal-touch-results.json`.
- Full Worker test suite, real iPhone/Safari, WebKit and screen readers were not tested. Playwright browser installation failed with HTTP 403 `Domain forbidden` from the official CDN; the already-installed Chromium was used instead. The environment's system browser is not the repository's pinned release-test image.

## Bundle comparison

Same clean base and environment, emitted `dist/client` JavaScript and CSS; gzip calculated per file with deterministic mtime. These are whole-build totals, not route-level network cost or field performance.

| Output | Baseline bytes / gzip | Trial bytes / gzip | Gzip change |
| --- | ---: | ---: | ---: |
| JavaScript | 1,431,505 / 448,978 | 1,671,471 / 519,197 | +70,219 |
| CSS | 667,679 / 128,504 | 678,310 / 131,082 | +2,578 |
| Total | 2,099,184 / 577,482 | 2,349,781 / 650,279 | +72,797 |

No speed or Core Web Vitals improvement is claimed. Device profiling and route-specific loading measurements remain needed before adoption.

## Audit and recommendation

Final `npm audit` ran without omissions or exceptions: both clean baseline and trial have **21 moderate, zero high, zero critical** findings. The underlying advisories concern glob cancellation and minimatch amplification and their inherited dependency paths. No existing package versions were changed to conceal them. Raw baseline and trial audits are retained. An intermediate npm-normalized lockfile yielded 19; restoring unrelated original lock metadata made the comparison equivalent and both final results 21. Release/admission inventories were not edited.

This is a useful, concrete design trial: the selected components work with Tickets' stack and allow its identity to survive. It does not yet justify project-wide adoption. Review the workflow and screenshots first; then resolve the inherited audit findings and verify Safari/device performance, screen-reader use, and the CSP adapter before any wider integration.

## Connected workspace extension

See [the source-grounded scope inventory](WORKSPACE-SCOPE.md) for implemented versus proposed areas across the owner and organiser workspace. `/boardui-trial/workspace` connects role examples, events, local venue/line-up editing, paid/RSVP guest records and read-only team invitation states. `/boardui-trial/yorke-way` adds an owner audience example and separate non-submitting recipient consent reference. All production routes and business operations remain unchanged.

The extension passed the actual Vinext build, types, lint (same two warnings), 288 repository tests, 308 UI tests and five rendered-build tests. Original list browser checks and all 18 dismissal/touch groups passed again after the shared layout change. The connected journey passed at 1440×1050, 390×844 and 320×740, including desktop/mocked touch activation, scoped event examples, form errors/discard/save, paid versus RSVP details, filtering/paging, focus restoration, long consent details, unchecked consent, repeated non-submitting signup completion and reset. Axe scans found zero violations in tested states; no uncaught page errors or mutation requests were observed. This remains Chromium emulation, not real Safari/iPhone, OS keyboard or live authorization testing. Evidence and visually reviewed screenshots are under `evidence/workspace/`.

Whole-build extension totals: JS 1,700,411 bytes / 530,175 gzip; CSS 685,502 bytes / 132,853 gzip. Combined gzip is 663,028 bytes versus the same clean baseline 577,482: **+85,546 bytes**. This replaces the earlier trial size for the extended build; the earlier table remains historical. No runtime performance claim. No new dependencies were added for this extension. Audit rerun still reports 21 moderate, zero high/critical findings; it exits nonzero and is not waived.

The source and evidence are published in draft PR #394. Screenshot links on the private GitHub repository are available to its authorised viewers. No externally accessible interactive preview URL is verified. Library delivery remains technically blocked: owner approval was received, but the latest permitted same-helper retry failed before upload/session creation at `hosted apps tools/list request failed: network`. No Library IDs exist; no transfer is claimed. This is a connection failure, not a pending owner-approval request.
