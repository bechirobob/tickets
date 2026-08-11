/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    ADMIN_ACCESS_KEY?: string;
    ASSETS: Fetcher;
    DB: D1Database;
    AI: Ai;
    ENVIRONMENT?: string;
    LOGIN_RATE_LIMITER: RateLimit;
    PUBLIC_WRITE_RATE_LIMITER: RateLimit;
    PAYMENT_RATE_LIMITER: RateLimit;
    IMAGES: ImagesBinding;
    PAYSTACK_SECRET_KEY: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    THE_ROOM: DurableObjectNamespace<import("./worker/index").TheRoom>;
  }
}
