export async function installmentSettings(db:D1Database,eventSlug:string) {
 return db.prepare(`SELECT step_minor AS stepMinor FROM event_installment_settings WHERE event_slug=? AND enabled=1 AND provider='seevplus'`).bind(eventSlug).first<{stepMinor:number}>();
}
