import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Local workerd + local D1 only. No Cloudflare credentials, remote bindings or customer data.
export default defineConfig({
  plugins: [cloudflareTest({
    main: './worker/the-room.ts', wrangler: { configPath: './wrangler.capacity.jsonc' },
    miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('./drizzle'), ENVIRONMENT: 'test',
      PAYSTACK_SECRET_KEY: 'sk_test_capacity', RESEND_API_KEY: 're_test_capacity', STAFF_LOGIN_DECOY_SECRET: 'test-only-capacity-key-at-least-32-characters' } },
  })],
  test: { reporters: ['default', './scripts/capacity/reporter.ts'], silent: false, include: ['tests/capacity/*.capacity.ts'], setupFiles: ['./tests/apply-migrations.ts'], fileParallelism: false, testTimeout: 300_000, hookTimeout: 120_000 },
});
