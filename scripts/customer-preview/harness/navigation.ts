import {useSyncExternalStore} from 'react';
const original=history.pushState.bind(history);
history.pushState=(...args)=>{original(...args);window.dispatchEvent(new Event('preview:navigation'));};
const subscribe=(callback:()=>void)=>{window.addEventListener('popstate',callback);window.addEventListener('preview:navigation',callback);return()=>{window.removeEventListener('popstate',callback);window.removeEventListener('preview:navigation',callback);};};
const location=()=>window.location.pathname+window.location.search;
export const usePathname=()=>useSyncExternalStore(subscribe,location).split('?')[0];
export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,location).split('?')[1]);
export const useRouter=()=>({push:(url:string)=>history.pushState(null,'',url),replace:(url:string)=>{history.replaceState(null,'',url);window.dispatchEvent(new Event('preview:navigation'));},refresh:()=>window.dispatchEvent(new Event('preview:navigation'))});
