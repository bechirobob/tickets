'use client';
import { useEffect, useRef, useState } from 'react';
import { requestJson, requestErrorMessage } from '../../../lib/client-request';

const endpoint = '/api/organizer/notifications/subscription';
type Config = { available: boolean; deviceSubscribed: boolean; publicKey: string | null };
async function registration() {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Alerts are not ready. Refresh and try again.')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
const choices=new Set<string>();
function choiceKey(accountId:string){return `bct:host-notifications:choice:v1:${accountId}`;}
function seenChoice(key:string){try{return choices.has(key)||localStorage.getItem(key)==='seen';}catch{return choices.has(key);}}
function rememberChoice(key:string){choices.add(key);try{localStorage.setItem(key,'seen');}catch{/* Memory still avoids repeat prompts in this page session. */}}
export default function HostRsvpAlerts({accountId,mode='settings',owner=false}:{accountId?:string;mode?:'settings'|'prompt';owner?:boolean}={}) {
  const prompt=mode==='prompt',key=accountId?choiceKey(accountId):null;
  const [hidden,setHidden]=useState(true);
  const [attempt,setAttempt]=useState(0);
  const [state, setState] = useState('loading'), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const active = useRef(false), loadVersion = useRef(0);
  const dismiss=()=>{++loadVersion.current;if(key)rememberChoice(key);setHidden(true);};
  const retry=()=>{setState('loading');setMessage('');setAttempt(value=>value+1);};
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (active.current) return;
      const version = ++loadVersion.current;
      if(prompt&&(!key||seenChoice(key))){setHidden(true);return;}
      const ios = /iPhone|iPad|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios && !window.matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & {standalone?:boolean}).standalone) { setState('install'); setHidden(false); return; }
      if (!('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window)) { setState('unsupported'); setHidden(false); return; }
      try {
        const subscription = await (await registration()).pushManager.getSubscription();
        const config = await requestJson<Config>(endpoint + (subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ''));
        if (!stopped && !active.current && version === loadVersion.current) {
          setState(config.deviceSubscribed ? 'on' : Notification.permission === 'denied' ? 'denied' : config.available ? 'ready' : 'unavailable');
          if(prompt&&config.deviceSubscribed){if(key)rememberChoice(key);setHidden(true);}else setHidden(prompt&&!!key&&seenChoice(key));
        }
      } catch {
        if (!stopped && !active.current && version === loadVersion.current) {
          setState('unavailable');
          setHidden(prompt&&!!key&&seenChoice(key));
        }
      }
    };
    void load(); window.addEventListener('focus', load); window.addEventListener('storage',load); window.addEventListener('host-notifications-updated',load);
    return () => { stopped = true; window.removeEventListener('focus', load); window.removeEventListener('storage',load); window.removeEventListener('host-notifications-updated',load); };
  }, [prompt,key,attempt]);
  async function change() {
    if (active.current) return;
    ++loadVersion.current;
    active.current = true; setBusy(true); setMessage('');
    const enable = state !== 'on';
    if(key)rememberChoice(key);
    try {
      // Ask directly from the tap, before any asynchronous setup.
      if (enable && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'ready'); setMessage('Alerts stayed off. You can enable them later.'); return; }
      }
      const worker = await registration();
      let subscription = await worker.pushManager.getSubscription();
      if (enable) {
        const config = await requestJson<Config>(endpoint);
        if (!config.available || !config.publicKey) throw new Error('Phone alerts are unavailable. You can still check your guest list.');
        const decoded = atob(config.publicKey.replaceAll('-', '+').replaceAll('_', '/'));
        subscription ??= await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(decoded, c => c.charCodeAt(0))});
        await requestJson(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(subscription.toJSON())});
      } else if (subscription) {
        // Guest subscriptions can share this browser; disable only the host record.
        await requestJson(endpoint,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});
      }
      setState(enable ? 'on' : 'ready'); setMessage(enable ? 'Host notifications are on for this device.' : 'Host notifications are off for this device.');
      if(prompt)setHidden(true);window.dispatchEvent(new Event('host-notifications-updated'));
    } catch (error) { setMessage(requestErrorMessage(error)); }
    finally { active.current = false; setBusy(false); }
  }
  const help:Record<string,string> = {loading:'Checking this device…',ready:owner?'Get browser notifications for confirmed ticket purchases and incoming RSVPs across all events. Alerts are shared between Operations and your host workspace.':'Get browser notifications for confirmed ticket purchases and incoming RSVPs to your events. Host RSVP emails are off; other emails are unchanged.',on:'Confirmed ticket purchases and new RSVPs will appear on this device. Alerts stay on while you’re signed in. Enable them again after signing back in.',install:'On iPhone or iPad, add Tickets to your Home Screen, open it there, sign in, then enable notifications.',unsupported:'This browser does not support phone alerts. You can still check your guest list.',denied:'Notifications are blocked. Allow them in your browser settings, then return here.',unavailable:'Phone alerts are unavailable right now. You can still check your guest list.'};
  if(prompt){
    if(hidden)return null;
    return <aside className="host-notification-prompt" role="dialog" aria-label="Host notifications"><h2>Keep up with your guests</h2><p>{help[state]}</p>{state==='ready'?<button type="button" disabled={busy} onClick={()=>void change()}>{busy?'Saving…':'Enable notifications'}</button>:null}{state==='unavailable'?<button type="button" onClick={retry}>Try again</button>:null}<button type="button" disabled={busy} onClick={dismiss}>Not now</button><p>Change this anytime in Account settings.</p><p role="status">{message}</p></aside>;
  }
  return <section className="suite-section host-rsvp-alerts"><h2>Ticket & RSVP notifications</h2><p>{help[state]}</p>{['ready','on'].includes(state)?<button type="button" disabled={busy} aria-busy={busy} onClick={()=>void change()}>{busy?'Saving…':state==='on'?'Turn off host notifications':'Enable notifications'}</button>:null}{state==='unavailable'?<button type="button" onClick={retry}>Try again</button>:null}<p role="status">{message}</p></section>;
}
