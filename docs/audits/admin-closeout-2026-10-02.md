# Admin display and audit harness closeout — 2 October 2026

## Scope and source

This bounded follow-up closes the two residual display defects and ports reviewed
audit instrumentation. It is not a second full-system audit or a new acceptance
of real financial transactions. Baseline main is
`33c654f36a1e845f7eb8a920d3ebaabb72d7abab`, tree
`be0a1c5b2ebef333ddd7caec5dea955b3f2ab7e8`. The local materialization was checked
against the complete GitHub tree, including all 131 changed blobs from its older
checkout. Production still reports
`473bbf40afe1a77a722c8399f91c4dd95f3e40ce` as of 11:47 UTC.

## Changes

- Fees: widen the existing desktop field column from 210px to 280px so the native
  local date/time control has room for its day-period. Preserve the existing
  one-column narrow layout and native locale behavior.
- Orders: remove fixed icon-only dimensions from shared action buttons. Text
  labels size to their content without flex shrink or forced wrapping; existing
  colours, radii and action semantics remain intact.
- Add source and rendered regressions for full provider-label containment and
  date/time field geometry, with screenshots in each Operations browser engine.
- Port endpoint-only analytics exclusion and stable disclosure iteration from
  reviewed overlays. Natural Room-entry observer readiness is already on main
  and is not reapplied. Header scope is exact first-party `/api/analytics`; it
  must not reach third-party beacons. Keep all existing assertions.

Reviewed source receipts: analytics overlay at `f2ea9d5463`, executed in
[36938458090](https://github.com/bechirobob/tickets/actions/runs/36938458090);
disclosure overlay in
[36932094616](https://github.com/bechirobob/tickets/actions/runs/36932094616),
job `110603682308`. Hashes of executed overlay source were independently matched:
analytics `1d0cbaf4d5f9b2ef9d5c067602fb0a92b366dbc9e16072fd39dc34fdd0c4d44e`;
disclosures `61000ff0adc5d24181a657c6b85b9966b2b9e07ce350b9b9acdd493059cfbffd`.

## Verification and current limits

Locally on the changed application source:

- Production build and deployment preparation pass
- Repository tests: 87/87 pass, including five new harness contracts
- UI source contracts: 45/45 pass
- Rendered HTML checks: 4/4 pass
- Worker tests: 615/615 pass
- Final integrated typecheck passes
- Final integrated lint passes with the pre-existing moderation worker default-export warning
- Harness/iPhone evidence focused tests: 24/24 pass; mutation check rejects the old
  disclosure iterator
- Playwright desktop discovery: 239 tests across 36 files; discovery is not execution

Read-only cloud-browser smoke checks on current production: home → event details
→ RSVP open/close (focus returns to Request an RSVP), Host profile, signed-out My
Nights recovery entry, organiser public submission entry and organiser workspace
redirect to sign-in retaining `returnTo=/organizer/workspace`. No forms submitted,
no customer emails, payment/provider transactions or production data mutations.

Candidate browser rendering remains **not run**: the shell browser cannot create
its required socket in this executor, even with permitted escalation; the cloud
browser blocks localhost previews. Prepared Operations screenshots therefore do
not establish a visual pass yet.

GitHub Actions artifact quota was exhausted on 2 October. The required candidate
workflow packages and uploads its verified build before the three-engine matrix;
opening a PR automatically starts it. Preserve the feature branch without a PR
until the quota is usable, then run the unchanged exact-candidate gate. No upload
gate is skipped or made optional, no retention/deletion changes are included and
no merge or production deployment is claimed. Keep the current and rollback
runtime artifacts and protected backups.

## Next gate

1. Confirm artifact storage is usable, then open the candidate as a draft PR
2. Run the repository-required exact-source candidate matrix and operator/runtime
   gates; inspect Fees and Orders screenshots on desktop/mobile
3. Merge and release only after those gates pass; verify exact deployed revision
   and affected pages, preserving the previous release for rollback

A source patch, local tests and a live baseline smoke check are separate evidence
from browser validation and release of this candidate.
