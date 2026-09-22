# Workspace release: 22 September 2026

PR #175 merged as `31922f31c823d72d07bf614b3416c95b4f39d54c` and Cloudflare published Worker version `8d3ead71-8945-4d18-8f64-7764aaa59f70` in deployment run [35719752894](https://github.com/bechirobob/tickets/actions/runs/35719752894). The deployed tree matches verified candidate `207775f63f7337d21addf9edba6d180d035b2a1d` exactly: `03f8d12f1f604753d72264a62262814f88d24889`.

Candidate checks passed: 439 worker tests and 518 browser checks across desktop Chromium, mobile Chromium and mobile WebKit, with no test retries. Repository, UI, password, rendered-page, dependency, lint, type, schema, Worker dry-run, native build and iPhone layout gates passed. Workspace screenshots were reviewed.

## Live verification blocked

At 11:12 UTC, `/api/version` returned HTTP 429 and Cloudflare Error 1027, CF-Ray `a3f0dfa6ee95e6c0-ORD`. Cloudflare blocked the request before it reached the application because the account exhausted its Workers Free daily request quota. The deployment's post-publish verification failed and dependent live browser audits were skipped. Publication is confirmed; live application behavior on the new release is not yet verified.

[Cloudflare documents](https://developers.cloudflare.com/workers/platform/limits/#daily-requests) the Free plan limit as 100,000 requests per day, resetting at midnight UTC. The next reset is 23 September 2026 at 00:00 UTC. [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/) starts at USD 5 per month plus excess usage; a new recurring billing commitment requires owner authorization. No billing changes were made.

Pull-request production browser audits duplicated the isolated candidate coverage and generated additional live traffic. Total account usage has not been inspected, so the share attributable to these audits is unknown. The follow-up change runs the full production audit after successful deployments or manual dispatch, and leaves repeated production diagnostics manual. Full isolated candidate checks remain unchanged.

The release verifier now identifies quota exhaustion explicitly, reports status/content type/Cloudflare request ID for other failures, and does not log response bodies. It still waits for a valid earlier revision to propagate and rejects missing release metadata.

## Recovery

After the quota resets or an authorized billing upgrade takes effect, verify `/api/version` reports the current published main revision and a Worker version ID, then run the production route/privacy checks and browser audit. Do not repeatedly redeploy to resolve a daily quota block.

Rollback evidence: previous main `0e4521971cbf510c9277ca8b72e524f028abde8f`, Worker `b8c84601-54ac-416e-b919-88b435692d1a`, deployment run `35715183500`. Preserve analytics baseline `2026-09-22T04:08:40.800Z`. A rollback cannot restore account-wide request quota.
