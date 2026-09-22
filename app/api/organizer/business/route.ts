import { saveOrganizerTier } from '../../../../lib/organizer-inventory';
import { mutationHasValidOrigin, recordAudit, requestMetadata } from '../../../../lib/admin-session';
import { csvResponse, OrganizerError, organizerScope, organizerSession, privateHeaders, requireOrganizerEvent, textInput } from '../../../../lib/organizer-access';
import { listOrganizerEvents,readMoney,readGuests,guestDetails,readAudience } from '../../../../lib/organizer-records';
import { createCoupon,couponUsage,managePromoter,listPromoterReports } from '../../../../lib/organizer-promotions';
import { readTeam,inviteTeam,revokeTeam } from '../../../../lib/organizer-team';
import { duplicateEvent,issueComplimentary,saveDraft,saveQuestion } from '../../../../lib/organizer-events';
import { issueRecoveryGrant } from '../../../../lib/email-delivery';
import { enforceRateLimit } from '../../../../lib/security-controls';

function failure(error:unknown){return Response.json({error:error instanceof OrganizerError?error.message:'This action could not be completed. Please try again.'},{status:error instanceof OrganizerError?error.status:500,headers:privateHeaders});}
export async function GET(request:Request){
  try{
    const {env}=await import('cloudflare:workers'),session=await organizerSession(request,env.DB),db=env.DB;
    if(!await enforceRateLimit(env.PAYMENT_NETWORK_RATE_LIMITER,`organizer-read:${session.accountId}`))throw new OrganizerError('Give it a minute and try again.',429);
    const p=new URL(request.url).searchParams,section=p.get('section')??'events',slug=p.get('event')??'all',format=p.get('format');
    let result:object;
    if(section==='events')result={events:await listOrganizerEvents(db,session)};
    else if(section==='submissions'){
      const scope=organizerScope(session,'linked');
      result={submissions:(await db.prepare(`SELECT s.id,s.title,s.status,s.review_note AS reviewNote,s.created_at AS createdAt,s.event_slug AS eventSlug FROM party_submissions s WHERE (?='owner' OR lower(trim(s.contact_email))=?) AND (s.event_slug IS NULL OR EXISTS(SELECT 1 FROM curated_event_records linked WHERE linked.slug=s.event_slug AND ${scope.sql})) AND NOT EXISTS (SELECT 1 FROM curated_event_records e WHERE e.submission_id=s.id AND e.removed_at IS NOT NULL) ORDER BY s.created_at DESC LIMIT 250`).bind(session.role,session.email,...scope.bindings).all()).results};
    }else if(section==='money'){
      const data=await readMoney(db,session,slug);
      if(format==='csv')return csvResponse([['Statement','Event','Period start','Period end','Gross (GHS minor)','Fees (GHS minor)','Refunds (GHS minor)','Net ticket sales (GHS minor)','Status'],...data.statements.map(x=>[x.id,x.eventTitle,x.periodStart,x.periodEnd,x.grossMinor,x.feesMinor,x.refundsMinor,x.netMinor,x.status])],'becore-statements');
      result=data;
    }else if(section==='guests'){
      const data=await readGuests(db,session,slug,p);
      if(format==='csv')return csvResponse([['Name','Email','Reference','Source','Status','Admissions','Arrived'],...data.rows.map(x=>[x.name,x.email,x.reference,x.source,x.status,x.admissions,x.arrivals])],'becore-guests');
      result=data;
    }else if(section==='guest_detail')result=await guestDetails(db,session,slug,p.get('kind')??'',p.get('id')??'');
    else if(section==='audience'){
      const data=await readAudience(db,session,p);
      if(format==='csv')return csvResponse([['Name','Email','Events','VIP','Subscribed to an event','Last booking'],...data.rows.map(x=>[x.name,x.email,x.events,x.vip,x.subscribed,x.lastSeen])],'becore-audience');
      result=data;
    }else if(section==='audience_history'){
      const scope=organizerScope(session),email=(p.get('email')??'').trim().toLowerCase();
      const rows=await db.prepare(`SELECT e.slug,e.title,o.created_at AS bookedAt,o.status,o.payment_provider AS source,o.quantity AS admissions,o.total_amount_minor AS amountMinor FROM orders o JOIN curated_event_records e ON e.slug=o.event_slug WHERE e.removed_at IS NULL AND ${scope.sql} AND lower(o.customer_email)=?
        UNION ALL SELECT e.slug,e.title,r.created_at,r.status,r.kind,r.party_size,0 FROM event_registrations r JOIN curated_event_records e ON e.slug=r.event_slug WHERE e.removed_at IS NULL AND ${scope.sql} AND r.normalized_email=? AND r.status<>'unverified' ORDER BY bookedAt DESC LIMIT 100`).bind(...scope.bindings,email,...scope.bindings,email).all();
      result={rows:rows.results};
    }else if(section==='team')result=await readTeam(db,session,slug);
    else{
      await requireOrganizerEvent(db,session,slug);
      if(section==='promote'){
        const coupons=await db.prepare(`SELECT c.id,c.code,c.kind,c.value,c.max_uses AS maxUses,c.status,c.starts_at AS startsAt,c.expires_at AS expiresAt,c.ticket_tier_id AS tierId,${couponUsage} AS used FROM event_coupons c WHERE c.event_slug=? ORDER BY c.created_at DESC LIMIT 250`).bind(new Date().toISOString(),slug).all();
        result={coupons:coupons.results,promoters:await listPromoterReports(db,slug)};
      }else if(section==='questions')result={questions:(await db.prepare(`SELECT id,prompt,kind,options_json AS optionsJson,required,sort_order AS sortOrder,status,(SELECT COUNT(*) FROM attendee_question_answers a WHERE a.question_id=q.id) AS answerCount FROM event_questions q WHERE event_slug=? ORDER BY sort_order,created_at`).bind(slug).all()).results};
      else if(section==='tickets')result={tiers:(await db.prepare(`SELECT t.id,t.code,t.name,t.description,t.max_units_per_order AS maxUnitsPerOrder,t.room_badge AS roomBadge,t.updated_at AS updatedAt,EXISTS(SELECT 1 FROM inventory_reservations history WHERE history.ticket_tier_id=t.id) AS hasHistory,t.price_minor AS priceMinor,t.capacity_admissions AS capacity,t.admissions_per_unit AS admissionsPerUnit,t.status,COALESCE((SELECT SUM(r.admission_count) FROM inventory_reservations r WHERE r.ticket_tier_id=t.id AND (r.status='consumed' OR (r.status='held' AND r.expires_at>?))),0) AS allocated FROM event_ticket_tiers t WHERE t.event_slug=? ORDER BY t.sort_order`).bind(new Date().toISOString(),slug).all()).results};
      else if(section==='draft')result={draft:await db.prepare('SELECT title,venue,lineup,tagline,starts_at AS startsAt,ends_at AS endsAt FROM curated_event_records WHERE slug=?').bind(slug).first()};
      else throw new OrganizerError('Page not found.',404);
    }
    if(format==='csv')throw new OrganizerError('This report has no CSV export.');
    return Response.json(result,{headers:privateHeaders});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  if(!mutationHasValidOrigin(request))return Response.json({error:'Request not accepted.'},{status:403,headers:privateHeaders});
  try{
    const {env}=await import('cloudflare:workers'),session=await organizerSession(request,env.DB),db=env.DB;
    if(!await enforceRateLimit(env.PAYMENT_NETWORK_RATE_LIMITER,`organizer-write:${session.accountId}`))throw new OrganizerError('Give it a minute and try again.',429);
    const raw=await request.text();if(raw.length>16000)throw new OrganizerError('This request is too large.',413);
    let b:Record<string,unknown>;try{b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();}catch{throw new OrganizerError('Send valid details.');}
    const action=textInput(b.action,'action',50);let result:object;
    if(action==='coupon_create')result=await createCoupon(db,session,b);
    else if(action==='coupon_status'){
      const e=await requireOrganizerEvent(db,session,b.eventSlug);if(!['active','disabled'].includes(String(b.status)))throw new OrganizerError('Choose a coupon status.');
      await db.prepare('UPDATE event_coupons SET status=? WHERE id=? AND event_slug=?').bind(b.status,textInput(b.id,'coupon',120),e.slug).run();result={saved:true};
    }else if(action.startsWith('promoter_'))result=await managePromoter(db,session,b);
    else if(action==='team_invite')result=await inviteTeam(db,session,b);
    else if(action==='team_remove'||action==='team_revoke_invite')result=await revokeTeam(db,session,b);
    else if(action==='duplicate')result=await duplicateEvent(db,session,b);
    else if(action==='complimentary')result=await issueComplimentary(db,session,b);
    else if(action==='draft_save'||action==='draft_submit')result=await saveDraft(db,session,b);
    else if(action==='ticket_save')result=await saveOrganizerTier(db,session,b);
    else if(action==='question_save')result=await saveQuestion(db,session,b);
    else if(action==='guest_recovery'){
      const e=await requireOrganizerEvent(db,session,b.eventSlug),ticketId=textInput(b.ticketId,'ticket',120);
      const recipient=await db.prepare(`SELECT CASE WHEN a.status='active' AND p.status='active' THEN p.normalized_email WHEN a.ticket_id IS NULL THEN lower(o.customer_email) END AS email FROM tickets t JOIN orders o ON o.id=t.order_id LEFT JOIN ticket_assignments a ON a.ticket_id=t.id LEFT JOIN attendee_profiles p ON p.id=a.attendee_id WHERE t.id=? AND t.event_slug=? AND t.status IN ('issued','checked_in') AND o.status='paid'`).bind(ticketId,e.slug).first<{email:string|null}>();
      if(!recipient?.email)throw new OrganizerError('This pass has no active holder to contact.',409);
      if(!await enforceRateLimit(env.LOGIN_RATE_LIMITER,`host-recovery:${recipient.email}`))throw new OrganizerError('A link was requested recently. Give it a minute.',429);
      const sent=await issueRecoveryGrant({db,normalizedEmail:recipient.email,origin:new URL(request.url).origin,kind:'ticket_recovery'});
      result={queued:true,sent:sent.sent};
    }else throw new OrganizerError('Choose a valid action.');
    await recordAudit(db,{session,action:`organizer.${action}`,targetType:'event',targetId:String(b.eventSlug),outcome:'success',requestId:requestMetadata(request).requestId});
    return Response.json(result,{headers:privateHeaders});
  }catch(error){return failure(error);}
}
