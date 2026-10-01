'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {RequestError,requestJson,requestErrorMessage} from '../../../../lib/client-request';
export default function ConfirmApplication(){
 const token=useRef(''),[state,setState]=useState('loading'),[error,setError]=useState(''),[application,setApplication]=useState<{brandName:string;contactName:string;socialUrl:string}|null>(null),[inspection,setInspection]=useState(0),[retryable,setRetryable]=useState(false);
 useEffect(()=>{
  if(!token.current)token.current=new URLSearchParams(window.location.hash.slice(1)).get('token')??'';
  window.history.replaceState(null,'',window.location.pathname);
  const controller=new AbortController();
  void requestJson<{application:{brandName:string;contactName:string;socialUrl:string}}>('/api/host-applications/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'inspect',token:token.current}),signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted){setApplication(result.application);setState('ready');}})
   .catch(cause=>{if(!controller.signal.aborted){setRetryable(cause instanceof RequestError&&(cause.status===null||cause.status===429||cause.status>=500));setError(requestErrorMessage(cause));setState('invalid');}});
  return()=>controller.abort();
 },[inspection]);
 async function confirm(){setState('saving');setError('');try{const response=await fetch('/api/host-applications/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'confirm',token:token.current}),signal:AbortSignal.timeout(15000)});const r=await response.json() as {error?:string;confirmed?:boolean};if(!response.ok||r.confirmed!==true)throw new Error(r.error??'We couldn’t confirm the result. Check My Nights or your inbox before trying again.');token.current='';setState('done');}catch(cause){setError(cause instanceof Error&&cause.name!=='TimeoutError'?cause.message:'We couldn’t confirm the result. Try again; if the link is already used, check your inbox for the review outcome.');setState('ready');}}
 return <>{state==='loading'?<p role="status">Checking your private link…</p>:null}{state==='done'?<section role="status"><h1>Your host application is in.</h1><p>Email confirmed. We’ll review your details and email you the outcome.</p><p>Once approved, you can set up your workspace. The event can come later.</p><Link href="/events">See what’s on</Link></section>:null}{application&&['ready','saving'].includes(state)?<><h1>Is this your application?</h1><p><b>{application.brandName}</b><br/>{application.contactName}</p><p className="host-join__email">{application.socialUrl}</p><button className="host-join__submit" onClick={()=>void confirm()} disabled={state==='saving'}>{state==='saving'?'Confirming…':'Confirm my email'}</button><p>Only confirm if these are your details. Your host status stays pending until BeCore approves it.</p></>:null}{error?<p role="alert" className="host-join__error">{error}</p>:null}{state==='invalid'&&retryable?<button type="button" className="host-join__submit" onClick={()=>{setError('');setState('loading');setInspection(value=>value+1);}}>Try checking again</button>:null}{state==='invalid'?<Link href="/organizer/join">Back to the host form</Link>:null}</>;
}
