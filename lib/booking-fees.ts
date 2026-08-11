import { and, desc, eq, lte } from "drizzle-orm";
import { getDb } from "../db";
import { bookingFeeRules } from "../db/schema";

export async function resolveBookingFee(eventSlug: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  const [eventRule] = await db.select().from(bookingFeeRules)
    .where(and(eq(bookingFeeRules.scopeId, eventSlug), lte(bookingFeeRules.effectiveAt, now)))
    .orderBy(desc(bookingFeeRules.effectiveAt)).limit(1);
  if (eventRule) return eventRule.percentageBasisPoints;
  const [globalRule] = await db.select().from(bookingFeeRules)
    .where(and(eq(bookingFeeRules.scope, "global"), lte(bookingFeeRules.effectiveAt, now)))
    .orderBy(desc(bookingFeeRules.effectiveAt)).limit(1);
  return globalRule?.percentageBasisPoints ?? 750;
}
