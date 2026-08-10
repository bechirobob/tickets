import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations("./drizzle");

export default defineWorkersConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    poolOptions: {
      workers: {
        main: "./worker/the-room.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      },
    },
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
