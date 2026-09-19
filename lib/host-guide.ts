export function preferredHostEvent<T extends {slug:string;startsAt:string;endsAt:string;eventState:string;status:string}>(events:T[], requested?:string|null, now=Date.now()) {
  const explicit=events.find(e=>e.slug===requested);if(explicit)return explicit.slug;
  const upcoming=events.filter(e=>Date.parse(e.endsAt)>=now&&!['cancelled','archived'].includes(e.eventState)&&e.status!=='archived')
    .sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  return upcoming[0]?.slug ?? [...events].sort((a,b)=>Date.parse(b.endsAt)-Date.parse(a.endsAt))[0]?.slug ?? '';
}
