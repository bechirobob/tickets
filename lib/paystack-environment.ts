export function paystackEnvironment(secret?: string): 'test' | 'live' | null {
  if (secret?.startsWith('sk_test_')) return 'test';
  if (secret?.startsWith('sk_live_')) return 'live';
  return null;
}

export function paystackAvailable(config: Pick<Cloudflare.Env,'PAYSTACK_SECRET_KEY'|'ENVIRONMENT'>, isTestEvent: boolean) {
  const mode=paystackEnvironment(config.PAYSTACK_SECRET_KEY);
  return Boolean(mode) && (!isTestEvent || mode==='test') && (config.ENVIRONMENT!=='production' || isTestEvent || mode==='live');
}
