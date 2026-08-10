import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { bookingFeeRules } from "../db/schema";

export async function resolveBookingFee(eventSlug: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  const [eventRule] = await db.select().from(bookingFeeRules).where(eq(bookingFeeRules.scopeId, eventSlug)).orderBy(desc(bookingFeeRules.effectiveAt)).limit(1);
  if (eventRule && eventRule.effectiveAt <= now) return eventRule.percentageBasisPoints;
  const [globalRule] = await db.select().from(bookingFeeRules).where(eq(bookingFeeRules.scope, "global")).orderBy(desc(bookingFeeRules.effectiveAt)).limit(1);
  return globalRule && globalRule.effectiveAt <= now ? globalRule.percentageBasisPoints : 750;
}
