/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    ADMIN_ACCESS_KEY: string;
    ADMIN_SESSION_SECRET: string;
    ASSETS: Fetcher;
    DB: D1Database;
    IMAGES: ImagesBinding;
    PAYSTACK_SECRET_KEY: string;
    THE_ROOM: DurableObjectNamespace<import("./worker/index").TheRoom>;
  }
}
