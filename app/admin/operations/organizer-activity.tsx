'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {operationsFetch} from '../../../lib/operations-client';
type Activity={id:string;actor:string;action:string;eventSlug:string;eventTitle:string|null;detail:string|null;createdAt:string};
const labels:Record<string,string>={'registrations.settings':'Registration settings changed','registrations.approve':'RSVP approved','registrations.decline':'RSVP declined','registrations.cancel':'RSVP cancelled','audience.exported':'Guest emails exported','announcements.queued':'Email announcement queued','organizer.room_announcement':'Room announcement published'};
export default function OrganizerActivity(){
 const [items,setItems]=useState<Activity[]>([]),[unread,setUnread]=useState(0),[asOf,setAsOf]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async()=>{const r=await operationsFetch('/api/admin/organizer-activity');const d=await r.json() as {activity?:Activity[];unread?:number;asOf?:string;error?:string};if(r.ok){setItems(d.activity??[]);setUnread(d.unread??0);setAsOf(d.asOf??'');setMessage('');}else setMessage(d.error??'Activity could not load.');},[]);
 useEffect(()=>{void Promise.resolve().then(()=>load());const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[load]);
 async function markRead(){const r=await operationsFetch('/api/admin/organizer-activity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({asOf})});if(r.ok)await load();}
 return <details className="organizer-activity"><summary>Organiser activity <span>{unread ? `${unread} new` : 'Up to date'}</span></summary><p>Registration changes, guest-list actions and announcements appear here automatically.</p>{unread ? <button onClick={()=>void markRead()}>Mark these updates as read</button>:null}{items.length ? <ol>{items.map(item=><li key={item.id}><div><b>{labels[item.action]??item.action.replaceAll(/[._]/g,' ')}</b><time>{new Date(item.createdAt).toLocaleString('en-GH',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Accra'})}</time></div><p>{item.eventTitle??item.eventSlug} · {item.actor}</p>{item.detail?<p>{item.detail}</p>:null}<Link href={`/admin/events?event=${encodeURIComponent(item.eventSlug)}`}>View event</Link></li>)}</ol>:<p>No organiser actions yet.</p>}{message?<p role="status">{message}</p>:null}</details>;
}
