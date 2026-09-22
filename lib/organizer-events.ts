import { hashToken, type AdminSession } from './admin-session';
import { dateInput, emailInput, integerInput, OrganizerError, requireOrganizerEvent, textInput } from './organizer-access';
import { rememberEventContact } from './event-audience';
import { organizerPolicyKeys,recordPolicyConsents } from './policies';
import { normalizeEventTagline, assertOriginalEventTagline } from './event-copy';

async function previousMutation(db:D1Database, session:AdminSession, key:string, slug:string, kind:string, payloadHash:string) {
  const previous=await db.prepare('SELECT actor_id AS actorId,event_slug AS eventSlug,kind,payload_hash AS payloadHash,result_id AS resultId FROM organizer_mutations WHERE id=?').bind(key).first<{actorId:string;eventSlug:string;kind:string;payloadHash:string;resultId:string}>();
  if(previous&&(previous.actorId!==session.accountId||previous.eventSlug!==slug||previous.kind!==kind||previous.payloadHash!==payloadHash))throw new OrganizerError('This request changed. Start a new request.',409);
  return previous?.resultId;
}
function mutationKey(value:unknown){const id=textInput(value,'request ID',80);if(!/^[a-zA-Z0-9_-]{16,80}$/u.test(id))throw new OrganizerError('Invalid request ID.');return id;}

export async function issueComplimentary(db:D1Database,session:AdminSession,b:Record<string,unknown>) {
  const e=await requireOrganizerEvent(db,session,b.eventSlug),key=mutationKey(b.mutationId),email=emailInput(b.email),name=textInput(b.name,'guest name',100),tierId=textInput(b.tierId,'ticket type',120),quantity=integerInput(b.quantity,'admissions',1,20);
  const payloadHash=await hashToken(JSON.stringify([email,name,tierId,quantity]));
  const previous=await previousMutation(db,session,key,e.slug,'complimentary',payloadHash);
  if(previous)return {reference:previous,replayed:true};
  const now=new Date().toISOString(),id=crypto.randomUUID(),reference=`COMP-${id.slice(0,13).toUpperCase()}`;
  // Each recipient is one transaction. A retry can never consume inventory twice.
  const results=await db.batch([
    db.prepare(`INSERT INTO inventory_reservations(order_id,event_slug,ticket_tier_id,unit_quantity,admission_count,status,expires_at,created_at,updated_at)
      SELECT ?,e.slug,t.id,?,?, 'consumed',?,?,? FROM event_ticket_tiers t JOIN curated_event_records e ON e.slug=t.event_slug
      WHERE e.slug=? AND t.id=? AND e.removed_at IS NULL AND e.status IN ('published','scheduled') AND e.event_state NOT IN ('cancelled','postponed') AND e.ends_at>?
        AND NOT EXISTS (SELECT 1 FROM organizer_mutations WHERE id=?) AND (SELECT COALESCE(SUM(r.admission_count),0) FROM inventory_reservations r WHERE r.ticket_tier_id=t.id AND (r.status='consumed' OR (r.status='held' AND r.expires_at>?)))+?<=t.capacity_admissions`)
      .bind(id,quantity,quantity,now,now,now,e.slug,tierId,now,key,now,quantity),
    db.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,ticket_tier_id,unit_quantity,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,customer_name,payment_channel,payment_provider,status,created_at,paid_at)
      SELECT r.order_id,?,r.event_slug,t.code,t.id,r.unit_quantity,r.admission_count,0,0,0,'GHS',?,'',?,'complimentary','complimentary','paid',?,?
      FROM inventory_reservations r JOIN event_ticket_tiers t ON t.id=r.ticket_tier_id WHERE r.order_id=?`).bind(reference,email,name,now,now,id),
    ...Array.from({length:quantity},(_,i)=>{const ticketId=crypto.randomUUID();return db.prepare(`INSERT INTO tickets(id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at)
      SELECT ?,id,event_slug,ticket_type,?,?,'issued',? FROM orders WHERE id=?`).bind(ticketId,i+1,`unissued-${ticketId}`,now,id);}),
    db.prepare(`INSERT INTO confirmation_deliveries(id,order_id,created_at) SELECT 'payment-confirmation/'||id,id,? FROM orders WHERE id=?`).bind(now,id),
    db.prepare(`INSERT INTO organizer_mutations(id,actor_id,event_slug,kind,payload_hash,result_id,created_at) SELECT ?,?,event_slug,'complimentary',?,reference,? FROM orders WHERE id=?`).bind(key,session.accountId,payloadHash,now,id),
  ]);
  if(results[0].meta.changes!==1){
    const replay=await previousMutation(db,session,key,e.slug,'complimentary',payloadHash);
    if(replay)return {reference:replay,replayed:true};
    throw new OrganizerError('There is not enough admission capacity, or this event is not open for complimentary passes.',409);
  }
  await rememberEventContact(db,{eventSlug:e.slug,email,guestName:name,source:'complimentary'});
  return {reference,queued:true};
}

export async function duplicateEvent(db:D1Database,session:AdminSession,b:Record<string,unknown>){
  const e=await requireOrganizerEvent(db,session,b.eventSlug),key=mutationKey(b.mutationId),title=textInput(b.title,'event title',120,3),startsAt=dateInput(b.startsAt,'start time'),endsAt=dateInput(b.endsAt,'end time');
  if(startsAt<=new Date().toISOString()||endsAt<=startsAt)throw new OrganizerError('Choose a future start and an end after it.');
  const payloadHash=await hashToken(JSON.stringify([title,startsAt,endsAt]));
  const previous=await previousMutation(db,session,key,e.slug,'duplicate',payloadHash);if(previous)return {eventSlug:previous,replayed:true};
  const id=crypto.randomUUID(),slug=`${title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').replace(/[^a-z0-9]+/gu,'-').replace(/^-|-$/gu,'').slice(0,58)||'night'}-${id.slice(0,8)}`,now=new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO organizer_mutations(id,actor_id,event_slug,kind,payload_hash,result_id,created_at) VALUES (?,?,?,'duplicate',?,?,?)`).bind(key,session.accountId,e.slug,payloadHash,slug,now),
    db.prepare(`INSERT INTO party_submissions(id,organizer_name,contact_name,contact_email,contact_phone,title,concept,venue_name,venue_map_url,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,age_restriction,status,event_slug,created_at,updated_at)
      SELECT ?,COALESCE(s.organizer_name,?),?,?,'',?,COALESCE(s.concept,e.curation_note),e.venue,e.venue_map_url,e.area,?,?,e.vibe,e.lineup,e.capacity,e.price_from_minor,e.age_restriction,'draft',?,?,?
      FROM curated_event_records e LEFT JOIN party_submissions s ON s.id=e.submission_id WHERE e.slug=? AND EXISTS (SELECT 1 FROM organizer_mutations WHERE id=? AND result_id=?)`)
      .bind(id,session.actor,session.actor,session.email,title,startsAt,endsAt,slug,now,now,e.slug,key,slug),
    db.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,venue_map_url,area,starts_at,ends_at,vibe,price_from_minor,capacity,sales_open_at,sales_close_at,age_restriction,lineup,image_url,curation_note,status,created_at,updated_at,organizer_owner_id,is_test_event)
      SELECT ?,?,?,?,venue,venue_map_url,area,?,?,vibe,price_from_minor,capacity,?,?,age_restriction,lineup,image_url,'','draft',?,?,?,is_test_event FROM curated_event_records WHERE slug=? AND EXISTS (SELECT 1 FROM party_submissions WHERE id=?)`)
      .bind(id,id,slug,title,startsAt,endsAt,now,startsAt,now,now,session.accountId,e.slug,id),
    db.prepare(`INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,sales_open_at,sales_close_at,sort_order,created_at,updated_at)
      SELECT ?||':'||code,?,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,CASE WHEN status='hidden' THEN 'hidden' ELSE 'available' END,?,?,sort_order,?,?
      FROM event_ticket_tiers WHERE event_slug=? AND EXISTS (SELECT 1 FROM party_submissions WHERE id=?)`).bind(id,slug,now,startsAt,now,now,e.slug,id),
    db.prepare(`INSERT INTO event_questions(id,event_slug,prompt,kind,options_json,required,sort_order,status,created_at) SELECT lower(hex(randomblob(16))),?,prompt,kind,options_json,required,sort_order,status,? FROM event_questions WHERE event_slug=? AND EXISTS (SELECT 1 FROM party_submissions WHERE id=?)`).bind(slug,now,e.slug,id),
    db.prepare(`INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM party_submissions WHERE id=?)`).bind(session.accountId,slug,session.accountId,now,id),
    db.prepare(`INSERT INTO event_registration_settings(event_slug,mode,accepting,capacity,approval_required,max_party_size,room_access,closes_at,updated_at)
      SELECT ?,mode,0,capacity,approval_required,max_party_size,room_access,?,? FROM event_registration_settings WHERE event_slug=? AND EXISTS (SELECT 1 FROM party_submissions WHERE id=?)`).bind(slug,startsAt,now,e.slug,id),
  ]);
  const actual=await previousMutation(db,session,key,e.slug,'duplicate',payloadHash);
  return {eventSlug:actual};
}
export async function saveDraft(db:D1Database,session:AdminSession,b:Record<string,unknown>){
  const e=await requireOrganizerEvent(db,session,b.eventSlug);
  if(e.status!=='draft')throw new OrganizerError('Only an unpublished draft can be edited here.',409);
  const title=textInput(b.title,'title',120,3),startsAt=dateInput(b.startsAt,'start'),endsAt=dateInput(b.endsAt,'end'),venue=textInput(b.venue,'venue',160,2),lineup=textInput(b.lineup,'line-up',1000,2),now=new Date().toISOString();
  let tagline:string|null;try{tagline=normalizeEventTagline(b.tagline,b.action==='draft_submit');await assertOriginalEventTagline(db,tagline,e.slug);}catch(error){if(error instanceof Error&&/^(Write an original|That line already)/u.test(error.message))throw new OrganizerError(error.message);throw error;}
  if(startsAt<=now||endsAt<=startsAt)throw new OrganizerError('Choose a future start and an end after it.');

  if(b.action==='draft_submit'&&b.acceptedPolicies!==true)throw new OrganizerError('Confirm the event details and host terms before submitting.');
  if(b.action==='draft_submit'){const submission=await db.prepare('SELECT submission_id AS id FROM curated_event_records WHERE slug=?').bind(e.slug).first<{id:string}>();await recordPolicyConsents({db,subjectType:'organizer_submission',subjectId:submission!.id,policyKeys:organizerPolicyKeys,actorEmail:session.email,acceptedAt:now});}
  const statuses=b.action==='draft_submit'?['unpublished','submitted']:['draft','draft'];
  await db.batch([
    db.prepare(`UPDATE curated_event_records SET title=?,starts_at=?,ends_at=?,sales_close_at=?,venue=?,lineup=?,tagline=?,status=?,updated_at=? WHERE slug=? AND status='draft'`).bind(title,startsAt,endsAt,startsAt,venue,lineup,tagline,statuses[0],now,e.slug),
    db.prepare(`UPDATE party_submissions SET title=?,starts_at=?,ends_at=?,venue_name=?,lineup=?,tagline=?,status=?,updated_at=? WHERE event_slug=? AND status='draft'`).bind(title,startsAt,endsAt,venue,lineup,tagline,statuses[1],now,e.slug),
    db.prepare(`UPDATE event_ticket_tiers SET sales_close_at=?,updated_at=? WHERE event_slug=?`).bind(startsAt,now,e.slug),
  ]);
  return {saved:true,submitted:b.action==='draft_submit'};
}
export async function saveQuestion(db:D1Database,session:AdminSession,b:Record<string,unknown>){
  const e=await requireOrganizerEvent(db,session,b.eventSlug),id=b.id?textInput(b.id,'question ID',200):crypto.randomUUID();
  if(b.id&&!await db.prepare('SELECT 1 FROM event_questions WHERE id=? AND event_slug=?').bind(id,e.slug).first())throw new OrganizerError('Question not found.',404);
  const prompt=textInput(b.prompt,'question',300,3),kind=b.kind,status=b.status,sort=integerInput(b.sortOrder,'position',0,100);
  if(!['text','choice'].includes(String(kind))||!['active','closed'].includes(String(status)))throw new OrganizerError('Choose a question type and status.');
  const options=kind==='choice'&&Array.isArray(b.options)?b.options.map(x=>textInput(x,'answer option',120)):[];
  if(kind==='choice'&&(options.length<2||options.length>20||new Set(options.map(x=>x.toLowerCase())).size!==options.length))throw new OrganizerError('Add 2–20 different answer options.');
  // Existing responses keep their original question and options. Close it and add a new question to change meaning.
  const answered=b.id?await db.prepare('SELECT 1 FROM attendee_question_answers WHERE question_id=? LIMIT 1').bind(id).first():null;
  if(answered){
    const old=await db.prepare('SELECT prompt,kind,options_json AS optionsJson FROM event_questions WHERE id=?').bind(id).first<{prompt:string;kind:string;optionsJson:string|null}>();
    if(old?.prompt!==prompt||old.kind!==kind||JSON.stringify(JSON.parse(old.optionsJson||'[]'))!==JSON.stringify(options))throw new OrganizerError('This question already has answers. Close it and add a new question to change its wording or options.',409);
  }
  if(!b.id&&(await db.prepare('SELECT COUNT(*) AS n FROM event_questions WHERE event_slug=?').bind(e.slug).first<{n:number}>())!.n>=100)throw new OrganizerError('This event already has 100 questions. Edit an existing question.');
  await db.prepare(`INSERT INTO event_questions(id,event_slug,prompt,kind,options_json,required,sort_order,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt,kind=excluded.kind,options_json=excluded.options_json,required=excluded.required,sort_order=excluded.sort_order,status=excluded.status`)
    .bind(id,e.slug,prompt,kind,JSON.stringify(options),b.required===true?1:0,sort,status,new Date().toISOString()).run();
  return {id};
}
