import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { partySubmissions } from "../../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [media] = await db.select({
    body: partySubmissions.posterData,
    type: partySubmissions.posterContentType,
  }).from(partySubmissions).where(eq(partySubmissions.id, id)).limit(1);
  if (!media?.body || !media.type) return new Response("Not found", { status: 404 });

  return new Response(Uint8Array.from(media.body), {
    headers: {
      "content-type": media.type,
      "content-length": String(media.body.byteLength),
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    },
  });
}
