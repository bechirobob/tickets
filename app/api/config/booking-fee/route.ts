import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { bookingFeeRules } from "../../../../db/schema";
import { readAdminSession } from "../../../../lib/admin-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const [rule] = await db.select().from(bookingFeeRules)
    .where(eq(bookingFeeRules.scope, "global"))
    .orderBy(desc(bookingFeeRules.effectiveAt)).limit(1);
  return Response.json({ percentage: rule ? rule.percentageBasisPoints / 100 : 7.5, rule });
}

export async function POST(request: Request) {
  const session = await readAdminSession(request.headers.get("cookie"));
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const actor = session.actor;
  const body = await request.json() as { percentage?: number; scope?: "global" | "event" | "organizer"; scopeId?: string; effectiveAt?: string };
  const percentage = Number(body.percentage);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 25) return Response.json({ error: "Fee must be between 0% and 25%." }, { status: 400 });
  const scope = body.scope ?? "global";
  if (scope !== "global" && !body.scopeId?.trim()) return Response.json({ error: "A scope target is required." }, { status: 400 });
  const now = new Date().toISOString();
  const db = await getDb();
  const rule = { id: crypto.randomUUID(), percentageBasisPoints: Math.round(percentage * 100), scope, scopeId: scope === "global" ? null : body.scopeId!.trim(), effectiveAt: body.effectiveAt ?? now, createdAt: now, createdBy: actor };
  await db.insert(bookingFeeRules).values(rule);
  return Response.json({ rule, percentage }, { status: 201 });
}
