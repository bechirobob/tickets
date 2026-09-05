/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    ADMIN_ACCESS_KEY?: string;
    STAFF_LOGIN_DECOY_SECRET?: string;
    ASSETS: Fetcher;
    DB: D1Database;
    AI: Ai;
    ENVIRONMENT?: string;
    RELEASE_SHA?: string;
    CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
    LOGIN_RATE_LIMITER: RateLimit;
    PUBLIC_WRITE_RATE_LIMITER: RateLimit;
    PAYMENT_RATE_LIMITER: RateLimit;
    ANALYTICS_RATE_LIMITER: RateLimit;
    IMAGES: ImagesBinding;
    PAYSTACK_SECRET_KEY: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    OPS_ALERT_EMAIL?: string;
    RESEND_WEBHOOK_SECRET?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    GOOGLE_WALLET_ISSUER_ID?: string;
    GOOGLE_WALLET_CLASS_ID?: string;
    GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL?: string;
    GOOGLE_WALLET_PRIVATE_KEY?: string;
    APPLE_WALLET_SIGNER_URL?: string;
    APPLE_WALLET_SIGNER_TOKEN?: string;
    THE_ROOM: DurableObjectNamespace<import("./worker/index").TheRoom>;
  }
}
