'use client';
import {useEffect,useRef,useState} from 'react';
import {operationsFetch} from '../lib/operations-client';
type Signup={id:string;name:string;status:string;guests:number;updatedAt:string};
type Snapshot={sharing:{ready:boolean;mode:string;reason:string};latest:Signup[];confirmed:number;waiting:number;requested:number;paid:number;interested:number};
const statusLabel=(status:string)=>({confirmed:'RSVP confirmed',requested:'Needs approval',waitlisted:'Waitlisted',paid:'Paid registration',interested:'Joined email list',cancelled:'Cancelled',declined:'Declined'}[status]??status);
export default function RegistrationLive({eventSlug,onChange,hasUnsavedChanges=false,settingsVersion=''}:{eventSlug:string;onChange:()=>void;hasUnsavedChanges?:boolean;settingsVersion?:string}){
 const [data,setData]=useState<Snapshot|null>(null),[connected,setConnected]=useState(false),[notice,setNotice]=useState(''),[copied,setCopied]=useState(false),[manual,setManual]=useState('');
 const changed=useRef(onChange);useEffect(()=>{changed.current=onChange;},[onChange]);
 useEffect(()=>{let stopped=false,last='',timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function refresh(){if(document.hidden){timer=setTimeout(refresh,5000);return;}const r=await operationsFetch(`/api/admin/registrations?eventSlug=${encodeURIComponent(eventSlug)}&live=1`,{signal:controller.signal});if(stopped)return;
   if(r.ok){const next=await r.json() as Snapshot;const signature=JSON.stringify(next);if(last&&last!==signature){setNotice('Guest activity updated.');changed.current();}last=signature;setData(next);setConnected(true);}else setConnected(false);
   timer=setTimeout(refresh,5000);
  }void refresh();return()=>{stopped=true;clearTimeout(timer);controller.abort();};
 },[eventSlug,settingsVersion]);
 const path=`/rsvp/${encodeURIComponent(eventSlug)}`;
 const canShare=Boolean(data?.sharing.ready)&&!hasUnsavedChanges;
 const linkLabel=data?.sharing.mode==='rsvp'?'RSVP':'registration';
 async function copy(){if(!canShare)return;const url=`${location.origin}${path}`;try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setManual(url);setNotice('Select and copy your RSVP link below.');}}
 return <section className="registration-live" aria-label="Live registrations"><header><div><b>Guest activity</b><small>{connected?'Live · refreshes every 5 seconds':'Connecting to guest updates…'}</small></div><div className="registration-actions"><button disabled={!canShare} onClick={()=>void copy()}>{copied?'Link copied':`Copy ${linkLabel} link`}</button>{hasUnsavedChanges?<span>Save settings to preview</span>:<a href={path} target="_blank" rel="noreferrer">Preview guest page</a>}</div></header>{hasUnsavedChanges?<p>Save registration settings before sharing. Your guest page still uses the last saved settings.</p>:data&&!data.sharing.ready?<p>{data.sharing.reason}</p>:null}{manual?<label>RSVP link<input readOnly value={manual} onFocus={e=>e.target.select()}/></label>:null}{data?<><div className="registration-live__counts"><span><b>{data.confirmed}</b> Free RSVP guests</span><span><b>{data.paid}</b> Paid guests</span><span><b>{data.requested}</b> Need approval</span><span><b>{data.waiting}</b> Waitlisted</span><span><b>{data.interested}</b> Email list</span></div><details><summary>Recent signups & changes</summary>{data.latest.length?<ul>{data.latest.map(row=><li key={row.id}><b>{row.name}</b><span>{statusLabel(row.status)} · {row.guests} {row.guests===1?'guest':'guests'}</span><time>{new Date(row.updatedAt).toLocaleString('en-GH')}</time></li>)}</ul>:<p>Share your link. Signups appear here after email confirmation or successful payment.</p>}</details></>:null}{notice?<p role="status">{notice}</p>:null}</section>;
}
