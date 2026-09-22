'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
export const money=(n:number)=>new Intl.NumberFormat('en-GH',{style:'currency',currency:'GHS'}).format((n??0)/100);
export const date=(v:string)=>v?new Date(v).toLocaleString('en-GH',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Accra'}):'—';
export const readable=(v:string)=>v?.replaceAll('_',' ')??'—';
export const apiUrl=(section:string,event:string,extra='')=>`/api/organizer/business?section=${section}&event=${encodeURIComponent(event)}${extra?'&'+extra:''}`;
export type EventItem={slug:string;title:string;startsAt:string;endsAt:string;status:string;eventState:string;venue:string;area:string;capacity:number;isLead:number;pendingRequests:number;admissions:number;arrivals:number;salesMinor:number};
export type Tier={id:string;code:string;name:string;priceMinor:number;capacity:number;allocated:number;admissionsPerUnit:number;status:string};
export function useRemote<T>(section:string,event:string,extra='',enabled=true){
 const url=apiUrl(section,event,extra),[version,setVersion]=useState(0),[state,setState]=useState<{url:string;data?:T;error?:string}>({url:''});
 const refresh=useCallback(()=>setVersion(v=>v+1),[]);
 useEffect(()=>{
  if(!enabled)return;const controller=new AbortController();
  void fetch(url,{cache:'no-store',signal:controller.signal}).then(async r=>{const d=await r.json() as T & {error?:string};if(!r.ok)throw new Error(d.error??'This view could not be loaded.');setState({url,data:d});}).catch((e:unknown)=>{if(!controller.signal.aborted)setState({url,error:e instanceof Error?e.message:'Could not connect. Try again.'});});
  return()=>controller.abort();
 },[url,version,enabled]);
 return {data:state.url===url?state.data:undefined,error:state.url===url?state.error:undefined,refresh};
}
export function useMutation(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),working=useRef(false);
 async function mutate(body:Record<string,unknown>,endpoint='/api/organizer/business'){
  if(working.current)return null;working.current=true;setBusy(true);setMessage('');
  try{const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const d=await r.json() as Record<string,unknown>&{error?:string};if(!r.ok)throw new Error(d.error??'This change could not be saved.');setMessage('Saved.');return d;}catch(e){setMessage(e instanceof Error&&e.name!=='TimeoutError'?e.message:'The response timed out. Retry the same request to check its status.');return null;}finally{setBusy(false);working.current=false;}
 }
 return {busy,message,setMessage,mutate};
}
export function RemoteState({error,loading,refresh}:{error?:string;loading:boolean;refresh:()=>void}){return error?<div role="alert"><p>{error}</p><button onClick={refresh}>Try again</button></div>:loading?<p role="status">Loading…</p>:null;}
export function Pager({offset,total,onChange}:{offset:number;total:number;onChange:(n:number)=>void}){return <nav className="suite-pagination" aria-label="Result pages"><button disabled={!offset} onClick={()=>onChange(Math.max(0,offset-25))}>Previous</button><span>{total?offset+1:0}–{Math.min(offset+25,total)} of {total}</span><button disabled={offset+25>=total} onClick={()=>onChange(offset+25)}>Next</button></nav>;}
export function Message({children}:{children:string}){return children?<p className="suite-message" role="status">{children}</p>:null;}
