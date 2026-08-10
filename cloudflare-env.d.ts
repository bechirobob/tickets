/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    ADMIN_ACCESS_KEY: string;
    ADMIN_SESSION_SECRET: string;
    ASSETS: Fetcher;
    BUCKET: R2Bucket;
    DB: D1Database;
    PAYSTACK_SECRET_KEY: string;
  }
}
