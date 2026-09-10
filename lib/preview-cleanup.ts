/** Owner-authorised one-time removal of retired preview cases and test purchases. */
export const previewCleanupId = 'operator:preview-cleanup-2026-09-10';
const convertedSlug='sun-chasers-labadi';
const convertedAt='2026-09-08T09:59:19.000Z';
const legacyPreviewOrder='88ad9bcd-2c2c-49f9-8115-ec982bd9a3c4';
const historicalContent=new Set(['room_flashes','room_reports','room_blocks','room_moderation_actions','room_suspensions','vip_concierge_requests','attendee_notifications','attendee_event_preferences','attendee_event_decisions','attendee_question_answers','notification_preferences','event_audience_contacts','event_waitlist_entries','event_memories','support_cases','operational_incidents']);
const retired = ['after-dark-osu', 'noir-room-labone', 'longitude-spintex'];
type Targets = Record<string, string[]>;
type Plan = { targets: Targets; extraPreviewRooms:string[]; tables: Record<string, string[]>; counts: Record<string,number> };
const primary: Record<string,string> = {
 curated_event_records:'event_id', party_submissions:'submission_id', orders:'order_id', tickets:'ticket_id',
 event_registrations:'registration_id', room_flashes:'flash_id', support_cases:'case_id', event_questions:'question_id',
 event_announcement_campaigns:'campaign_id', event_audience_contacts:'contact_id', event_settlements:'settlement_id',
 organizer_payout_accounts:'payout_account_id', approval_requests:'approval_request_id', refund_batches:'batch_id',
 event_ticket_tiers:'ticket_tier_id', hosts:'host_id', attendee_profiles:'attendee_id', attendee_recovery_grants:'recovery_grant_id',
};
const literal=(value:string)=>`'${value.replaceAll("'","''")}'`;
const inside=(column:string, values:string[])=>values.length?`${column} IN (${values.map(literal).join(',')})`:'0';
// D1 limits expression depth to 100. Search a values table instead of expanding one OR per identifier.
const mentionsAny=(column:string,values:string[])=>values.length?`EXISTS (SELECT 1 FROM json_each(${literal(JSON.stringify(values))}) AS preview_keys WHERE instr(COALESCE(${column},''),preview_keys.value)>0)`:'0';
function condition(table:string,columns:string[],t:Targets) {
 const clauses=columns.filter(c=>t[c]?.length).map(c=>inside(c,t[c]));
 if(historicalContent.has(table)&&columns.includes('event_slug')){const date=['updated_at','created_at','published_at','suspended_at','decided_at','answered_at'].find(c=>columns.includes(c));if(date)clauses.push(`(event_slug=${literal(convertedSlug)} AND datetime(${date}) < datetime(${literal(convertedAt)}))`);}
 if(table==='product_metrics_daily')clauses.push(`(event_slug=${literal(convertedSlug)} AND day<'2026-09-08')`);
 if(columns.includes('id')&&primary[table]) clauses.push(inside('id',t[primary[table]]??[]));
 if(table==='reconciliation_runs')clauses.push(inside('id',t.run_id??[]));
 if(table==='booking_fee_rules')clauses.push(`(scope='event' AND ${inside('scope_id',t.event_slug)})`);
 if(table==='curated_event_records')clauses.push(inside('slug',t.event_slug));

 if(table==='attendee_profiles'||table==='attendee_recovery_grants')clauses.push(inside('normalized_email',t.orphan_email??[]));
 if(table==='consent_records')clauses.push(inside('subject_id',t.subject_id??[]));
 if(table==='delivery_events'){
  clauses.push(inside('recipient',t.orphan_email??[]));
  clauses.push(mentionsAny('payload_json',[...t.event_slug,...(t.registration_id??[]),...(t.campaign_id??[])]));
 }
 if(table==='operational_audit_events'||table==='security_events'||table==='system_alerts'){
  const keys=[...t.event_slug,...(t.order_id??[]),...(t.reference??[]),...(t.ticket_id??[]),...(t.registration_id??[]),...(t.submission_id??[])];
  if(columns.includes('target_id'))clauses.push(inside('target_id',keys));
  for(const col of ['detail','path'].filter(c=>columns.includes(c)))clauses.push(mentionsAny(col,keys));
 }
 return clauses.length?`(${clauses.join(' OR ')})`:'0';
}
const add=(t:Targets,key:string,values:unknown[])=>{t[key]=[...new Set([...(t[key]??[]),...values.filter((v):v is string=>typeof v==='string'&&v.length>0)])];};
export async function planPreviewCleanup(db:D1Database):Promise<Plan> {
 const events=await db.prepare(`SELECT slug,is_test_event AS preview FROM curated_event_records WHERE ${inside('slug',retired)}`).all<{slug:string;preview:number}>();
 if(events.results.some(e=>!e.preview))throw new Error('A retired preview was converted to a live event. Cleanup stopped.');
 const live=await db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE ${inside('event_slug',retired)} AND payment_environment='live' AND payment_provider<>'rsvp' AND status IN ('paid','refund_pending','refunded','requires_refund','disputed')`).first<{count:number}>();
 if(live?.count)throw new Error('A preview contains live payments. Cleanup stopped.');
 const tables:Record<string,string[]>={};
 const names=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'").all<{name:string}>();
 for(const {name} of names.results){if(!/^[a-z_]+$/.test(name))continue;const cols=await db.prepare(`PRAGMA table_info(${name})`).all<{name:string}>();tables[name]=cols.results.map(c=>c.name);}
 const targets:Targets={event_slug:retired,host_id:['host:becore-preview-desk']};
 const legacy=await db.prepare('SELECT id,created_at,event_slug,paystack_transaction_id,paystack_status,provider_transaction_id,payment_environment FROM orders WHERE id=?').bind(legacyPreviewOrder).first<Record<string,unknown>>();
 if(legacy){if(legacy.event_slug!==convertedSlug||legacy.created_at!=='2026-08-11T03:51:30.480Z'||legacy.paystack_transaction_id||legacy.paystack_status||legacy.provider_transaction_id||legacy.payment_environment==='live')throw new Error('The legacy preview booking changed. Cleanup stopped.');add(targets,'order_id',[legacyPreviewOrder]);}
 const testOrders=await db.prepare("SELECT id FROM orders WHERE payment_environment IN ('test','sandbox')").all<{id:string}>();add(targets,'order_id',testOrders.results.map(r=>r.id));
 // Resolve parent IDs before deletion. This also covers test orders on a real listing.
 for(let pass=0;pass<4;pass++)for(const [table,key] of Object.entries(primary)){
  if(table==='attendee_profiles'||table==='attendee_recovery_grants'||!tables[table])continue;
  const rows=await db.prepare(`SELECT * FROM ${table} WHERE ${condition(table,tables[table],targets)}`).all<Record<string,unknown>>();
  add(targets,key,rows.results.map(r=>r.id));
  if(table==='curated_event_records')add(targets,'submission_id',rows.results.map(r=>r.submission_id));
  if(table==='orders')add(targets,'reference',rows.results.flatMap(r=>[r.reference,r.provider_reference,r.paystack_reference]));
 }
 const runs=await db.prepare(`SELECT DISTINCT run_id FROM reconciliation_entries WHERE ${condition('reconciliation_entries',tables.reconciliation_entries,targets)}`).all<{run_id:string}>();
 for(const run of runs.results){const other=await db.prepare(`SELECT 1 FROM reconciliation_entries WHERE run_id=? AND NOT ${condition('reconciliation_entries',tables.reconciliation_entries,targets)} LIMIT 1`).bind(run.run_id).first();if(!other)add(targets,'run_id',[run.run_id]);}
 const customerProfiles=await db.prepare(`SELECT id FROM attendee_profiles WHERE normalized_email IN (SELECT LOWER(customer_email) FROM orders WHERE ${condition('orders',tables.orders,targets)})`).all<{id:string}>();
 const candidateIds:string[]=customerProfiles.results.map(row=>row.id);
 for(const [table,cols] of Object.entries(tables))if(cols.includes('attendee_id')&&condition(table,cols,targets)!=='0'){
  const rows=await db.prepare(`SELECT DISTINCT attendee_id AS id FROM ${table} WHERE ${condition(table,cols,targets)}`).all<{id:string}>();candidateIds.push(...rows.results.map(r=>r.id));
 }
 // Keep shared customer accounts if any real event, ticket, host or support relationship remains.
 const relationshipTables=['ticket_assignments','event_registrations','support_cases','attendee_event_decisions','attendee_event_preferences','attendee_host_follows','attendee_question_answers','attendee_notifications','notification_preferences','room_flashes','room_suspensions','vip_concierge_requests'];
 for(const id of new Set(candidateIds.filter(Boolean))){
  const profile=await db.prepare('SELECT normalized_email FROM attendee_profiles WHERE id=?').bind(id).first<{normalized_email:string}>();
  let shared=false;
  if(profile){
   const related=await db.prepare(`SELECT 1 FROM orders WHERE LOWER(customer_email)=? AND NOT ${condition('orders',tables.orders,targets)} UNION ALL SELECT 1 FROM event_registrations WHERE normalized_email=? AND NOT ${condition('event_registrations',tables.event_registrations,targets)} UNION ALL SELECT 1 FROM event_audience_contacts WHERE email=? AND NOT ${condition('event_audience_contacts',tables.event_audience_contacts,targets)} LIMIT 1`).bind(profile.normalized_email,profile.normalized_email,profile.normalized_email).first();
   if(related)continue;
  }
  for(const table of relationshipTables){const other=await db.prepare(`SELECT 1 FROM ${table} WHERE attendee_id=? AND NOT ${condition(table,tables[table],targets)} LIMIT 1`).bind(id).first();if(other){shared=true;break;}}
  if(!shared){add(targets,'attendee_id',[id]);if(profile)add(targets,'orphan_email',[profile.normalized_email]);}
 }
 const grants=await db.prepare(`SELECT id FROM attendee_recovery_grants WHERE ${inside('normalized_email',targets.orphan_email??[])}`).all<{id:string}>();add(targets,'recovery_grant_id',grants.results.map(r=>r.id));
 add(targets,'subject_id',[...(targets.order_id??[]),...(targets.registration_id??[]),...(targets.attendee_id??[]),...(targets.submission_id??[])]);
 // The converted listing keeps its current Room and settings. Only pre-publication content is removed.
 const extraPreviewRooms=[convertedSlug];
 const counts:Record<string,number>={};
 for(const [table,cols] of Object.entries(tables)){const where=condition(table,cols,targets);if(where==='0')continue;const row=await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).first<{count:number}>();if(row?.count)counts[table]=row.count;}
 return {targets,tables,counts,extraPreviewRooms};
}
export async function runPreviewCleanup(env:Pick<Cloudflare.Env,'DB'|'THE_ROOM'>) {
 const job=await env.DB.prepare('SELECT outcome,detail FROM operational_audit_events WHERE id=?').bind(previewCleanupId).first<{outcome:string;detail:string|null}>();
 if(!job||job.outcome==='success')return;
 if(!['pending','running'].includes(job.outcome))throw new Error('Preview cleanup is not authorised.');
 const plan:Plan=job.outcome==='running'?JSON.parse(job.detail??'{}'):await planPreviewCleanup(env.DB);
 if(!plan.targets||plan.targets.event_slug.join(',')!==retired.join(','))throw new Error('Cleanup manifest is invalid.');
 // Keep IDs until both storage systems finish so a retry can finish an interrupted removal.
 await env.DB.prepare("UPDATE operational_audit_events SET outcome='running',detail=? WHERE id=?").bind(JSON.stringify(plan),previewCleanupId).run();
 await env.DB.batch(retired.map(slug=>env.DB.prepare("UPDATE curated_event_records SET status='unpublished',removed_at=COALESCE(removed_at,?) WHERE slug=?").bind(new Date().toISOString(),slug)));
 for(const slug of retired)await env.THE_ROOM.getByName(slug).removeEventContent();
 for(const slug of plan.extraPreviewRooms??[]){if(slug!==convertedSlug)throw new Error('Unknown converted preview Room.');await env.THE_ROOM.getByName(slug).removePreviewContentBefore(convertedAt);}
 const statements=[];
 for(const [table,cols] of Object.entries(plan.tables)){
  const where=condition(table,cols,plan.targets);if(where==='0')continue;
  statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE ${where}${table==='operational_audit_events'?' AND id<>?':''}`).bind(...(table==='operational_audit_events'?[previewCleanupId]:[])));
 }
 statements.push(env.DB.prepare("UPDATE operational_audit_events SET outcome='success',detail=? WHERE id=?").bind(JSON.stringify({removed:plan.counts,roomStores:retired.length+(plan.extraPreviewRooms?.length??0)}),previewCleanupId));
 await env.DB.batch(statements);
 return plan.counts;
}
