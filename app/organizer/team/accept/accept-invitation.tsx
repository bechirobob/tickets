'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {RequestError,requestJson,requestErrorMessage} from '../../../../lib/client-request';
import {prepareStaffPassword} from '../../../../lib/staff-password-client';
type Invite={email:string;role:string;eventTitle:string;eventSlug:string;needsPassword:boolean};
export default function AcceptInvitation(){
 const token=useRef(''),[invite,setInvite]=useState<Invite|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[inspection,setInspection]=useState(0),[retryable,setRetryable]=useState(false);
 useEffect(()=>{
  if(!token.current)token.current=new URLSearchParams(location.hash.slice(1)).get('token')??'';
  history.replaceState(null,'',location.pathname);
  const controller=new AbortController();
  void requestJson<Invite>('/api/organizer/team/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'inspect',token:token.current}),signal:controller.signal})
   .then(invitation=>{if(!controller.signal.aborted)setInvite(invitation);})
   .catch(cause=>{if(!controller.signal.aborted){setRetryable(cause instanceof RequestError&&(cause.status===null||cause.status===429||cause.status>=500));setError(requestErrorMessage(cause));}});
  return()=>controller.abort();
 },[inspection]);
 const destination=invite?.role==='gate'?`/scan?event=${encodeURIComponent(invite.eventSlug)}`:`/organizer/workspace?area=events&event=${encodeURIComponent(invite?.eventSlug??'')}&view=overview`;
 if(done)return <><p role="status">Invitation accepted. Sign in with {invite?.email} to open your assigned event.</p><Link href={`/admin/login?returnTo=${encodeURIComponent(destination)}`}>Sign in</Link></>;
 return <>{invite?<><p><b>{invite.eventTitle}</b><br/>{invite.role==='gate'?'Door staff':'Co-host'} · {invite.email}</p><form className="admin-login__form" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const f=new FormData(e.currentTarget);let password={};if(invite.needsPassword){if(f.get('password')!==f.get('confirm'))throw new Error('Those passwords do not match.');password=await prepareStaffPassword(String(f.get('password')));}const r=await fetch('/api/organizer/team/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'accept',token:token.current,...password}),signal:AbortSignal.timeout(20000)});const d=await r.json() as {error?:string;accepted?:boolean};if(!r.ok||d.accepted!==true)throw new Error(d.error??'We couldn’t confirm acceptance. Try signing in before accepting again.');token.current='';setDone(true);}catch(e){setError(e instanceof Error&&e.name!=='TimeoutError'?e.message:'The response timed out. Try signing in before accepting again; your invitation may already be accepted.');}finally{setBusy(false);}}}>{invite.needsPassword?<><label>Choose a password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy}/></label><small>At least 12 characters, including uppercase, lowercase and a number.</small><label>Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy}/></label></>:<p>Your existing password stays the same.</p>}<button disabled={busy}>{busy?'Accepting…':'Accept invitation'}</button></form></>:!error?<p role="status">Checking your invitation…</p>:null}{error?<p role="alert">{error}</p>:null}{!invite&&error&&retryable?<div className="admin-login__form"><button type="button" onClick={()=>{setError('');setInspection(value=>value+1);}}>Try checking again</button></div>:null}</>;
}
