import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

// Use Wrangler's pinned workerd runtime directly, without its development
// inspector/proxy. Serve the exact compiled Worker, with isolated local bindings.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const options = unstable_getMiniflareWorkerOptions('dist/server/wrangler.capacity.json');
delete options.workerOptions.modulesRules;
const modules = [
  { type: 'ESModule', path: options.main },
  ...readdirSync('dist/server', { recursive: true })
    .filter(path => /\.m?js$/u.test(path) && path !== 'index.js')
    .map(path => ({ type: 'ESModule', path: resolve('dist/server', path) })),
];
const runtime = new Miniflare(convertV4MiniflareOptions({
  ...options.workerOptions,
  modules,
  modulesRoot: resolve('dist/server'),
  host: '127.0.0.1',
  port: 8797,
  resourcePersistencePath: resolve('work/capacity-http/v3'),
  cf: false,
}));
console.log(`Compiled capacity Worker ready: ${await runtime.ready}`);
process.on('SIGTERM', async () => { await runtime.dispose(); process.exit(0); });
