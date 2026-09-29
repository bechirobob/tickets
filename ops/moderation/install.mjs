import { readFileSync, writeFileSync, renameSync, lstatSync } from 'node:fs';
import { openEnvelope } from '../handover/open-envelope.mjs';
try {
  const [file, revision] = process.argv.slice(2);
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error();
  const target = '/etc/becore-tickets/runtime.pending.json';
  const keyPath = '/etc/becore-tickets/handover/recipient.pem';
  for (const path of [target, keyPath]) if (!lstatSync(path).isFile() || (lstatSync(path).mode & 0o077)) throw new Error();
  const envelope = openEnvelope(JSON.parse(readFileSync(file, 'utf8')), readFileSync(keyPath), 'moderation-configuration');
  const incoming = envelope.values;
  if (envelope.sourceRevision !== revision || incoming?.VPS_AI_URL !== 'https://becore-tickets-moderation.becoreops.workers.dev/moderate' || !/^[a-f0-9]{64}$/.test(incoming.VPS_AI_SIGNING_KEY ?? '') || Object.keys(incoming).sort().join(',') !== 'VPS_AI_SIGNING_KEY,VPS_AI_URL') throw new Error();
  const values = JSON.parse(readFileSync(target, 'utf8'));
  for (const name of Object.keys(incoming)) {
    if (values[name] && values[name] !== incoming[name]) throw new Error();
    values[name] = incoming[name];
  }
  const next = target + '.moderation-new';
  writeFileSync(next, JSON.stringify(values), { mode: 0o600, flag: 'wx' });
  renameSync(next, target);
  console.log(JSON.stringify({ moderationConfigurationStaged: true, activated: false }));
} catch { console.error('Moderation configuration import rejected; active runtime unchanged.'); process.exitCode = 1; }
