/** Host invitations can return only to their server-verified claimed event. */
export function ticketAccessRedirect(kind:'recovery'|'transfer'|'host',redirectTo:string,eventSlug:string|undefined,origin:string) {
 const target=new URL(redirectTo,origin);
 const safePath=kind==='host'
  ? typeof eventSlug==='string' && /^[a-z0-9-]{1,120}$/u.test(eventSlug) && target.pathname===`/room/${eventSlug}` && !target.search && !target.hash
  : /^\/my-nights(?:\/|$)/u.test(target.pathname);
 if(target.origin!==origin || target.username || target.password || !safePath)throw new Error('Your ticket is saved. Open My Nights to find it.');
 return target.href;
}
