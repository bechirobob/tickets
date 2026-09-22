'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Copy, RefreshCw } from 'lucide-react';
import { hostEventEnded } from '../../../lib/analytics-period';
import type { HostSummary } from '../../../lib/host-summary';
import { operationsFetch } from '../../../lib/operations-client';
type Data={summary:HostSummary;reports:{enabled:boolean;canManage:boolean;latest:null|{createdAt:string;kind:string;status:string}}};
const money=(n:number)=>new Intl.NumberFormat('en-GH',{style:'currency',currency:'GHS'}).format(n/100);
const time=(s:string)=>new Date(s).toLocaleString('en-GH',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Accra'});

export default function HostStart({eventSlug,onOpen,active,children}:{eventSlug:string;onOpen:(view:string)=>void;active:boolean;children?:ReactNode}) {
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(true),[asOf,setAsOf]=useState(0);
  const reportRef=useCallback((node:HTMLDetailsElement|null)=>{if(node&&window.location.hash==='#email-reports'){node.open=true;node.scrollIntoView({block:'start'});}},[]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    try {
      const response=await operationsFetch(`/api/organizer/reports?eventSlug=${encodeURIComponent(eventSlug)}`,{cache:'no-store',signal:signal??AbortSignal.timeout(15000)});
      const result=await response.json() as Data & {error?:string};if(signal?.aborted)return;
      if(!response.ok)throw new Error(result.error??'Couldn’t load your event summary.');
      setData(result);setAsOf(Date.now());setError('');
    } catch(cause){if(!signal?.aborted)setError(cause instanceof Error?cause.message:'Couldn’t load your event summary.');}
    finally{if(!signal?.aborted)setRefreshing(false);}
  },[eventSlug]);
  useEffect(()=>{if(!active)return;const c=new AbortController();const timer=setTimeout(()=>void load(c.signal),0);return()=>{clearTimeout(timer);c.abort();};},[load,active]);
  async function toggleReports() {
    if(!data||busy)return;setBusy(true);setNotice('');setError('');
    try{const response=await operationsFetch('/api/organizer/reports',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!data.reports.enabled}),signal:AbortSignal.timeout(15000)});const result=await response.json() as {enabled:boolean;error?:string};if(!response.ok)throw new Error(result.error??'Couldn’t save email reports.');setData({...data,reports:{...data.reports,enabled:result.enabled}});setNotice(result.enabled?'Email reports are on.':'Email reports are off.');}
    catch(cause){setError(cause instanceof Error?cause.message:'Couldn’t save email reports.');}finally{setBusy(false);}
  }
  const event=data?.summary.event;
  const ended=Boolean(event&&hostEventEnded(event,asOf));
  const shareable=Boolean(event&&event.status==='published'&&!['cancelled','archived','postponed'].includes(event.eventState)&&!ended);
  const url=`https://tickets.becoreops.com/${event?.mode==='paid'?'event':'rsvp'}/${eventSlug}`;
  async function copy(){try{await navigator.clipboard.writeText(url);setNotice('Link copied. Send it to your people.');}catch{setNotice('Select the link below and copy it.');}}
  const checks=event?[
    {label:'Event details',detail: event.venue&&event.venueMapUrl&&event.lineup?'Venue, map and line-up are in place.':'Add the venue, map and line-up.',ready:Boolean(event.venue&&event.venueMapUrl&&event.lineup),view:'details'},
    {label:'Guest setup',detail:event.mode==='paid'?`${event.activeTiers} active ticket ${event.activeTiers===1?'tier':'tiers'}.`:event.mode==='interest'?'Email list only. No place reserved.':`${event.capacity} places · ${event.approvalRequired?'you approve requests':'guests join automatically'}.`,ready:event.mode==='paid'?event.activeTiers>0:event.mode==='interest'||event.capacity>0,view:'guests'},
    {label:'Entry team',detail:event.gateStaff?`${event.gateStaff} active ${event.gateStaff===1?'person':'people'} on the door.`:'Add the people checking guests in.',ready:event.gateStaff>0,view:'entry'},
  ]:[];
  return <><section className="host-start" aria-label="Your event at a glance">
    <header><div><h3>{ended?'How the night went':'Your next moves'}</h3><p>{ended?'The numbers stay here after the music stops.':'A quick check, then get the word out.'}</p></div><button type="button" disabled={refreshing} onClick={()=>{setRefreshing(true);void load();}} aria-label="Refresh event summary"><RefreshCw size={17}/><span>Refresh</span></button></header>
    {error?<p role="alert">{error} <button type="button" disabled={refreshing} onClick={()=>{setRefreshing(true);void load();}}>Try again</button></p>:null}
    {!data&&!error?<p role="status">Getting your event ready…</p>:null}
    {data&&event?<>
      {data.summary.baseline ? <p>Analytics since {time(data.summary.baseline)} (Accra). Your guest list still includes earlier bookings.</p> : null}
      <div className="host-start__numbers"><div><span>{event.mode==='interest'?'Interest sign-ups':'Confirmed RSVP guests'}</span><b>{event.mode==='interest'?data.summary.interest:data.summary.rsvp.totals.confirmedGuests}</b></div><div><span>Paid orders</span><b>{data.summary.sales.orders}</b></div><div><span>Ticket sales</span><b>{money(data.summary.sales.ticketSalesMinor)}</b></div><div><span>Checked in</span><b>{data.summary.checkedIn} <small>/ {data.summary.expected}</small></b></div></div>
      <p className="host-start__note">Ticket sales exclude booking fees. Payout statements are in Money.</p>
      {data.summary.pending?<button className="host-start__pending" type="button" onClick={()=>onOpen('guests')}>{data.summary.pending} RSVP {data.summary.pending===1?'request needs':'requests need'} your nod <ArrowRight size={17}/></button>:null}
      {!ended?<ul className="host-start__checks">{checks.map(c=><li key={c.label}><span role="img" aria-label={c.ready?'Ready':'Needs attention'}>{c.ready?<Check size={18}/>:<span className="host-start__dot"/>}</span><div><b>{c.label}</b><p>{c.detail}</p></div><button type="button" onClick={()=>onOpen(c.view)}>{c.ready?'Review':'Set up'}<span className="sr-only"> {c.label}</span><ArrowRight size={16}/></button></li>)}</ul>:null}
      <div className="host-start__share"><div><h4>{shareable?'Your link, ready to go':ended?'This event has ended':'Your public link is waiting'}</h4><p>{shareable?event.accepting===0?'New registrations are paused. Review Guest setup before sharing.':event.closesAt&&Date.parse(event.closesAt)<=asOf?'Registration has closed. The page is still available.':event.scheduleStatus==='coming_soon'?'Dates are coming soon. Check your guest setup before sharing.':'Open the page, check the details, then share it.':ended?'Open analytics for the full breakdown.':event.eventState==='cancelled'?'This event is cancelled.':event.eventState==='postponed'?'This event is postponed. Update the plan before sharing.':'BeCore will publish the event after review. You can prepare the details above.'}</p>{shareable&&event.closesAt?<small>Registration deadline: {time(event.closesAt)} (Accra).</small>:null}</div>
      {shareable?<><label htmlFor={`share-${eventSlug}`}>Guest link<input id={`share-${eventSlug}`} value={url} readOnly onFocus={e=>e.target.select()}/></label><div className="host-start__actions"><button type="button" onClick={()=>void copy()}><Copy size={16}/>Copy guest link</button><Link href={url}>Open guest page <ArrowRight size={16}/></Link></div></>:null}
      <Link href={`/organizer/analytics?event=${eventSlug}&range=all`}>View analytics & tracked links <ArrowRight size={16}/></Link></div>
      <details ref={reportRef} className="host-start__reports" id="email-reports"><summary>Email reports</summary><p>Monday at 8am: a roundup of up to 4 events coming up in the next 30 days or waiting on a date. After an event: a recap from 8am the following morning. All times are Accra time.</p><p>Sign-ups, sales, recorded turnout and your top tracked links, in one branded email.</p>{data.reports.canManage?<label><input type="checkbox" role="switch" checked={data.reports.enabled} disabled={busy} onChange={()=>void toggleReports()}/><span>Email me my host reports</span></label>:<p>Each organiser manages reports from their own account.</p>}{data.reports.latest?<p>Latest report: {time(data.reports.latest.createdAt)} · {({sent:'sent',delivered:'delivered',failed:'waiting for retry or needs attention',queued:'queued',suppressed:'not sent',bounced:'email bounced',complained:'reported as spam',delayed:'delayed'} as Record<string,string>)[data.reports.latest.status]??'saved'}.</p>:<p>No reports sent yet.</p>}</details>
    </>:null}
    {notice?<p role="status">{notice}</p>:null}
  </section>{data||(!refreshing&&error)?children:null}</>;
}
