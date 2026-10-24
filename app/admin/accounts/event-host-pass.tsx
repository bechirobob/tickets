'use client';
import { useEffect,useState } from 'react';
import { operationsFetch } from '../../../lib/operations-client';
import { ActionButton } from '../../action';
type Status={available?:boolean;eventSlug:string;title:string;hostName:string;invitation:{state:string;reused:boolean;claimed:boolean;passValid:boolean;expiresAt:string|null}|null};
export default function EventHostPass({accountId,email}:{accountId:string;email:string}) {
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let current=true;void operationsFetch(`/api/admin/host-pass?${new URLSearchParams({accountId,email})}`,{cache:'no-store'}).then(r=>r.json() as Promise<Status>).then(result=>{if(current)setStatus(result);}).catch(()=>{if(current)setStatus(null);});return()=>{current=false;};},[accountId,email]);
 async function act(action:'provision'|'send') {
  if(busy||!status)return;setBusy(true);setMessage('');
  try {
   const response=await operationsFetch('/api/admin/host-pass',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountId,email,eventSlug:status.eventSlug,action,...(action==='send'?{confirm:'private-single-use-guest-login'}:{})})});
   const result=await response.json() as Status & {error?:string};if(!response.ok){setMessage(result.error??'Refresh to check the outcome.');return;}setStatus(result);setConfirm(false);
  }catch{setMessage('The outcome is uncertain. Refresh to check the status before trying again.');}finally{setBusy(false);}
 }
 if(!status?.available)return null;
 const invitation=status.invitation;
 return <section className="staff-removal" aria-label="Event Host pass"><h3>{status.title} · Host pass</h3><p>{status.hostName} · Host. This changes no dashboard permissions.</p>
  {!invitation?<><p>Reuse an eligible pass, or create one private, zero-cost admission. No email is sent yet.</p><ActionButton type="button" disabled={busy} onClick={()=>void act('provision')}>Ensure event Host pass</ActionButton></>:<><p>{invitation.claimed?'Pass accepted.':`Pass ${invitation.reused?'reused':'created'}. Invitation: ${invitation.state}.`}</p>
   {invitation.state==='provisioned'&&invitation.passValid?<>{confirm?<><p>Send {email} a private single-use guest-login link, valid for 24 hours or until this event ends. Anyone holding it could claim it. It opens this Room and preserves access to their other existing passes.</p><ActionButton type="button" disabled={busy} onClick={()=>void act('send')}>Send private invitation</ActionButton><ActionButton type="button" variant="text" onClick={()=>setConfirm(false)}>Not yet</ActionButton></>:<ActionButton type="button" disabled={busy} onClick={()=>setConfirm(true)}>Review pass invitation</ActionButton>}</>:null}
   {['sending','uncertain'].includes(invitation.state)?<p>Check the provider receipt before any further action. Automatic resend is disabled.</p>:null}</>}
  {message?<p role="alert">{message}</p>:null}</section>;
}
