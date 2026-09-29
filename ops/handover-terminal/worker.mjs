// No public handler. Cloudflare invokes this only after a producer invocation
// (including waitUntil work) has ended. Business work is reconciled separately.
export const terminalOutcomes = new Set(['ok','canceled','exception','exceededCpu','exceededMemory']);
export const terminalKinds = new Set(['http','scheduled','queue']);
export const archiveSql = 'CREATE TABLE IF NOT EXISTS _bct_handover_terminal_operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,started_at TEXT NOT NULL,evidence_json TEXT NOT NULL)';
export async function retainTerminal(db, id, evidence, kind = 'http') {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
    || !terminalKinds.has(kind) || evidence.script !== 'becore-tickets' || !terminalOutcomes.has(evidence.outcome)) throw new Error('Exact terminal producer evidence required.');
  const state = await db.prepare('SELECT phase FROM _bct_handover_admission WHERE id=1').first();
  if (!state || !['active','paused'].includes(state.phase)) return;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO _bct_handover_terminal_operations SELECT id,kind,started_at,? FROM _bct_handover_operations WHERE id=? AND kind=?").bind(JSON.stringify(evidence),id,kind),
    db.prepare("DELETE FROM _bct_handover_operations WHERE id=? AND kind=? AND EXISTS(SELECT 1 FROM _bct_handover_terminal_operations WHERE id=?)").bind(id,kind,id),
  ]);
}
export async function consume(events, env) {
  for (const event of events) {
    if (event.scriptName !== 'becore-tickets' || !terminalOutcomes.has(event.outcome)) continue;
    for (const log of event.logs ?? []) for (const message of log.message ?? []) {
      let entry;
      try { entry = typeof message === 'string' ? JSON.parse(message) : message; } catch { continue; }
      if (!terminalKinds.has(entry?.kind) || entry.phase !== 'entered' || typeof entry.handoverOperation !== 'string') continue;
      await retainTerminal(env.DB, entry.handoverOperation, { script:event.scriptName, outcome:event.outcome,
        method:'cloudflare-terminal-tail', eventTimestamp:event.eventTimestamp, version:event.scriptVersion?.id,
        recordedAt:new Date().toISOString() }, entry.kind);
    }
  }
}
export default { tail(events, env, ctx) { ctx.waitUntil(consume(events, env)); } };
