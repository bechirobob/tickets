'use client';
import {useRef,useState} from 'react';
import {ActionButton} from './action';
import {operationsFetch} from '../lib/operations-client';

type Preview={content:string;pinned:boolean;submissionKey:string};
export default function PhoneAnnouncementComposer({eventSlug,allowed,phoneAvailable,onBusy}:{eventSlug:string;allowed?:boolean;phoneAvailable?:boolean;onBusy:(busy:boolean)=>void}){
 const [content,setContent]=useState(''),[pinned,setPinned]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState('');
 const active=useRef(false),editor=useRef<HTMLTextAreaElement>(null);
 async function send(){
  if(active.current||!preview||!allowed)return;
  active.current=true;setBusy(true);onBusy(true);setMessage('');
  try{
   const response=await operationsFetch('/api/organizer/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'announcement',eventSlug,...preview})});
   const result=await response.json() as {error?:string;announced?:boolean};
   if(!response.ok){setUncertain(true);setMessage(result.error??'Couldn’t confirm this announcement. Retry to check the same update.');return;}
   if(!result.announced)throw new Error('Announcement was not confirmed.');
   setPreview(null);setContent('');setPinned(false);setUncertain(false);
   setMessage(phoneAvailable ? 'Posted to The Room and guest inboxes. Phone delivery is queued for eligible devices with host alerts on.' : 'Posted to The Room and guest inboxes. Phone delivery is currently unavailable.');
   requestAnimationFrame(()=>editor.current?.focus());
  }catch{setUncertain(true);setMessage('We couldn’t confirm delivery. Retry this same announcement safely; it won’t post twice.');}
  finally{active.current=false;setBusy(false);onBusy(false);}
 }
 return <section aria-label="Phone and in-app announcement">
  <p>Confirmed guests with Room access get this in The Room and their inbox. Phone alerts go only to devices with host alerts enabled, respecting each guest’s notification settings.</p>
  <p className="audience-closed-note">Email subscriptions are separate. On iPhone, guests add Tickets to their Home Screen, open it and enable event alerts in My Nights.</p>
  {allowed===undefined?<p role="status">Checking announcement access…</p>:!allowed?<p role="status">Phone announcements require host access to this event. You can still use email announcements if your role allows them.</p>:null}
  {allowed&&phoneAvailable===false?<p role="status">Phone delivery is currently unavailable. You can still post this update in The Room and guest inboxes.</p>:null}
  <label>Host update<textarea ref={editor} rows={4} maxLength={500} value={content} disabled={busy||!!preview} onChange={event=>setContent(event.target.value)} placeholder="Doors, timing, entry or venue update…"/></label>
  <label className="organizer-check"><input type="checkbox" checked={pinned} disabled={busy||!!preview} onChange={event=>setPinned(event.target.checked)}/> Pin in The Room</label>
  {preview?<section className="announcement-preview" aria-label="Phone announcement preview"><p>{preview.content}</p><p>This posts now to confirmed guests with Room access. It does not send an email.</p><div className="registration-actions">{!uncertain?<ActionButton variant="secondary" disabled={busy} onClick={()=>{setPreview(null);setMessage('');requestAnimationFrame(()=>editor.current?.focus());}}>Edit phone update</ActionButton>:null}<ActionButton disabled={busy||!allowed} onClick={()=>void send()}>{busy?'Posting…':uncertain?'Retry phone update':'Post phone update'}</ActionButton></div></section>:<ActionButton disabled={busy||!allowed||content.trim().length<2} onClick={()=>{setPreview({content:content.trim(),pinned,submissionKey:crypto.randomUUID()});setMessage('');}}>Preview phone update</ActionButton>}
  {message?<p role="status">{message}</p>:null}
 </section>;
}
