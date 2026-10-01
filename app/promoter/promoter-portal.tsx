'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {requestJson,requestErrorMessage} from '../../lib/client-request';
import BrandLogo from '../brand-logo';
import type {Promoter} from '../organizer/workspace/suite-promote';
import {money,date} from '../organizer/workspace/suite-shared';
export default function PromoterPortal(){
 const token=useRef(''),[report,setReport]=useState<Promoter|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{
  if(!token.current)token.current=new URLSearchParams(location.hash.slice(1)).get('token')??'';
  history.replaceState(null,'',location.pathname);
  const c=new AbortController();
  void requestJson<Promoter>('/api/promoter',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:token.current}),signal:c.signal})
   .then(data=>{if(!c.signal.aborted){setReport(data);setError('');}})
   .catch(cause=>{if(!c.signal.aborted)setError(requestErrorMessage(cause));})
   .finally(()=>{if(!c.signal.aborted)setLoading(false);});
  return()=>c.abort();
 },[retry]);
 function refresh(){if(loading)return;setLoading(true);setError('');setRetry(value=>value+1);}
 return <main className="organizer-suite"><header className="suite-topbar"><Link href="/" className="night-brand-link"><BrandLogo/></Link><span>Private promoter report</span></header><div className="suite-content" style={{margin:'auto',maxWidth:900}}>{error?<p role="alert">{error}{report?' Showing the last loaded report.':null}</p>:null}{loading?<p role="status">{report?'Refreshing your report…':'Loading your report…'}</p>:null}{report?<section className="suite-section" aria-busy={loading}><header><div><p className="suite-eyebrow">{report.label}</p><h1>{report.eventTitle}</h1></div><button onClick={refresh} disabled={loading}>Refresh report</button></header><label>Your ticket link<input readOnly value={`https://tickets.becoreops.com/event/${report.eventSlug}?ref=${encodeURIComponent(report.code)}`} onFocus={e=>e.target.select()}/></label><div className="suite-stats">{[['Orders',report.orders],['Commission earned',money(report.earnedMinor)],['Payments recorded',money(report.paidMinor)],['Balance',money(report.balanceMinor)]].map(([label,value])=><article key={label}><span>{label}</span><b>{value}</b></article>)}</div><p>Current rate: {report.commissionBps/100}% of discounted ticket value, excluding booking fees. Each order keeps its rate from checkout. Refunds reduce commission.</p><h3>Payment records</h3>{report.payments.map(p=><article key={p.id}><b>{money(p.amountMinor)}</b><p>{p.reference} · {date(p.paidAt)}</p></article>)}{!report.payments.length?<p>No payment records yet. Your host records completed payments here.</p>:null}</section>:error?<button onClick={refresh} disabled={loading}>Try again</button>:null}</div></main>;
}
