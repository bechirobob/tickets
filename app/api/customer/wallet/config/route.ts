export async function GET() {
  const { env } = await import("cloudflare:workers");
  return Response.json({
    apple: Boolean(env.APPLE_WALLET_SIGNER_URL && env.APPLE_WALLET_SIGNER_TOKEN),
    google: Boolean(env.GOOGLE_WALLET_ISSUER_ID && env.GOOGLE_WALLET_CLASS_ID && env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_WALLET_PRIVATE_KEY),
  }, { headers: { "cache-control": "no-store" } });
}
