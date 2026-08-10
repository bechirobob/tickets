/// <reference types="@cloudflare/vitest-pool-workers" />

import "cloudflare:test";

declare module "cloudflare:test" {
  // The test runtime injects the generated production bindings.
  interface ProvidedEnv extends Cloudflare.Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
