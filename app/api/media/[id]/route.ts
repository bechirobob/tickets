import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { partySubmissions } from "../../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [submission] = await db.select({
    key: partySubmissions.posterObjectKey,
    type: partySubmissions.posterContentType,
  }).from(partySubmissions).where(eq(partySubmissions.id, id)).limit(1);
  if (!submission?.key) return new Response("Not found", { status: 404 });

  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(submission.key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": submission.type ?? "application/octet-stream",
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    },
  });
}
