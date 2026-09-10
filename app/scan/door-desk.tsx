"use client";

import { Plus, RefreshCw, Search, UserCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson, requestErrorMessage } from '../../lib/client-request';

type Guest = { id: string; guestName: string; admissionCount: number; kind: string; note: string | null; status: string };
type Tier = { id: string; code: string; name: string; priceMinor: number; admissionsPerUnit: number };

export default function DoorDesk({ eventSlug }: { eventSlug: string }) {
  const [guests,setGuests]=useState<Guest[]>([]),[tiers,setTiers]=useState<Tier[]>([]);
  const [name,setName]=useState(''),[message,setMessage]=useState(''),[query,setQuery]=useState('');
  const [page,setPage]=useState(0),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const acting=useRef(false);
  const [counts,setCounts]=useState({total:0,expected:0,admitted:0});
  const load=useCallback(async(signal?:AbortSignal)=>{
    if(!eventSlug)return;
    try { const data=await requestJson<{guests:Guest[];tiers:Tier[];total:number;expected:number;admitted:number}>(`/api/admin/door?eventSlug=${encodeURIComponent(eventSlug)}&q=${encodeURIComponent(query)}&offset=${page*10}`,{signal});
      if(!signal?.aborted){setGuests(data.guests);setTiers(data.tiers);setCounts({total:data.total,expected:data.expected,admitted:data.admitted});setLoaded(true);}
    } catch(error){if(!signal?.aborted)setMessage(requestErrorMessage(error));}
  },[eventSlug,query,page]);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{void load(controller.signal);},150);
    const poll=setInterval(()=>{if(document.visibilityState==='visible'&&!acting.current)void load(controller.signal);},15000);
    return ()=>{controller.abort();clearTimeout(timer);clearInterval(poll);};
  },[load]);
  async function act(body:Record<string,unknown>){
    if(acting.current||!loaded)return;acting.current=true;setBusy(true);setMessage('');
    try {await requestJson('/api/admin/door',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventSlug,...body})});setMessage(body.action==='check_in'?'Guest admitted.':'Guest added.');if(body.action==='add')setName('');await load();}
    catch(error){setMessage(requestErrorMessage(error));}finally{acting.current=false;setBusy(false);}
  }
  const pages=Math.max(1,Math.ceil(counts.total/10)),current=Math.min(page,pages-1),visible=guests;
  const {expected,admitted}=counts;
  return <section className="door-desk">
    <header><UserCheck size={18}/><span><strong>Door desk</strong><small>{loaded?`${expected} expected · ${admitted} admitted`:'Loading guest list…'}</small></span><button type="button" onClick={()=>void load()} disabled={busy} aria-label="Refresh guest list"><RefreshCw size={16}/></button></header>
    <label className="door-desk__search"><Search size={16}/><span className="sr-only">Search RSVP and door guests</span><input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Find a guest by name" type="search"/></label>
    <div className="door-desk__list">{visible.map(guest=><article key={guest.id}><span><b>{guest.guestName}</b><small>{guest.note==='RSVP'?'RSVP':guest.kind.replaceAll('_',' ')} · {guest.admissionCount} {guest.admissionCount===1?'guest':'guests'}</small></span>{guest.status==='expected'?<button disabled={busy} aria-label={`Admit ${guest.guestName}`} onClick={()=>void act({action:'check_in',id:guest.id})}>Admit</button>:<i>In</i>}</article>)}</div>
    {loaded&&!visible.length?<p className="door-desk__empty">{query?'No matching guest. Try another name.':'Approved RSVPs and door guests appear here.'}</p>:null}
    {pages>1?<nav className="door-desk__pagination" aria-label="Guest list pages"><button disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span>{current+1} / {pages}</span><button disabled={current===pages-1} onClick={()=>setPage(current+1)}>Next</button></nav>:null}
    <details><summary>Add a guest or take a walk-up sale</summary><form onSubmit={e=>{e.preventDefault();void act({action:'add',guestName:name,kind:'guest_list'});}}><input aria-label="New door guest name" value={name} onChange={e=>setName(e.target.value)} placeholder="Guest name"/><button disabled={busy||!loaded||!name.trim()}><Plus size={14}/> Add</button></form>{tiers.length?<div className="door-desk__walkup">{tiers.map(tier=><a key={tier.id} href={`/checkout/${eventSlug}?tier=${encodeURIComponent(tier.id)}`} target="_blank" rel="noreferrer">{tier.name} · GH₵{(tier.priceMinor/100).toLocaleString('en-GH')}</a>)}</div>:null}</details>
    {message?<p className="door-desk__message" role="status">{message}</p>:null}
  </section>;
}
