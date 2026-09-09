import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Owner-requested, one-time configuration. Later releases must preserve edits.
export const requestId='operator:braai-rsvp-2026-09-10';
export function braaiRsvpStatements(now=new Date().toISOString()) {
 const slug='the-weekend-braai',start='2026-09-20T14:00:00.000Z',deadline='2026-09-20T00:00:00.000Z';
 return [
  {sql:`INSERT INTO operational_audit_events(id,actor_role,action,target_type,target_id,outcome,detail,created_at)
    SELECT ?,'system','registrations.settings','event',e.slug,'pending',
      'Owner-requested free RSVP; capacity 100; approval required; deadline 2026-09-20T00:00:00.000Z. Previous settings: ' ||
      COALESCE((SELECT json_object('mode',mode,'capacity',capacity,'approvalRequired',approval_required,'accepting',accepting,'closesAt',closes_at) FROM event_registration_settings WHERE event_slug=e.slug),'none'),?
    FROM curated_event_records e WHERE e.slug=? AND e.starts_at=? AND e.status='published' AND e.removed_at IS NULL
      AND e.schedule_status IN ('confirmed','end_pending') AND e.event_state IN ('on_sale','sold_out','rescheduled') AND ? < ?
      AND NOT EXISTS(SELECT 1 FROM orders WHERE event_slug=e.slug AND payment_provider<>'rsvp' AND status IN ('paid','payment_pending'))
      AND (SELECT COALESCE(SUM(party_size),0) FROM event_registrations WHERE event_slug=e.slug AND status='confirmed')<=100
    ON CONFLICT(id) DO NOTHING`,params:[requestId,now,slug,start,now,deadline]},
  {sql:`INSERT INTO event_registration_settings(event_slug,mode,capacity,max_party_size,approval_required,room_access,accepting,closes_at,notify_host,updated_at)
    SELECT ?,'rsvp',100,COALESCE(s.max_party_size,1),1,COALESCE(s.room_access,0),1,?,COALESCE(s.notify_host,1),?
    FROM operational_audit_events a LEFT JOIN event_registration_settings s ON s.event_slug=a.target_id
    WHERE a.id=? AND a.outcome='pending' AND a.created_at=?
    ON CONFLICT(event_slug) DO UPDATE SET mode='rsvp',capacity=100,approval_required=1,accepting=1,closes_at=excluded.closes_at,updated_at=excluded.updated_at`,params:[slug,deadline,now,requestId,now]},
  {sql:`UPDATE event_registrations SET status='requested',version=version+1,updated_at=? WHERE event_slug=? AND status='waitlisted' AND approved_at IS NULL
    AND EXISTS(SELECT 1 FROM operational_audit_events WHERE id=? AND outcome='pending' AND created_at=?)`,params:[now,slug,requestId,now]},
  {sql:`UPDATE operational_audit_events SET outcome='success' WHERE id=? AND outcome='pending' AND created_at=?
    AND EXISTS(SELECT 1 FROM event_registration_settings WHERE event_slug=? AND mode='rsvp' AND capacity=100 AND approval_required=1 AND accepting=1 AND closes_at=? AND updated_at=?)`,params:[requestId,now,slug,deadline,now]},
 ];
}

async function main(){
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const databaseId=config.d1_databases?.find(binding=>binding.binding==='DB')?.database_id;
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!databaseId||!account||!token)throw new Error('Production database access is not configured.');
 const query=async body=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok||!data.success||!data.result?.length||data.result.some(item=>!item.success))throw new Error('RSVP configuration database operation failed.');
  return data.result;
 };
 const existing=await query({sql:'SELECT outcome FROM operational_audit_events WHERE id=?',params:[requestId]});
 if(existing[0].results?.[0]?.outcome==='success'){console.log(JSON.stringify({braaiRsvp:'already_configured'}));return;}
 await query({batch:braaiRsvpStatements()});
 const result=await query({sql:`SELECT s.mode,s.capacity,s.approval_required AS approvalRequired,s.closes_at AS closesAt,s.accepting,a.outcome
  FROM event_registration_settings s JOIN operational_audit_events a ON a.target_id=s.event_slug WHERE a.id=?`,params:[requestId]});
 const settings=result[0].results?.[0];
 if(settings?.outcome!=='success')throw new Error('Event schedule or existing bookings prevented the requested RSVP setup. No booking was removed.');
 console.log(JSON.stringify({braaiRsvp:'configured',...settings,url:'https://tickets.becoreops.com/rsvp/the-weekend-braai'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
