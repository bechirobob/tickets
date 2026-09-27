'use client';
import Link from 'next/link';
import {useState,type FormEvent} from 'react';
import {ArrowRight,BadgeCheck,Loader2,MailCheck} from 'lucide-react';
export default function HostApplicationForm(){
 const [state,setState]=useState<'idle'|'saving'|'done'>('idle'),[error,setError]=useState(''),[email,setEmail]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(state==='saving')return;const form=new FormData(event.currentTarget);setState('saving');setError('');
 try{const response=await fetch('/api/host-applications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...Object.fromEntries(form),acceptedPolicies:form.get('acceptedPolicies')==='yes'}),signal:AbortSignal.timeout(20000)});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error??'Couldn’t save your details. Try again.');setEmail(String(form.get('email')));setState('done');}catch(cause){setError(cause instanceof Error&&cause.name!=='TimeoutError'?cause.message:'We couldn’t confirm the save. Your details are still here. Try again safely.');setState('idle');}}
 return <><section hidden={state!=='done'} role="status"><MailCheck size={25}/><h1>One quick inbox check.</h1><p>Look for our confirmation email at <b className="host-join__email">{email}</b>.</p><p>New applications need that link before review. Already applied? Your existing application stays in place.</p><p>Email taking its time? Check spam. You can request a fresh link here after ten minutes.</p><button className="host-join__secondary" onClick={()=>setState('idle')}>Back to my details</button><p><Link href="/admin/login?returnTo=/organizer/workspace">Already approved? Open your workspace</Link></p></section>
 <div hidden={state==='done'}><p className="host-join__eyebrow"><BadgeCheck size={17}/>Become a verified host</p><h1>You bring the people.<br/>Let’s make it official.</h1><p className="host-join__intro">Tell us who’s behind the good nights. No event lined up? You’re still in the right place.</p>
 <form onSubmit={submit} aria-busy={state==='saving'}><div className="host-join__fields">
 <label className="host-join__wide">Host or brand name<input name="brandName" autoComplete="organization" required maxLength={120} placeholder="The name your crowd knows"/></label>
 <label>Your name<input name="contactName" autoComplete="name" required maxLength={120} placeholder="First and last name"/></label>
 <label>Email<input name="email" type="email" autoComplete="email" required maxLength={180} placeholder="you@example.com"/></label>
 <label>Phone / WhatsApp<input name="phone" type="tel" autoComplete="tel" required maxLength={40} placeholder="+233 24 000 0000"/></label>
 <label>Social page or website<input name="socialUrl" type="url" required maxLength={500} placeholder="https://instagram.com/…"/><small>So we can put a face to the name.</small></label>
 <label className="host-join__wide">What’s your kind of gathering? <span>Optional</span><textarea name="about" maxLength={600} placeholder="Day parties, live shows, late nights… tell us your thing."/></label>
 </div><input className="submission-honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"/>
 <label className="host-join__consent"><input name="acceptedPolicies" value="yes" type="checkbox" required/><span>I agree to the <Link href="/terms#organizer" target="_blank">host terms</Link> and have read the <Link href="/privacy" target="_blank">privacy notice</Link>. My host name will appear publicly once approved.</span></label>
 {error?<p role="alert" className="host-join__error">{error}</p>:null}
 <button className="host-join__submit" disabled={state==='saving'}>{state==='saving'?<>Saving your details…<Loader2 size={17} className="spin"/></>:<>Let’s get you verified<ArrowRight size={17}/></>}</button>
 <p className="host-join__footnote">Confirm your email. We’ll review your host details next.</p>
 </form></div></>;
}
