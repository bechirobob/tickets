# Parallel Candidate benchmark

This is an advisory, read-only CI experiment. It cannot satisfy the existing
production release operator. The original Candidate workflow and its full
coverage remain unchanged.

## Execution and identity

The narrowly named experiment branch runs on push, so the workflow revision and
checked-out source are the same exact commit. Workflow dispatch accepts an
independently reviewed trusted ancestor on main. Pull-request merge-ref execution
is not used as provenance. Check for an existing run before dispatching another.

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
