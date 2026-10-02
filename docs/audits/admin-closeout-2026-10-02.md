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

GitHub Actions artifact quota was exhausted on 2 October. The initial admin-only
branch preserved the patch without starting the artifact-dependent matrix. The
owner subsequently approved private runtime Release publication and its scoped
repository-content write permission. The combined candidate replaces inter-job
artifact transfer; it does not claim the old quota has recovered.

## Storage remediation added to this candidate

- Candidate verification builds once, keeps an immutable local tarball, restores
  and hashes those exact bytes before each of the three browser projects, and
  resets only disposable hosted-runner fixture state. Every existing core and
  browser command remains required. The one job has a 120-minute bound because
  it now runs the formerly parallel browser suites sequentially.
- Selected synthetic Fees/Orders and natural Room PNG/JSON evidence is encoded
  in bounded, SHA-256-checked job-log records. Missing or invalid required images
  fail the gate. Decode the exact successful run attempt's complete verify-job
  log with `ops/vps/candidate_evidence.py`; inspect the actual decoded pixels.
  These selected records are not a replacement for all historical trace files.
- A verified main-push runtime publishes its archive, checksum and canonical
  source/tree/run/attempt manifest as a private GitHub Release. Only that one
  build/publish job gets `contents: write`; other jobs remain read-only.
- The download path checks private repository identity, source and tag, exact
  completed run/attempt/jobs, publisher-step success, release/asset identities,
  API and local byte digests, and a single canonical receipt from the completed
  publisher's immutable log. Mutable release metadata alone is insufficient.
- The host operator rechecks source/run/attempt bindings immediately before the
  transaction. Existing lock, health checks, staged upload verification and
  private rollback snapshots are unchanged. There is no paid provider, new
  credential, repository visibility change or old-artifact deletion.
- The encrypted backup destination and 35-day off-host retention are unchanged.
  Protected runtime/rollback artifacts remain. Existing storage may therefore
  remain above GitHub's allowance until previously configured expiry; successful
  backup upload must be independently verified before calling recovery complete.

## Verification and next gate

The combined storage-only changes pass local lint/type checking and the current
197 Python transport/evidence/operator/rollback tests. The application source
checks above remain applicable to the preserved admin patch. Independent review
is checking the final exact pins and failure paths before publication.

Pending, not yet claimed:

1. Publish the combined branch and draft PR; run the storage-free exact-candidate
   core/browser gate and inspect decoded Fees/Orders screenshots on all engines
2. Distinguish genuine test failures from unrelated quota-only evidence uploads
   in other existing workflows; do not weaken the runtime/candidate gate
3. Merge only the verified candidate, confirm exact-main runtime publication,
   then use the reviewed operator to release and verify the deployed revision
4. Preserve current and previous production releases and protected backups;
   verify off-host backup recovery separately

A source patch and passing local tests remain separate evidence from hosted
browser execution, actual screenshot inspection and a verified production release.

## Runtime publication integration correction — 2 October 2026

PR #221 merged the tested tree as `7bb6f515f19f3ef6b1f3a01144a4ca04339d3244`.
Candidate run `37031564336` passed all required stages; targeted Fees/Orders pixels
were independently reviewed for all three engines. One pre-existing mobile
Chromium Room geometry assertion passed its configured automatic retry; the
separately required no-retry regression stages passed. The corrected mobile
Room exports fit the unchanged 2 MiB bound (799,716 and 727,307 raw bytes).

The first main runtime run `37036845270` passed builds, tests and runtime probes,
then its new publisher rejected tracked source drift before creating any Release.
An isolated reproduction using the real lockfile showed that default npm pruning
normalizes 27 dev-classification flags in `package-lock.json`. The corrected
packaging command adds `--no-save`, retaining lockfile input while preventing
metadata writes. Read-only HEAD-relative checks before and after pruning reject
staged or unstaged source drift; the publisher's clean-source guard is unchanged.

Five offline regressions use fresh local tarballs, real npm ci/prune, and the exact
workflow packaging shell. They reproduce the old lock rewrite, preserve locked
runtime/transitive bytes and versions, remove dev/extraneous modules, prevent
lifecycle scripts, inspect archived production files, and fail before publication
when source drifts. They pass on npm 11.9.0 and CI's npm 11.19.0 (local Node24.19).

This correction changes packaging verification only. Production remains on the
prior live runtime until the new exact-source pipeline and private-release
provenance checks succeed. Authenticated live-admin pixels require a staff login;
the available cloud browser is signed out. No recovery access was created.

## Room showcase direction and targeted verification — 2 October 2026

The owner clarified that the homepage Room showcase should autoplay and loop
without prominent Play/Pause presentation. The change replaces the icon control
with a small native Motion checkbox beside the existing caption. Explicit
stopping remains available to touch and keyboard users without a popup.
Keyboard inspection pauses only while focused; subsequent touch or leaving the
carousel resumes automatically unless the user explicitly stopped animation.
The actual Room chat, animation rhythm, visibility/background resource guards,
and reduced-motion static transcript are unchanged.

Candidate run `37039647382` exposed two old mobile WebKit test assumptions:
clicking caption controls could scroll the phone offscreen, where playback
correctly pauses. Both attempts failed. The updated assertions restore visible
conversation geometry before requiring playback, retain all pause/resume checks,
and read hardware rectangles synchronously to avoid a separate scroll-frame race.
All other stages passed. Its nine Operations PNGs are byte-identical to the
independently reviewed screenshots from candidate `37031564336`.

The four-file Room change passes 29 deterministic lifecycle cases (included in
93 repository tests), 45 UI tests, TypeScript and scoped lint. Independent source
review passed. A temporary, read-only, manually dispatched verification branch
will repeat every Room browser case twice per engine without retries and retain
bounded, lossless synthetic closed/open Motion screenshots in logs. That workflow
variant is verification-only and must never merge. Hosted behavior, pixel review,
full exact-candidate gates, private runtime publication and deployed-SHA checks
remain required before claiming delivery.


### Direct Motion control verification

The initial disclosure trial passed autoplay and natural-entry checks, but one
mobile WebKit repeat kept its checkbox visible after a closing click. Rather than
add a popup interaction to a simple showcase, the final design uses a direct
native checkbox with a 44-pixel label target and explicit checked state. It keeps
the same accepted caption styling and leaves the animation hook untouched.

The browser regressions exercise real touch activation, native keyboard traversal
and Space, explicit-stop persistence, focus/touch recovery, and unobscured control
placement between the fixed header and dock. Screenshots use the actual viewport
without auto-scrolling an oversized ancestor. Stable transport filenames
`room-static-section.png` and `room-motion-settings.png` now represent the enabled
Motion-on and Motion-off states respectively. Reduced-motion static readability
remains separately required by the unchanged natural-entry suite. Since product
markup and the shared setting helper changed, all four Room cases must pass twice
on each engine without retries before the complete candidate suite is started.
