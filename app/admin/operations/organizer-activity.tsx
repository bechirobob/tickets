'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {operationsFetch} from '../../../lib/operations-client';
type Activity={id:string;actor:string;action:string;eventSlug:string;eventTitle:string|null;detail:string|null;createdAt:string};
const labels:Record<string,string>={'registrations.settings':'Registration settings changed','registrations.approve':'RSVP approved','registrations.decline':'RSVP declined','registrations.cancel':'RSVP cancelled','audience.exported':'Guest emails exported','announcements.queued':'Email announcement queued','organizer.room_announcement':'Room announcement published'};
export default function OrganizerActivity(){
 const [items,setItems]=useState<Activity[]>([]),[unread,setUnread]=useState(0),[asOf,setAsOf]=useState(''),[message,setMessage]=useState('');
 const lifecycle=useRef<AbortController|null>(null),request=useRef<AbortController|null>(null);
 const load=useCallback(async(force=false)=>{
  const signal=lifecycle.current?.signal;
  if(!signal||signal.aborted||document.visibilityState==='hidden'||(request.current&&!force))return;
  request.current?.abort();
  const controller=new AbortController();
  request.current=controller;
  try{
   const r=await operationsFetch('/api/admin/organizer-activity',{signal:controller.signal});
   const d=await r.json() as {activity?:Activity[];unread?:number;asOf?:string;error?:string};
   if(controller.signal.aborted||signal.aborted)return;
   if(r.ok){setItems(d.activity??[]);setUnread(d.unread??0);setAsOf(d.asOf??'');setMessage('');}else setMessage(d.error??'Activity could not load.');
  }catch{
   if(!controller.signal.aborted&&!signal.aborted)setMessage('Activity could not load.');
  }finally{
   if(request.current===controller)request.current=null;
  }
 },[]);
 useEffect(()=>{
  const controller=new AbortController();
  lifecycle.current=controller;
  let timer:ReturnType<typeof setInterval>|undefined;
  const updatePolling=()=>{
   if(controller.signal.aborted)return;
   if(document.visibilityState==='hidden'){
    clearInterval(timer);timer=undefined;
    request.current?.abort();request.current=null;
   }else if(timer===undefined){
    void load();
    timer=setInterval(()=>void load(),30000);
   }
  };
  document.addEventListener('visibilitychange',updatePolling);
  void Promise.resolve().then(updatePolling);
  return()=>{
   controller.abort();request.current?.abort();request.current=null;
   clearInterval(timer);
   document.removeEventListener('visibilitychange',updatePolling);
  };
 },[load]);
 async function markRead(){
  const signal=lifecycle.current?.signal;
  if(!signal||signal.aborted)return;
  try{
   const r=await operationsFetch('/api/admin/organizer-activity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({asOf}),signal});
   // A pre-mutation poll must not replace the refreshed read state.
   if(r.ok&&!signal.aborted)await load(true);
  }catch{
   if(!signal.aborted)setMessage('Activity could not update.');
  }
 }
 return <details className="organizer-activity"><summary>Organiser activity <span>{unread ? `${unread} new` : 'Up to date'}</span></summary><p>Registration changes, guest-list actions and announcements appear here automatically.</p>{unread ? <button onClick={()=>void markRead()}>Mark these updates as read</button>:null}{items.length ? <ol tabIndex={0} aria-label="Organiser activity updates">{items.map(item=><li key={item.id}><div><b>{labels[item.action]??item.action.replaceAll(/[._]/g,' ')}</b><time>{new Date(item.createdAt).toLocaleString('en-GH',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Accra'})}</time></div><p>{item.eventTitle??item.eventSlug} · {item.actor}</p>{item.detail?<p>{item.detail}</p>:null}<Link href={`/admin/events?event=${encodeURIComponent(item.eventSlug)}`}>View event</Link></li>)}</ol>:<p>No organiser actions yet.</p>}{message?<p role="status">{message}</p>:null}</details>;
}
