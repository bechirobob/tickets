export const dynamic = "force-dynamic";

export async function GET() {
  const { env } = await import("cloudflare:workers");
  const enabled = Boolean(env.TURNSTILE_SITE_KEY);
  return Response.json(
    { enabled, siteKey: env.TURNSTILE_SITE_KEY ?? null },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
