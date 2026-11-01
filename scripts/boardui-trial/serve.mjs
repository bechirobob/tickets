// Local-only server for the compiled UI trial. No remote resources or credentials.
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
process.env.WRANGLER_WRITE_LOGS = 'false';
process.env.MINIFLARE_REGISTRY_PATH = resolve('.wrangler/boardui-trial-registry');
const { unstable_getMiniflareWorkerOptions } = await import('wrangler');
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const config = resolve('dist/server/boardui-local.json');
writeFileSync(config, JSON.stringify({ name: 'tickets-boardui-local', main: './index.js', compatibility_date: '2026-08-11', compatibility_flags: ['nodejs_compat'], assets: { directory: '../client' }, vars: { ENVIRONMENT: 'test' } }));
const options = unstable_getMiniflareWorkerOptions(config);
delete options.workerOptions.modulesRules;
const modules = [{ type: 'ESModule', path: options.main }, ...readdirSync('dist/server', { recursive: true }).filter(path => /\.m?js$/u.test(path) && path !== 'index.js').map(path => ({ type: 'ESModule', path: resolve('dist/server', path) }))];
const runtime = new Miniflare(convertV4MiniflareOptions({ ...options.workerOptions, modules, modulesRoot: resolve('dist/server'), host: '127.0.0.1', port: 8788, cf: false }));
console.log(`Local-only trial: ${await runtime.ready}boardui-trial`);
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await runtime.dispose(); process.exit(0); });
