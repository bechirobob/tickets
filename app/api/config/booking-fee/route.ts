import { and, desc, eq, lte } from "drizzle-orm";
import { getDb } from "../../../../db";
import { bookingFeeRules } from "../../../../db/schema";
import { hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const db = await getDb();
  const now = new Date().toISOString();
  const [rule] = await db.select().from(bookingFeeRules)
    .where(and(eq(bookingFeeRules.scope, "global"), lte(bookingFeeRules.effectiveAt, now)))
    .orderBy(desc(bookingFeeRules.effectiveAt)).limit(1);
  const session = await readAdminSession(request.headers.get("cookie"));
  const authorized = Boolean(session && hasPermission(session, "fees.manage"));
  const history = authorized ? await db.select().from(bookingFeeRules).orderBy(desc(bookingFeeRules.createdAt)).limit(20) : [];
  return Response.json(
    { percentage: rule ? rule.percentageBasisPoints / 100 : 7.5, ...(authorized ? { history } : {}) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const session = await readAdminSession(request.headers.get("cookie"));
  if (!session || !hasPermission(session, "fees.manage")) return Response.json({ error: "Finance access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const actor = session.actor;
  const body = await request.json() as { percentage?: number; scope?: "global" | "event" | "organizer"; scopeId?: string; effectiveAt?: string };
  const percentage = Number(body.percentage);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 25) return Response.json({ error: "Fee must be between 0% and 25%." }, { status: 400 });
  const scope = body.scope ?? "global";
  if (scope !== "global" && !body.scopeId?.trim()) return Response.json({ error: "A scope target is required." }, { status: 400 });
  const now = new Date().toISOString();
  const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : new Date(now);
  if (!Number.isFinite(effectiveAt.getTime())) return Response.json({ error: "Choose a valid effective time." }, { status: 400 });
  const db = await getDb();
  const rule = { id: crypto.randomUUID(), percentageBasisPoints: Math.round(percentage * 100), scope, scopeId: scope === "global" ? null : body.scopeId!.trim(), effectiveAt: effectiveAt.toISOString(), createdAt: now, createdBy: actor };
  await db.insert(bookingFeeRules).values(rule);
  const { env } = await import("cloudflare:workers");
  await recordAudit(env.DB, { session, action: "fees.rule_created", targetType: "booking_fee_rule", targetId: rule.id, outcome: "success", requestId: requestMetadata(request).requestId });
  return Response.json({ rule, percentage }, { status: 201 });
}
