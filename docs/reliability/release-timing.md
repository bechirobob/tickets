# Release timing: offline observations

`scripts/release-timing.py` reads saved GitHub Actions metadata with Python's
standard library. It makes no network calls, changes no workflow, and never
provides release admission, approval, or authenticity guarantees. A timing report
cannot replace the existing trusted release verifier.

## Capture and run

Save the complete jobs response for the **specific run ID and attempt**, including
all pages from `/repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt}/jobs`.
Combine pages into one object with the original `total_count` and a complete
`jobs` array. Do not silently use the latest-attempt endpoint or `filter=all`.
The tool rejects count mismatches, duplicates, mixed identities, incomplete jobs,
invalid conclusions, and malformed or impossible execution timestamps.

Optionally save the corresponding exact-attempt run response from
`/repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt}`. Its `id`,
`run_attempt`, `head_sha`, and `repository.full_name` must match the jobs. Keep raw
metadata in the existing private release evidence location. Do not collect tokens,
production data, or entire logs for timing. Input is read locally and the report
is written to stdout; no files are uploaded by this tool.

```sh
python3 scripts/release-timing.py \
  --sample sequential 38450495313 1 jobs-38450495313.json \
  --sample candidate 38463089312 1 jobs-38463089312.json \
  --compare sequential candidate > timing.json

# Optional exact-attempt run metadata:
python3 scripts/release-timing.py \
  --sample candidate 38463089312 1 jobs-38463089312.json \
  --run candidate run-38463089312-attempt-1.json > timing.json

python3 -m unittest discover -s tests -p test_release_timing.py -v
```

A jobs file can alternatively be an archive keyed by run-ID strings, each value
being a complete `{ "total_count": N, "jobs": [...] }` response. The explicit
run/attempt arguments still apply. Invalid input exits with status 2 and emits no
partial JSON report. Add another `--sample` for each earlier attempt to include
its consumption; the same run/attempt cannot be counted twice.

## What the numbers mean

- `execution_wall_seconds`: earliest executed-job start to latest executed-job
  completion. Includes gaps between jobs, excludes initial queue. This is not the
  sum of parallel jobs, CPU time, full request-to-production time, or DAG analysis.
- `jobs_observed_elapsed_seconds`: earliest executed-job creation to latest
  completion. A jobs-only observation, not a claimed workflow creation timestamp.
- Per-job `queue_seconds`: job creation to job start. It can include scheduling
  and dependency waiting. `summed_job_queue_seconds` adds these overlapping waits;
  it is not user-visible elapsed time and must not be added to wall time.
- `runner_seconds`: sum of completed executed-job intervals, including failed,
  cancelled, timed-out, or otherwise unsuccessful jobs. This measures observed
  runner occupancy, not CPU utilization or invoice-metered usage.
- `runner_groups`: exact sorted runner-label sets, preserving class/OS labels
  without guessing the underlying machine or rate. Empty labels are explicitly
  warned and grouped as unknown. Labels alone do not establish billing status.
- `modeled_ceil_job_minutes`: sum of `ceil(job_seconds / 60)` **per executed job**.
  This is a simple rounding model, not charged minutes or monetary cost. It does
  not apply OS multipliers, plan allowances, self-hosted treatment, runner rates,
  discounts, or storage charges. More parallel jobs can increase this estimate
  while reducing wall time.
- `steps`: each step's conclusion and observed duration. `lanes` recognizes the
  existing `(desktop-chromium)`, `(mobile-webkit)`, and `(mobile-chromium)` markers
  in step or job names; everything else is `other`. Each lane has both a sum of
  step durations and its first-to-last elapsed span. Gaps can make spans exceed
  summed steps; interleaved lane spans can overlap and must not be added as wall
  time. `unattributed_job_seconds` keeps setup/teardown gaps visible.
- Optional `run_queue_seconds`: attempt-1 `created_at` to `run_started_at`, not
  time to the first job. `run_elapsed_through_last_job_seconds` ends at the last
  observed job, not a claimed workflow completion timestamp. The API's
  `updated_at` is deliberately not treated as completion time.
- For reruns, original `created_at` does not establish retry enqueue time, so
  run queue/elapsed fields remain null. `represented_attempt_groups` totals only
  supplied attempts and lists earlier missing attempts. Internal Playwright or
  shell retries are not inferable from job metadata; they remain unknown.

Skipped jobs and steps remain visible with their conclusions, but their timing
is excluded. GitHub can supply placeholder/reversed timestamps for a skipped job
that never ran. The tool warns instead of turning those times into negative work.
Executed jobs/steps require ordered timestamps, and executed steps must lie
inside the job interval without overlaps. Missing step arrays are rejected;
empty arrays are warned because startup failures can legitimately have no steps.
A completed failure is measurable, not a passing gate. `non_success_jobs` includes
skipped jobs as well; run conclusion remains null without exact run metadata.

`total_count` detects ordinary incomplete pagination but cannot prove a locally
edited file is authentic or that steps were never omitted upstream. Preserve the
original capture and verify its source independently. This is an observational
utility, not another evidence/security contract.

## Baseline and paired comparison

Initial jobs-only observations from the preserved metadata:

| Candidate | Exact attempt | Execution wall | Runner seconds | Modeled rounded minutes |
| --- | --- | ---: | ---: | ---: |
| Controls candidate | [38450495313 / 1](https://github.com/bechirobob/tickets/actions/runs/38450495313/attempts/1) | 48m48s | 2928 | 49 |
| C3 | [38463089312 / 1](https://github.com/bechirobob/tickets/actions/runs/38463089312/attempts/1) | 48m10s | 2890 | 49 |

Both ran one `ubuntu-latest` job. The second observation is 38 seconds shorter;
these are different candidates, **not** a sequential/parallel controlled pair or
proof of an optimization. The comparison output gives descriptive wall speedup,
wall reduction, runner-seconds delta, and modeled-minute delta separately.
Zero denominators yield null ratios. Every supplied sample stays in the output,
including failures; nothing is silently selected or excluded.

For the actual before/after experiment, record exact application/test inputs,
lockfile, toolchain/browser versions, runner class, and workflow revisions. Keep
all inputs equivalent except the deliberately changed workflow. Include every
observed sample and its failures; explain exclusions, and calculate median/range
across repeated pairs if available. Queue variation and failures can dominate
small samples. Do not rerun production deployment just to benchmark it.

Artifact bytes/retention, request-to-verified-production time, main-runtime,
activation/verification, merge-ready-to-action delay, and recovery-drill time
require their own observed evidence. Do not synthesize them from Candidate time
or interpret time between workflow completion and merge as CI consumption.
The tool does not estimate artifact byte-days without retention evidence or
claim that a recovery drill occurred.

## Ownership within the existing release record

Use the existing release task/record, not a new tracking service. Before handing
off or waiting, keep one bounded entry containing:

- Expected active SHA, candidate SHA and full tree, trusted controls SHA
- Exact workflow run IDs/attempts and links; current known stage/conclusion
- Next authorized transition and the named responsible executor
- Last observation timestamp and the next checkpoint/blocker
- Request, merge-ready, action-start, activation, and verified-production times
  where actually observed, with the evidence link for each

If an executor closes, the coordinating owner retains responsibility to resume
or explicitly hand off. Corroborate stale UI/API summaries before calling a run
stalled. Observation must not start duplicate work or bypass gates. Record each
handoff timestamp separately from machine work. Keep the existing deployment
lock, writer fences, migration checks, and trusted evidence rules unchanged.
