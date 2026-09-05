import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./drizzle");

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker/the-room.ts",
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          ENVIRONMENT: "test",
          PAYSTACK_SECRET_KEY: "sk_test_payment-operations",
          RESEND_API_KEY: "re_test_delivery",
          ADMIN_ACCESS_KEY: "bootstrap-test-key",
          STAFF_LOGIN_DECOY_SECRET: "test-only-login-decoy-key-at-least-32-characters",
        },
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
