import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

// Wrangler 4.120's development ProxyController exits on a browser disconnect
// ("Error inside ProxyWorker: Network connection lost"). Browser tests serve the
// same compiled Worker directly, as our capacity harness does. No restart or
// error suppression: runtime failures still fail the journey.
const modes = {
  public: { port: 8788, bindings: {} },
  seev: { port: 8789, bindings: { ENVIRONMENT: 'test', PAYSTACK_SECRET_KEY: 'sk_test_ui_fixture', SEEV_ENABLED: 'true', SEEV_ENVIRONMENT: 'sandbox', SEEV_CHECKOUT_API_KEY: 'ui-test-only', SEEV_WEBHOOK_SECRET: 'ui-test-only' } },
  registration: { port: 8790, bindings: { ENVIRONMENT: 'test' } },
  operations: { port: 8791, https: true, bindings: { ENVIRONMENT: 'test', STAFF_LOGIN_DECOY_SECRET: 'isolated-browser-login-decoy-secret-only' } },
};
const mode = modes[process.argv[2] ?? 'public'];
if (!mode) throw new Error('Unknown isolated browser fixture mode');
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const options = unstable_getMiniflareWorkerOptions('dist/server/wrangler.json');
delete options.workerOptions.modulesRules;
const modules = [
  { type: 'ESModule', path: options.main },
  ...readdirSync('dist/server', { recursive: true })
    .filter(path => /\.m?js$/u.test(path) && path !== 'index.js')
    .map(path => ({ type: 'ESModule', path: resolve('dist/server', path) })),
];
export const runtime = new Miniflare(convertV4MiniflareOptions({
  ...options.workerOptions,
  modules,
  modulesRoot: resolve('dist/server'),
  bindings: { ...options.workerOptions.bindings, ...mode.bindings },
  host: '127.0.0.1',
  port: mode.port,
  https: mode.https ?? false,
  // Match `wrangler d1 --persist-to .wrangler/state`, including its v3 suffix.
  resourcePersistencePath: resolve('.wrangler/state/v3'),
  cf: false,
}));
console.log(`Compiled browser Worker ready: ${await runtime.ready}`);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => { await runtime.dispose(); process.exit(0); });
}
