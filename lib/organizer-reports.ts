import { emailBrand } from './email-brand';
import { hostScope, readHostSummary, type HostSummary } from './host-summary';

const origin='https://tickets.becoreops.com';
const htmlEscape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const money=(n:number)=>new Intl.NumberFormat('en-GH',{style:'currency',currency:'GHS',minimumFractionDigits:2}).format(n/100);
export function hostReportEmail(name:string,kind:'weekly'|'recap',summaries:HostSummary[],asOf:string) {
  const heading=kind==='recap'?'The night, by the numbers.':'Your nights. The latest numbers.';
  const date=new Date(asOf).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Accra'});
  const rows=summaries.map(s=>{
    const sources=s.rsvp.sources.slice(0,5).map(x=>`${x.label}: ${x.requests} RSVP requests (${x.confirmedGuests} confirmed guests)`);
    const paid=s.paidSources.map(x=>`${x.code ? `Promoter ${x.code}` : 'Untracked'}: ${x.orders} paid orders`);
    const stats=[`${s.rsvp.totals.requests} RSVP requests · ${s.rsvp.totals.confirmedGuests} confirmed RSVP guests`,`${s.pending} requests waiting for your approval`,`${s.interest} people on the email list (not admissions)`,`${s.sales.orders} paid orders · ${money(s.sales.ticketSalesMinor)} ticket sales`,`${s.checkedIn} of ${s.expected} expected guests checked in${s.turnoutPercent===null?'':` · ${s.turnoutPercent}% turnout`}`];
    const url=`${origin}/organizer/analytics?event=${encodeURIComponent(s.event.slug)}&range=all`;
    return {text:`${s.event.title}\n${stats.join('\n')}\n${[...sources,...paid].join('\n')}\nOpen analytics: ${url}`,
      html:`<section style="padding:24px 0;border-top:1px solid #d9cfdc"><h2 style="font-size:22px;margin:0 0 16px">${htmlEscape(s.event.title)}</h2>${stats.map(x=>`<p style="margin:8px 0">${htmlEscape(x)}</p>`).join('')}${sources.length||paid.length?`<h3 style="font-size:16px;margin:20px 0 8px">Where guests found you</h3>${[...sources,...paid].map(x=>`<p style="margin:6px 0">${htmlEscape(x)}</p>`).join('')}`:''}<p style="margin-top:22px"><a href="${htmlEscape(url)}" style="color:#6a3d65;font-weight:700">Open event analytics →</a></p></section>`};
  });
  const note='Totals cover the whole event as recorded at the time above. Ticket sales exclude booking fees and are not a payout statement. Cancelled and refunded orders are excluded; turnout uses recorded arrivals. Source counts describe tracked links, not proof that a post caused a booking.';
  return {subject:kind==='recap'?`Your event recap · ${summaries[0]?.event.title ?? 'BeCore Tickets'}`:'Your weekly host roundup · BeCore Tickets',
    text:`${heading}\nHi ${name},\nAs of ${date} (Accra time).\n\n${rows.map(x=>x.text).join('\n\n')}\n\n${note}\nManage email reports: ${origin}/organizer/workspace#email-reports`,
    html:`<div style="background:#faf5ee;color:#281b2b;padding:28px 20px;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:600px;margin:auto">${emailBrand}<h1 style="font-size:28px;line-height:1.2;margin:28px 0 16px">${heading}</h1><p>Hi ${htmlEscape(name)},</p><p>As of ${htmlEscape(date)} (Accra time).</p>${rows.map(x=>x.html).join('')}<p style="font-size:13px">${note}</p><p><a href="${origin}/organizer/workspace#email-reports" style="color:#6a3d65">Manage email reports</a></p></div></div>`};
}

export async function reportDeliveryAllowed(db:D1Database,id:string|null,recipient:string,now=new Date().toISOString()) {
  const report=await db.prepare(`SELECT r.event_slugs_json AS slugs FROM organizer_reports r JOIN staff_accounts a ON a.id=r.account_id
    LEFT JOIN organizer_report_preferences p ON p.account_id=a.id WHERE r.id=? AND r.recipient=? AND r.expires_at>?
    AND a.normalized_email=r.recipient AND a.role='organizer' AND a.status='active' AND a.must_change_password=0 AND COALESCE(p.enabled,1)=1
    AND NOT EXISTS (SELECT 1 FROM json_each(r.event_slugs_json) j WHERE NOT EXISTS
      (SELECT 1 FROM curated_event_records e WHERE e.slug=j.value AND e.removed_at IS NULL AND e.event_state<>'cancelled' AND ${hostScope}))`)
    .bind(id,recipient,now).first();
  return Boolean(report);
}

async function queueReport(db:D1Database,account:{id:string;email:string;name:string},kind:'weekly'|'recap',key:string,slugs:string[],now:string) {
  const summaries=(await Promise.all(slugs.map(slug=>readHostSummary(db,slug)))).filter((s):s is HostSummary=>Boolean(s));
  if(!summaries.length)return false;
  const id=crypto.randomUUID(),deliveryId=`organizer-report/${id}`;
  const email=hostReportEmail(account.name,kind,summaries,now);
  const expires=new Date(Date.parse(now)+24*60*60*1000).toISOString();
  const results=await db.batch([
    db.prepare(`INSERT OR IGNORE INTO organizer_reports(id,account_id,kind,period_key,recipient,event_slugs_json,created_at,expires_at)
      SELECT ?,id,?,?,?,?,?,? FROM staff_accounts a WHERE id=? AND normalized_email=? AND role='organizer' AND status='active' AND must_change_password=0
      AND NOT EXISTS (SELECT 1 FROM organizer_report_preferences p WHERE p.account_id=a.id AND p.enabled=0)`)
      .bind(id,kind,key,account.email,JSON.stringify(summaries.map(s=>s.event.slug)),now,expires,account.id,account.email),
    db.prepare(`INSERT INTO delivery_events(id,recovery_grant_id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at)
      SELECT ?,id,'organizer_report',recipient,'failed',0,?,?,?,? FROM organizer_reports WHERE id=?`)
      .bind(deliveryId,JSON.stringify({...email,idempotencyKey:deliveryId}),now,now,now,id),
  ]);
  return results[0].meta.changes===1;
}

/** Each run is durable and unique; a later cron continues remaining accounts. */
export async function processOrganizerReports(db:D1Database,clock=new Date()) {
  if(clock.getUTCHours()<8)return {queued:0};
  const now=clock.toISOString(),today=now.slice(0,10);
  const monday=new Date(clock);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));monday.setUTCHours(8,0,0,0);
  const week=monday.toISOString(),horizon=new Date(clock.getTime()+30*86400000).toISOString(),recent=new Date(clock.getTime()-7*86400000).toISOString();
  const eligible=`a.role='organizer' AND a.status='active' AND a.must_change_password=0 AND COALESCE(p.enabled,1)=1`;
  const activeEvents=`e.removed_at IS NULL AND e.status IN ('published','unpublished','scheduled') AND e.event_state<>'cancelled'`;
  const [weekly,recaps]=await Promise.all([
    db.prepare(`SELECT a.id,a.normalized_email AS email,a.display_name AS name FROM staff_accounts a LEFT JOIN organizer_report_preferences p ON p.account_id=a.id
      WHERE ${eligible} AND a.created_at<=? AND (SELECT started_at FROM organizer_report_rollout WHERE id=1)<=?
      AND NOT EXISTS(SELECT 1 FROM organizer_reports r WHERE r.account_id=a.id AND r.kind='weekly' AND r.period_key=?)
      AND EXISTS(SELECT 1 FROM curated_event_records e WHERE ${activeEvents} AND ${hostScope} AND e.ends_at>=? AND e.starts_at<=?) ORDER BY a.id LIMIT 1`)
      .bind(week,week,week,now,horizon).all<{id:string;email:string;name:string}>(),
    db.prepare(`SELECT a.id,a.normalized_email AS email,a.display_name AS name,e.slug FROM staff_accounts a
      JOIN curated_event_records e ON ${hostScope} LEFT JOIN organizer_report_preferences p ON p.account_id=a.id
      WHERE ${eligible} AND e.removed_at IS NULL AND e.status IN ('published','unpublished','archived') AND e.event_state<>'cancelled' AND e.schedule_status='confirmed'
      AND e.ends_at<(?||'T08:00:00.000Z') AND e.ends_at>=? AND e.ends_at>=(SELECT started_at FROM organizer_report_rollout WHERE id=1)
      AND NOT EXISTS(SELECT 1 FROM organizer_reports r WHERE r.account_id=a.id AND r.kind='recap' AND r.period_key=e.slug) ORDER BY e.ends_at,a.id LIMIT 1`)
      .bind(today,recent).all<{id:string;email:string;name:string;slug:string}>(),
  ]);
  let queued=0;
  for(const account of weekly.results) {
    const events=await db.prepare(`SELECT e.slug FROM curated_event_records e JOIN staff_accounts a ON a.id=?
      WHERE ${activeEvents} AND ${hostScope} AND e.ends_at>=? AND e.starts_at<=? ORDER BY e.starts_at,e.slug LIMIT 4`).bind(account.id,now,horizon).all<{slug:string}>();
    if(await queueReport(db,account,'weekly',week,events.results.map(e=>e.slug),now))queued++;
  }
  for(const account of recaps.results)if(await queueReport(db,account,'recap',account.slug,[account.slug],now))queued++;
  return {queued};
}
