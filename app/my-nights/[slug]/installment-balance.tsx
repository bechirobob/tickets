'use client';
import { useEffect,useRef,useState } from 'react';
export default function InstallmentBalance({orderId,currency,collectedMinor,balanceMinor,stepMinor,canPay}:{orderId:string;currency:string;collectedMinor:number;balanceMinor:number;stepMinor:number;canPay:boolean}) {
 const paymentAttempts=useRef<Partial<Record<'installment'|'balance',string>>>({});
 const [balance,setBalance]=useState({collectedMinor,balanceMinor,stepMinor});
 useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;let attempts=0;async function check(){try{const response=await fetch(`/api/payments/installments?orderId=${encodeURIComponent(orderId)}`,{cache:"no-store",signal:controller.signal});if(!response.ok)return;const data=await response.json() as {balance?:typeof balance;pending?:boolean};if(data.balance){setBalance(data.balance);if(!data.pending){for(const choice of ['installment','balance'] as const){const key=`bct:balance:${orderId}:${choice}`;try{const startedAt=sessionStorage.getItem(`${key}:collected`);if(startedAt!==null&&data.balance.collectedMinor>Number(startedAt)){sessionStorage.removeItem(key);sessionStorage.removeItem(`${key}:collected`);delete paymentAttempts.current[choice];}}catch{/* Storage is optional. */}}}if(data.balance.balanceMinor===0&&balanceMinor>0){window.location.reload();return;}}if(data.pending&&++attempts<24)timer=setTimeout(()=>void check(),5000);}catch{/* Existing balance stays visible offline. */}}void check();return()=>{controller.abort();clearTimeout(timer);};},[orderId,balanceMinor]);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 const money=(n:number)=>new Intl.NumberFormat('en-GH',{style:'currency',currency}).format(n/100);
 async function pay(choice:'installment'|'balance'){
  if(busy)return;setBusy(true);setMessage('');
  const storageKey=`bct:balance:${orderId}:${choice}`;
  if(!paymentAttempts.current[choice]) {try{paymentAttempts.current[choice]=sessionStorage.getItem(storageKey)||crypto.randomUUID();sessionStorage.setItem(storageKey,paymentAttempts.current[choice]!);if(sessionStorage.getItem(`${storageKey}:collected`)===null)sessionStorage.setItem(`${storageKey}:collected`,String(balance.collectedMinor));}catch{paymentAttempts.current[choice]=crypto.randomUUID();}}
  try{const response=await fetch('/api/payments/installments',{method:'POST',headers:{'content-type':'application/json','idempotency-key':paymentAttempts.current[choice]!},body:JSON.stringify({orderId,choice}),signal:AbortSignal.timeout(20000)});
   const result=await response.json() as {authorizationUrl?:string;error?:string;confirmed?:boolean};
   if(result.confirmed){try{sessionStorage.removeItem(storageKey);sessionStorage.removeItem(`${storageKey}:collected`);}catch{}window.location.reload();return;}
   if(!response.ok||!result.authorizationUrl)throw new Error(result.error??'Payment is being checked. Please wait.');
   const url=new URL(result.authorizationUrl);if(url.origin!=='https://pay.seevplus.com'||url.username||url.password)throw new Error('Payment link unavailable.');window.location.assign(url.href);
  }catch(error){setMessage(error instanceof Error?error.message:'Payment is being checked. Do not pay again yet.');setBusy(false);}
 }
 return <section aria-label="Payment balance"><p>Paid {money(balance.collectedMinor)} · Remaining {money(balance.balanceMinor)}</p>{balance.balanceMinor>0 && canPay?<><p>Room access is ready. Pay the balance before entry.</p><button type="button" disabled={busy} onClick={()=>void pay('installment')}>Pay {money(Math.min(balance.stepMinor,balance.balanceMinor))}</button>{balance.balanceMinor>balance.stepMinor?<button type="button" disabled={busy} onClick={()=>void pay('balance')}>Pay full balance</button>:null}</>:null}<p role="status">{message}</p></section>;
}
