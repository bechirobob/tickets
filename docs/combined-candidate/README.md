# Combined source candidate — not release admission

Branch: `candidate/customer-dashboard-combined-20261102`.

Tested source merge: `97d433fe6964527009762381e9e05783173e6a31`.
Tested source tree: `ed3798342025f67403dbdb7f56cdc43c089c5d84`.
The later evidence commit adds only this documentation/evidence directory;
application, dependencies and operational source remain exactly this tested tree.

## Exact provenance

Merge parents, in order:
1. Dashboard acceptance head `9074277fbaa486ed905894605c7a858d3c2a3b81`.
2. Customer increment `01ca0fec952de1766d9ac42fb222a0c16f34d247`.

Shared base: `4bb0532f4b14450451fa7bbe0bab49e436aa8354`.
The merge preserves both histories without cherry-pick rewriting or conflict
resolution. Dashboard delta is 9 files; customer delta is 55 files including
6 application files, 7 preview tools and 42 documentation/evidence files.
Zero overlapping paths. Every changed blob was verified identical to its source
parent. See `evidence/provenance.json`.

No production source was rewritten during combination. The established checkout,
RSVP, Yorke, ownership, payment, cancellation, Room and Flashes rules remain.
No modifications to workflows, operations, release admission controls or their
inventories, dependency locks, backend, or BoardUI components. Main and both input
branches remain unchanged.

## Combined validation

- Locked install succeeded.
- Full `npm test` passed: tooling 75, repository 288, UI 308, password client 11,
  rendered production HTML 5, Worker 1,145 across 90 files — 1,832 tests total.
  This includes a fresh production build and local preparation, not deployment.
- Lint passed: zero errors, five existing warnings. Typecheck passed.
- Root and mobile dependency audits: zero vulnerabilities each.
- Compiled unauthenticated guards: 21 protected pages/APIs passed, using a local
  runtime with no production bindings or identities.
- Customer component browser checks passed at 1440×1000, 390×844 and 320×740:
  discovery filters/recovery, checkout field feedback and interrupted attempts,
  RSVP draft/focus/error handling, My Nights loading/error/empty/retry and history,
  menu and notification focus. All API traffic fictional; external requests blocked.

- Dashboard component browser checks passed at the same three widths: team
  accounts, support drafts, submissions, host applications, promoters, security
  and event promotions; zero writes and page errors. Scoped accessibility and
  overflow checks passed.

The first two dashboard browser attempts failed before React mounted. Diagnosis:
504 `Outdated Optimize Dep` for React Aria/WebAuthn caused by two local Vite
harnesses sharing their dependency cache. Logs are preserved. Final rerun uses a
separate dashboard dependency cache and port. Only temporary local adapters
changed output directories, ports/cache and initial readiness waiting; application
and committed preview sources did not change. Exact adapter diffs/hashes are in
`evidence/local-test-adapters.*`.

## Boundaries and remaining gates

**The original PR #392 screenshot release blocker is still unresolved.** Passing
combined audits, source integration or synthetic screenshots does not resolve
that blocker, amend release admission, or show that PR #392 was deployed.

Dashboard authenticated acceptance evidence is retained exactly from its parent,
not claimed as a fresh combined authenticated run. Its recorded application source
is `4bb0532f4b14450451fa7bbe0bab49e436aa8354`. The helper was inspected but not rerun:
it creates temporary credentials, excluded by the customer workstream limits.
Fresh combined authenticated acceptance therefore remains unrun.

Browser checks are real Chromium with simulated mobile viewports, not physical
iPhone/Safari/WebKit. Customer browser checks use API mocks, not browser-to-database
booking, provider payment or email delivery. Full live/production E2E and physical
device checks remain unrun. No real purchases, RSVPs, invitation responses,
communications, credentials or production data were created/accessed.

No new screenshot upload or blocked GitHub HTTP request was attempted. Previous
Library failure and lack of an externally accessible live preview remain.
The screenshots here are local synthetic verification evidence, not the missing
PR #392 release screenshot evidence.

Only this isolated branch is to be published. Candidate/current-main workflow
push selectors were inspected and none match it; production workflows require
main or other exact branches. No PR, dispatch, merge to main, release-admission
change or deployment is part of this task. See `evidence/trigger-review.json`.
