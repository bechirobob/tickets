"use client";
import { useState } from 'react';
import { operationsFetch } from '../../../lib/operations-client';
type Candidate = { id:string;slug:string;title:string;version:string;blockedReason:string|null;orders:number;registrations:number };
export default function EventCleanup({ onChanged }: { onChanged: () => void }) {
  const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [events,setEvents]=useState<Candidate[] | null>(null), [selected,setSelected]=useState<string[]>([]), [confirmation,setConfirmation]=useState(''), [message,setMessage]=useState('');
  async function preview() {
    setOpen(true); setBusy(true); setEvents(null); setMessage(''); setConfirmation('');
    try {
      const response=await operationsFetch('/api/admin/events/archive/cleanup',{cache:'no-store'});
      const data=await response.json() as {events?:Candidate[];error?:string;truncated?:boolean};
      if(!response.ok || !data.events) { setMessage(data.error ?? 'Could not load events.'); return; }
      setEvents(data.events); setSelected(data.events.filter(event=>!event.blockedReason).map(event=>event.slug));
      if(data.truncated) setMessage('Only the first 100 events are shown. Review another batch after this one.');
    } catch { setMessage('Could not load events. Try again.'); }
    finally { setBusy(false); }
  }
  async function archive() {
    if(busy || !events || !selected.length || confirmation!=='ARCHIVE OTHER EVENTS') return;
    setBusy(true); setMessage('');
    try {
      const response=await operationsFetch('/api/admin/events/archive/cleanup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation,events:events.filter(event=>selected.includes(event.slug)).map(({slug,version})=>({slug,version}))})});
      const data=await response.json() as {error?:string;results?:Array<{slug:string;archived:boolean;error?:string}>};
      if(!response.ok || !data.results) { setMessage(data.error ?? 'Could not archive events.'); return; }
      const archived=data.results.filter(result=>result.archived), blocked=data.results.filter(result=>!result.archived);
      setMessage(`${archived.length} events archived.${blocked.length ? ` Not archived: ${blocked.map(result=>`${result.slug}: ${result.error}`).join('; ')}` : ''}`);
      setEvents(null); setSelected([]); setConfirmation(''); onChanged();
    } catch { setMessage('The result is uncertain. Review events again before retrying.'); setEvents(null); }
    finally { setBusy(false); }
  }
  return <div className="ops-removal"><button disabled={busy} onClick={()=>void preview()}>Archive other events</button>{open ? <section aria-label="Review other events for archive">
    <h3>Keep On The Guest List visible</h3><p>Review these exact events before archiving. This only hides eligible events from the public catalogue and ordinary workspaces. All records are preserved and the owner can restore them. On The Guest List is protected by its event ID and address. Live events and unresolved payment work are blocked.</p>
    {events?.map(event=><div key={event.id}><label><input type="checkbox" disabled={busy || Boolean(event.blockedReason)} checked={selected.includes(event.slug)} onChange={e=>setSelected(current=>e.target.checked?[...current,event.slug]:current.filter(slug=>slug!==event.slug))} />{event.title} · {event.slug}</label><p>{event.blockedReason ?? `${event.orders} orders and ${event.registrations} registrations will be preserved.`}</p></div>)}
    {events && !events.length ? <p>No events to archive.</p> : null}
    {events ? <><label>Type ARCHIVE OTHER EVENTS<input value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" /></label><button disabled={busy || !selected.length || confirmation!=='ARCHIVE OTHER EVENTS'} onClick={()=>void archive()}>{busy?'Working…':`Archive ${selected.length} selected events`}</button></> : null}
    {busy ? <p role="status">Checking events…</p> : null}{message ? <p role="status">{message}</p> : null}<button disabled={busy} onClick={()=>setOpen(false)}>Close</button>
  </section> : null}</div>;
}
