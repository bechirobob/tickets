export type BackgroundHealth = {
  key: string;
  label: string;
  status: "healthy" | "running" | "stale" | "needs_review" | "not_observed";
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failures: number;
};

const jobs = [
  { key: "scheduled:minute", label: "Event updates", staleAfter: 5 * 60_000 },
  { key: "scheduled:five-minute", label: "Confirmations and payment recovery", staleAfter: 15 * 60_000 },
  { key: "delivery-loop", label: "Delivery queue", staleAfter: 5 * 60_000 },
] as const;

/** Record completion separately from startup health. A newer run owns its row. */
export async function observeBackgroundJob<T>(db: D1Database, key: string, work: () => Promise<T>, failed: (result: T) => number = () => 0): Promise<T> {
  const run = crypto.randomUUID();
  const started = new Date().toISOString();
  await db.prepare(`INSERT INTO background_job_health(job_key,run_id,started_at) VALUES(?,?,?)
    ON CONFLICT(job_key) DO UPDATE SET run_id=excluded.run_id,started_at=excluded.started_at,finished_at=NULL`).bind(key, run, started).run();
  let failures = 1;
  try { const result = await work(); failures = Math.max(0, failed(result)); return result; }
  finally {
    const now = new Date().toISOString();
    await db.prepare(`UPDATE background_job_health SET finished_at=?, failure_count=?,
      last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,
      last_failure_at=CASE WHEN ?>0 THEN ? ELSE last_failure_at END WHERE job_key=? AND run_id=?`)
      .bind(now, failures, failures, now, failures, now, key, run).run();
  }
}

export async function readBackgroundHealth(db: D1Database, now = Date.now()): Promise<BackgroundHealth[]> {
  const rows = await db.prepare(`SELECT job_key AS key,started_at AS startedAt,finished_at AS finishedAt,
    last_success_at AS lastSuccessAt,last_failure_at AS lastFailureAt,failure_count AS failures FROM background_job_health`).all<Omit<BackgroundHealth, "label" | "status">>();
  return jobs.map(job => {
    const row = rows.results.find(item => item.key === job.key);
    if (!row) return { key: job.key, label: job.label, status: "not_observed", startedAt: null, finishedAt: null, lastSuccessAt: null, lastFailureAt: null, failures: 0 };
    const elapsed = now - Date.parse(row.startedAt ?? "");
    const status = !Number.isFinite(elapsed) || elapsed > job.staleAfter ? "stale" : !row.finishedAt ? "running" : row.failures > 0 ? "needs_review" : "healthy";
    return { ...row, label: job.label, status };
  });
}
