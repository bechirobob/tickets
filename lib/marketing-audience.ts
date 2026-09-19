export const marketingAudiences={all:'All subscribed guests',confirmed:'Confirmed guests',waitlisted:'Waitlist',interested:'Interested guests'} as const;
export type MarketingAudience=keyof typeof marketingAudiences;
export const marketingConsent="a.consented_at IS NOT NULL AND a.consented_at > COALESCE(a.unsubscribed_at,'') AND COALESCE(m.unsubscribed,0)=0";
export function marketingAudienceSql(group:MarketingAudience) {
 const status=group==='all'?'': group==='confirmed'?`AND (EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_slug=a.event_slug AND r.normalized_email=a.email AND r.status='confirmed') OR EXISTS (SELECT 1 FROM orders o WHERE o.event_slug=a.event_slug AND lower(o.customer_email)=a.email AND o.status='paid'))`:`AND EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_slug=a.event_slug AND r.normalized_email=a.email AND r.status='${group==='waitlisted'?'waitlisted':'interested'}')`;
 return `SELECT a.id,a.email FROM event_audience_contacts a LEFT JOIN marketing_contacts m ON m.email=a.email JOIN curated_event_records e ON e.slug=a.event_slug WHERE a.event_slug=? AND e.removed_at IS NULL AND e.is_test_event=0 AND ${marketingConsent} ${status}`;
}
export async function marketingSummary(db:D1Database,eventSlug:string) {
 const state=await db.prepare('SELECT status,contact_count AS contactCount,reserved_count AS reservedCount,checked_at AS checkedAt,error FROM marketing_state WHERE id=\'resend\'').first();
 const rows=await db.prepare(`SELECT COUNT(*) AS subscribed,COALESCE(SUM(m.provider_id IS NOT NULL),0) AS synced FROM (${marketingAudienceSql('all')}) a LEFT JOIN marketing_contacts m ON m.email=a.email`).bind(eventSlug).first<{subscribed:number;synced:number}>();
 return {state,limit:1000,...rows};
}
