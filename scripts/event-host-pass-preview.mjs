import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] || 'event-host-pass-preview');
const compiled = await build({ entryPoints: ['lib/event-host-pass-email.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { eventHostPassEmail } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const email = eventHostPassEmail({ eventTitle: 'PURO EXCESO', hostName: 'Kofi Bills',
  claimUrl: 'https://tickets.becoreops.com/my-nights/access?kind=host#token=SAMPLE-NOT-ACTIVE' });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'host-pass-invitation.html'), email.html);
await writeFile(resolve(output, 'host-pass-invitation.txt'), `${email.subject}\n\n${email.text}\n`);
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ synthetic: true, realTokenCreated: false, emailSent: false,
  subject: email.subject, template: 'lib/event-host-pass-email.ts', sampleToken: 'SAMPLE-NOT-ACTIVE' }, null, 2));
console.log('Synthetic Host pass invitation generated; no credentials or messages created.');
