// Standalone device preview data. Never imports a database or authenticates a user.
const event={slug:'fixture-night',title:'Fictional Friday',startsAt:'2026-11-13T20:00:00Z',endsAt:'2026-11-14T05:00:00Z',status:'published',eventState:'on_sale',venue:'Fictional Courtyard',area:'Accra',capacity:200,isLead:1,pendingRequests:0,admissions:60,arrivals:2,salesMinor:10000};
const guests=Array.from({length:60},(_,i)=>({id:String(i),kind:'order',name:`Fictional guest ${i+1}`,email:`guest${i+1}@example.test`,reference:`BOOK-${i}`,status:'paid',admissions:1,arrivals:0,amountMinor:15000,source:'paid_ticket'}));
const contacts=Array.from({length:60},(_,i)=>({name:`Fictional subscriber ${i+1}`,email:`person${String(i+1).padStart(2,'0')}@example.test`,consentedAt:'2026-10-26T11:00:00Z',consentVersion:'yorkeway-year-end-2026-v1'}));
export function fixtureResponse(url){
 const q=(url.searchParams.get('q')||'').toLowerCase();
 if(url.pathname==='/api/admin/yorkeway-audience'){
  const matching=contacts.filter(c=>(c.name+' '+c.email).toLowerCase().includes(q));
  const page=matching.filter(c=>c.email>(url.searchParams.get('after')||''));
  return {contacts:page.slice(0,25),summary:{subscribed:60,withdrawn:3},matching:matching.length,nextCursor:page.length>25?page[24].email:null,emailOwnershipVerified:false,deliveryEnabled:false};
 }
 switch(url.searchParams.get('section')){
  case 'events':return {events:[event]};
  case 'guests':{const rows=guests.filter(g=>(g.name+' '+g.email+' '+g.reference).toLowerCase().includes(q)&&(!url.searchParams.get('status')||g.status===url.searchParams.get('status'))),offset=Number(url.searchParams.get('offset')||0);return {counts:{records:rows.length,admissions:60,arrivals:2},rows:q||url.searchParams.get('show')==='1'?rows.slice(offset,offset+25):[]};}
  case 'guest_detail':return {financialScope:'tickets',canRequestRefund:false,record:guests.find(g=>g.id===url.searchParams.get('id'))||guests[0],orderId:'fixture-order',tickets:[],delivery:[],confirmation:null,questions:[]};
  case 'submissions':return {submissions:[]};
  default:return null;
 }
}
