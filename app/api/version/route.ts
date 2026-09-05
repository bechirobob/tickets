export const dynamic = "force-dynamic";

export async function GET() {
  const { env } = await import("cloudflare:workers");
  return Response.json({
    service: "becore-tickets",
    revision: env.RELEASE_SHA ?? null,
    versionId: env.CF_VERSION_METADATA?.id ?? null,
  }, { headers: { "cache-control": "no-store" } });
}
