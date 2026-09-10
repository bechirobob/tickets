'use client';
import {useEffect,useState} from 'react';
import type {StaffRole} from '../../../lib/admin-session';
import {operationsFetch} from '../../../lib/operations-client';
import OperationsNav from '../operations-nav';
import RegistrationManager from '../../registration-manager';
type Event={slug:string;title:string;status:string;startsAt:string};
export default function RegistrationWorkspace({actor,role}:{actor:string;role:StaffRole}){
 const [events,setEvents]=useState<Event[]>([]),[selected,setSelected]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;void operationsFetch('/api/admin/events').then(async r=>{const d=await r.json() as {events?:Event[];error?:string};if(!active)return;if(!r.ok){setMessage(d.error??'Could not load events.');return;}const list=(d.events??[]).filter(e=>e.status==='published');setEvents(list);const requested=new URLSearchParams(location.search).get('event');setSelected(list.find(e=>e.slug===requested)?.slug??list.find(e=>e.startsAt>new Date().toISOString())?.slug??list[0]?.slug??'');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 return <main className="ops-page"><OperationsNav actor={actor} role={role} active="/admin/registrations"/><section className="ops-main"><header><div><p>Guest management</p><h1>RSVP & guests</h1></div></header>{message?<p role="status" className="ops-message">{message}</p>:null}{loading?<p>Loading events…</p>:events.length?<><div className="workspace-event-picker"><label htmlFor="registration-event">Event</label><select id="registration-event" value={selected} onChange={e=>setSelected(e.target.value)}>{events.map(e=><option value={e.slug} key={e.slug}>{e.title}</option>)}</select></div><RegistrationManager key={selected} eventSlug={selected} expanded/></>:<p className="ops-empty">Publish an event to set up registration.</p>}</section></main>;
}
