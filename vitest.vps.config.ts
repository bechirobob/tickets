import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  resolve: { alias: {
    '@': local('.'), 'cloudflare:test': local('./tests/vps-bindings.mjs'),
    'cloudflare:workers': local('./runtime/vps/cloudflare-workers.mjs'),
    'cloudflare:sockets': local('./runtime/vps/cloudflare-sockets.mjs'),
  } },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/apply-migrations.ts', './tests/vps-teardown.mjs'],
    maxWorkers: 2,
  },
});
