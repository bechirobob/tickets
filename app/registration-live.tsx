'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,Copy,ExternalLink,Radio} from 'lucide-react';
import {operationsFetch} from '../lib/operations-client';
import {ActionButton} from './action';
type Signup={id:string;name:string;status:string;guests:number;updatedAt:string};
type Snapshot={sharing:{ready:boolean;mode:string;reason:string};latest:Signup[];confirmed:number;waiting:number;requested:number;paid:number;interested:number};
const statusLabel=(status:string)=>({confirmed:'RSVP confirmed',requested:'Needs approval',waitlisted:'Waitlisted',paid:'Paid registration',interested:'Joined email list',cancelled:'Cancelled',declined:'Declined'}[status]??status);
export default function RegistrationLive({eventSlug,onChange,hasUnsavedChanges=false,settingsVersion='',onSave,busy=false}:{eventSlug:string;onChange:()=>void;hasUnsavedChanges?:boolean;settingsVersion?:string;onSave?:()=>Promise<boolean>;busy?:boolean}){
 const [data,setData]=useState<Snapshot|null>(null),[connected,setConnected]=useState(false),[notice,setNotice]=useState(''),[copied,setCopied]=useState(false),[url,setUrl]=useState('');
 const changed=useRef(onChange);useEffect(()=>{changed.current=onChange;},[onChange]);
 const link=useRef<HTMLInputElement>(null),copying=useRef(false);
 useEffect(()=>{let stopped=false,last='',timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function refresh(){if(document.hidden){timer=setTimeout(refresh,5000);return;}const r=await operationsFetch(`/api/admin/registrations?eventSlug=${encodeURIComponent(eventSlug)}&live=1`,{signal:controller.signal});if(stopped)return;
   if(r.ok){setUrl(`${location.origin}/rsvp/${encodeURIComponent(eventSlug)}`);const next=await r.json() as Snapshot;const signature=JSON.stringify(next);if(last&&last!==signature){setNotice('Guest activity updated.');changed.current();}last=signature;setData(next);setConnected(true);}else setConnected(false);
   timer=setTimeout(refresh,5000);
  }void refresh();return()=>{stopped=true;clearTimeout(timer);controller.abort();};
 },[eventSlug,settingsVersion]);
 async function copy(){
  if(copying.current||busy)return;
  copying.current=true;setCopied(false);
  const prepared=(async()=>{
   try {
    if(hasUnsavedChanges&&!(await onSave?.()))return null;
    const r=await operationsFetch(`/api/admin/registrations?eventSlug=${encodeURIComponent(eventSlug)}&live=1`);
    if(!r.ok){setNotice('Could not check the link. Try again.');return null;}
    const current=await r.json() as Snapshot;setData(current);
    if(!current.sharing.ready){setNotice(current.sharing.reason);return null;}
    return `${location.origin}/rsvp/${encodeURIComponent(eventSlug)}`;
   }catch{setNotice('Could not check the link. Try again.');return null;}
  })();
  try {
   // Safari needs write() in the original tap; the item resolves after saving.
   // https://webkit.org/blog/10855/async-clipboard-api/
   if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
    const content=prepared.then(value=>{if(!value)throw new Error('Registration link is not ready.');return new Blob([value],{type:'text/plain'});});
    void content.catch(()=>undefined);
    await navigator.clipboard.write([new ClipboardItem({'text/plain':content})]);
   }else{
    const value=await prepared;if(!value)return;
    await navigator.clipboard.writeText(value);
   }
   if(await prepared){setCopied(true);setNotice('Link copied. Ready to share.');}
  }catch{
   if(await prepared){link.current?.focus();link.current?.select();setNotice('Your link is selected. Copy it to share.');}
  }finally{copying.current=false;}
 }

 const label=data?.sharing.mode==='rsvp'?'RSVP':'registration';
 return <section className="registration-live" aria-label="Live registrations"><header><div><b>Invite your guests</b><small><Radio size={12}/>{connected?'Live · refreshes every 5 seconds':'Connecting to guest updates…'}</small></div><span className="registration-open-state">{hasUnsavedChanges?'Changes to save':data?.sharing.ready?'Link ready':'Not open'}</span></header>
 <div className="registration-share"><label>{label==='RSVP'?'RSVP link':'Registration link'}<input ref={link} aria-label={`${label} link`} readOnly value={url} onFocus={e=>e.target.select()}/></label><ActionButton disabled={busy||!data} onClick={()=>void copy()} icon={copied?<Check size={17}/>:<Copy size={17}/>}>{busy?'Saving…':hasUnsavedChanges?'Save & copy link':copied?'Link copied':`Copy ${label} link`}</ActionButton>{data?.sharing.ready?<a href={`/rsvp/${encodeURIComponent(eventSlug)}`} target="_blank" rel="noreferrer" aria-label="Preview guest page"><ExternalLink size={17}/><span>Preview guest page</span></a>:null}</div>
 {data&&!data.sharing.ready&&!hasUnsavedChanges?<p>{data.sharing.reason}</p>:null}
 {data?<><div className="registration-live__counts"><span><b>{data.requested}</b>Need approval</span><span><b>{data.confirmed}</b>RSVP guests</span><span><b>{data.waiting}</b>Waitlisted</span><span><b>{data.paid}</b>Paid guests</span><span><b>{data.interested}</b>Email list</span></div><details><summary>Recent signups & changes</summary>{data.latest.length?<ul>{data.latest.map(row=><li key={row.id}><b>{row.name}</b><span>{statusLabel(row.status)} · {row.guests} {row.guests===1?'guest':'guests'}</span><time>{new Date(row.updatedAt).toLocaleString('en-GH')}</time></li>)}</ul>:<p>Guest activity appears here automatically.</p>}</details></>:null}{notice?<p role="status">{notice}</p>:null}</section>;
}
