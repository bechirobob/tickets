import { appendFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const origin = 'https://tickets.becoreops.com';

export async function checkD1RecoveryRuntime(fetcher = fetch) {
  const read = async path => {
    const response = await fetcher(`${origin}${path}`, {
      redirect: 'error',
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200) throw new Error('Runtime identity unavailable.');
    return response.json();
  };
  const [health, version] = await Promise.all([read('/healthz'), read('/api/version')]);
  if (!health || !version || health.service !== 'becore-tickets' || version.service !== 'becore-tickets'
      || health.runtime !== 'vps' || health.active !== true
      || typeof version.revision !== 'string' || !/^[a-f0-9]{40}$/.test(version.revision) || health.revision !== version.revision) {
    throw new Error('Active Tickets VPS identity could not be verified; D1 applicability is unknown.');
  }
  return {
    checkedAt: new Date().toISOString(),
    result: 'not-applicable',
    activeRuntime: 'vps',
    revision: version.revision,
    legacyTarget: 'becore-tickets-db',
    schemaExpectation: 'Inactive D1 is not expected to match the current application schema.',
    restoreTested: false,
    productionChanged: false,
    activeRecoveryWorkflow: 'tickets-backup.yml',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await rm('d1-recovery-rehearsal-report.json', { force: true });
    const report = await checkD1RecoveryRuntime();
    await writeFile('d1-recovery-rehearsal-report.json', `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    const summary = 'Legacy D1 recovery: not applicable. Verified active Tickets VPS; no D1 export or restore performed. This is not recovery proof. Review Tickets encrypted production backup separately.\n';
    console.log(summary.trim());
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch {
    // Never echo a response body, redirected URL or transport diagnostics.
    console.error('D1 recovery applicability failed: active Tickets VPS identity could not be verified. No export or restore performed.');
    process.exitCode = 1;
  }
}
