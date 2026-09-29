import { WorkerEntrypoint } from 'cloudflare:workers';
import { sealHandover, requireHandover } from './handover-crypto';

export const configurationNames = [
  'ADMIN_ACCESS_KEY', 'STAFF_LOGIN_DECOY_SECRET', 'PAYSTACK_SECRET_KEY',
  'SEEV_ENABLED', 'SEEV_ENVIRONMENT', 'SEEV_CHECKOUT_API_KEY', 'SEEV_WEBHOOK_SECRET',
  'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'EMAIL_FROM', 'OPS_ALERT_EMAIL',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_GATEWAY_BASE_URL', 'AI_COST_CONTROL_REQUIRED',
  'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_CLASS_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_WALLET_PRIVATE_KEY',
  'APPLE_WALLET_SIGNER_URL', 'APPLE_WALLET_SIGNER_TOKEN', 'APPLE_WALLET_AUTH_SECRET', 'APPLE_WALLET_PASS_TYPE_IDENTIFIER', 'APPLE_WALLET_PUSH_URL',
  'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY', 'VPS_EMAIL_SIGNING_KEY', 'ENVIRONMENT',
] as const;

// No public HTTP handler. Only an explicitly configured same-account Service
// Binding can invoke this entrypoint; callers cannot choose a decryption key.
export class HandoverEntrypoint extends WorkerEntrypoint<Cloudflare.Env> {
  async configuration() {
    requireHandover(this.env);
    const bindings = this.env as unknown as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const name of configurationNames) {
      if (typeof bindings[name] === 'string') values[name] = bindings[name];
    }
    return sealHandover(this.env, 'configuration', { revision: this.env.RELEASE_SHA, values });
  }
}
