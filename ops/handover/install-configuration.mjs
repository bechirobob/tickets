import { readFileSync, writeFileSync, existsSync, lstatSync, renameSync, chmodSync } from 'node:fs';
import { openEnvelope } from './open-envelope.mjs';

try {
  const [envelopeFile, expectedRevision] = process.argv.slice(2);
  if (!/^[a-f0-9]{40}$/.test(expectedRevision ?? '')) throw new Error();
  const keyFile = '/etc/becore-tickets/handover/recipient.pem';
  if (!lstatSync(keyFile).isFile() || (lstatSync(keyFile).mode & 0o077)) throw new Error();
  const result = openEnvelope(JSON.parse(readFileSync(envelopeFile, 'utf8')), readFileSync(keyFile), 'configuration');
  const values = result.values;
  if (result.revision !== expectedRevision || !values || Array.isArray(values) || typeof values !== 'object' || Object.values(values).some(value => typeof value !== 'string')) throw new Error();
  for (const name of ['STAFF_LOGIN_DECOY_SECRET', 'APPLE_WALLET_AUTH_SECRET', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY']) {
    if (!values[name] || values[name].length < 16) throw new Error();
  }
  if (values.ENVIRONMENT !== 'production') throw new Error();
  const target = '/etc/becore-tickets/runtime.pending.json';
  if (existsSync(target)) {
    if (!lstatSync(target).isFile() || JSON.stringify(JSON.parse(readFileSync(target, 'utf8'))) !== JSON.stringify(values)) throw new Error();
  } else {
    const temporary = target + '.new';
    writeFileSync(temporary, JSON.stringify(values), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  }
  chmodSync(target, 0o600);
  console.log(JSON.stringify({ configurationStaged: true, bindingNames: Object.keys(values).sort(), sourceRevision: result.revision, activated: false }));
} catch {
  // Authentication/parser errors must not quote secret-bearing input.
  console.error('Private configuration handover rejected; live service unchanged.');
  process.exitCode = 1;
}
