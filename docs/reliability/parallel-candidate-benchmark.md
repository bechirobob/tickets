# Parallel Candidate benchmark

Full-coverage parallel Candidate verification is the default for branch pushes
and release admission. It still requires independently authenticated v2 evidence
from the reviewed producer, all three isolated browsers and aggregate job.
Legacy sequential verification is an explicit workflow-dispatch recovery route;
release admission must also explicitly select legacy for its evidence. There is
no automatic fallback. Historical v1 benchmark results are timing evidence only;
they cannot authorize a release.

## Execution and identity

Non-main branches run on push, so the executed workflow revision and checked-out
source are the same exact commit. Automatic main pushes are reserved for runtime
verification; synthetic pull-request refs are never release provenance.

For automatic candidate runs the producer independently resolves the fetched
origin/main commit as the trusted control baseline. That exact commit must be a
strict ancestor of the candidate; stale branches fail instead of silently picking
an older common ancestor. The producer exports its selected SHA once, and every
browser lane consumes the same SHA. Workflow dispatch can explicitly select a
reviewed ancestor for controlled recovery. No hard-coded historical SHA is used
when the input is omitted. Check for an existing push run before dispatching.

A valid branch name alone does not authorize release. The production collector
still authenticates the exact source/runtime tree and the entire workflow/audit
control closure against the independently reviewed control baseline. Control
changes therefore require independent review and a new trusted main revision
before application candidates can use them. Release inputs must use the same
baseline recorded in the candidate receipts; never substitute current main after
a run has selected its baseline.

One build job performs the original static/unit/rendered/build/schema/dry-run
gates. Three independent Ubuntu runners restore identical build bytes and run
all original desktop Chromium, mobile Chromium and mobile WebKit journeys.
Each runner has its own local database and one Playwright worker. No live
provider, production database or production credentials are supplied.

Each consumer re-audits and installs the exact lock. A bounded ZIP contains only
regular generated files beneath dist/client and dist/server, including intended
Vite manifests. Existing public-package path/literal checks run before upload.
This reduces accidental disclosure; it is not a guarantee that arbitrary source
contains no secret. Treat any uploaded package as publicly retrievable.

The immutable Actions artifact ID is a producer output, never a name lookup.
Independent archive/manifest digests bind the source/tree, executed workflow,
repository, run/attempt, lock, Node version and browser inventory. Each restore
compares all inputs, bounds metadata/files/expanded bytes, rejects special files
and path collisions, and emits a receipt. A receipt or digest alone is not
release authentication.

Partial reruns that reuse a previous attempt's build fail intentionally. Rerun
all jobs after checking why the first attempt failed. Never silently rebuild,
read a cache, use a different artifact or substitute previous evidence.

## Resource limits

Only the build ZIP and its manifest are uploaded, with one-day retention and
no overwrite. Limits are 256 MiB compressed, 512 MiB expanded, 25,000 files and
8 MiB manifest. No root checkout, node_modules, fixtures, logs, traces, database
or private audit report is included. Existing small synthetic PNG/JSON review
evidence remains in its bounded log transport.

No token permission, credential, paid runner or service is added. Storage quota
is not established by earlier successful small image uploads. A quota or
transport failure fails this experiment; do not enable overages or expand access
without approval. Parallelism can consume more total runner minutes because
setup repeats, even while reducing waiting time.

## Measurement and promotion

Use scripts/release-timing.py with complete exact-attempt GitHub metadata. Report
execution wall time, queue delay, summed runner occupancy, rounded-minute model,
retries and artifact size separately. Compare actual sequential and parallel runs
on equivalent application/test inputs; record workflow/tool differences. Do not
call the model a billing statement or observed speedup.

Before any production admission change, independently review an explicit new
contract that authenticates the completed producer job/log receipt, GitHub
artifact metadata, exact-attempt consumer receipts and every required named
step. GitHub artifact metadata alone has no attempt identity. Preserve the
legacy contract and exact final source-tree checks. Missing, failed, skipped,
duplicate, mixed-attempt or substituted evidence must remain fatal.


## Measured same-head baseline, 13–14 October 2026 UTC

Both successful runs tested head d8b2c75ef79646e9acfdc7faf3b6f08539af8dfa:

- [Sequential 38483973677](https://github.com/bechirobob/tickets/actions/runs/38483973677):
  execution 48m12s, trigger-to-completion 48m53s, runner occupancy 48m12s.
- [Parallel 38483969560](https://github.com/bechirobob/tickets/actions/runs/38483969560):
  execution 25m20s, trigger-to-completion 26m07s, runner occupancy 52m46s.
- Observed execution reduction: 22m52s (47.44%). Added runner occupancy:
  4m34s (9.47%). Per-job rounded-minute model: 49 versus 56 minutes.
- This is one measured pair, not an SLA or billing statement. Earlier superseded
  setup runs consumed additional runner time and are excluded from this pair.

GitHub exact-attempt job timestamps were retrieved again on 14 October after a
workspace recovery. The original one-day artifact may expire; timing metadata
must never be substituted for current release evidence.

## Historical first verification-only rollout

The release workflow accepts verify_only=true to run the complete evidence and
final dependency-audit checks without Tailscale connection, SSH, host activation
or production browser checks. It rejects conflicting inspect-failure mode before
checkout. A verification-only success does not mean anything was deployed.

The finite first rollout starts from the exact live RSVP baseline
45ae58430aea3bad312a8244432078a4ffde59f8. Independently merge the reviewed control
revision C first; the final candidate P adds only the genuine reserved source-
family contract test. Exact C and P inventories are separately validated. Run
fresh full parallel browser checks with trusted_base=C, obtain exact-main runtime
evidence for the equivalent candidate tree, and require a successful online
verification-only run. No application, dependency or migration edit belongs to
this rollout. All normal release checks still apply to actual activation.

V2 binds the exact independently selected audit baseline and complete audit
verifier closure, workflow, source/tree, immutable artifact, attempt and job/log
receipts. No receipt is sufficient on its own. The collector keeps selected log
evidence immutable and rechecks authenticated job/artifact metadata immediately
before a host transaction. Missing, expired, altered or mixed evidence fails.

The parallel admission implementation was reconstructed after loss of an
unpublished workspace snapshot. New module revisions require fresh tests and
independent review; earlier local test counts are not attributed to them.


## Default-route rollout gate

The default-route rollout is a separate control-only change based on the live
CINCO revision 04bbe9691a00ca48cfb974ab0b87b743d9c3aab8 and the completed
activation successor b9bfde4fb82320c023016de960519b9d1bb2ae3f. Preserve the
application tree and independently review the exact finite control inventory.
The separately merged control revision C must precede a candidate adding only
the reserved default-source-family regression suite. This rollout does not
authorize application, dependency, database or migration edits. Older source
families remain unchanged; no generic fast-path admission is introduced.

Bootstrap the control change using explicitly selected legacy evidence where the
previous trusted operator requires it. Then prove an ordinary candidate branch
gets one automatic full parallel run without manual selection, using the newly
reviewed main controls. Obtain equivalent-tree runtime evidence and a successful
online verify-only run with the candidate mode omitted. Test explicit legacy
recovery separately. Production activation still requires all existing checks.

Required regression coverage includes identical browser commands, current-main
selection, stale-branch failure, shared baseline exports, normal branch admission,
synthetic/fork/wrong-attempt rejection, tampered/expired receipts, exact control
closure, runtime/tree equality, and failure without fallback. No permission,
credential, provider traffic or paid-capacity changes belong to this rollout.

## Browser-only scope while native work is paused

Ordinary Tickets changes run desktop Chromium, mobile Chromium and mobile WebKit
web journeys. Packaged-client/native builds and iPhone app-parity screenshots do
not run automatically. The Native app builds and iPhone layout screenshots
workflows retain workflow_dispatch for a later explicit request to reopen that
work; Android release and iPhone release are already manual-only. No native
workflow is a release prerequisite. Existing dependency security audits remain
unchanged; they are neither native builds nor native UI checks.

Static workflow contract tests ensure these four workflows remain manual-only.
Those tests inspect trigger definitions without building or running native apps.
The parallel candidate retains all existing desktop/mobile web journeys.
