// Split only explicit organiser-supplied labels. Never infer a person's role.
export function eventStory(note:string,lineup:string,quip='') {
 const contacts:{label:string;number:string;href:string}[]=[];
 const body=note.replace(/(?:event\s+)?(enquiries|inquiries|contact|bookings|call)\s*:\s*(\+?\d[\d\s()-]{7,22}\d)\.?/giu,(_match,label:string,number:string)=>{
  const digits=number.replace(/[^\d+]/gu,'');if(!/^\+?\d{8,15}$/u.test(digits))return _match;
  contacts.push({label:/booking/iu.test(label)?'Bookings':'Event enquiries',number:number.trim(),href:`tel:${digits}`});return '';
 }).trim();
 const clean=quip&&body.startsWith(quip)?body.slice(quip.length).trim():body;
 const paragraphs=clean.split(/\n\s*\n/u).flatMap(p=>{
  const sentences=p.trim().match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/gu)??[p.trim()];
  if(p.length<240)return [p.trim()];
  const groups:string[]=[];let current='';for(const sentence of sentences){if(current.length>140){groups.push(current.trim());current='';}current+=sentence;}if(current.trim())groups.push(current.trim());return groups;
 }).filter(Boolean);
 const labels:Record<string,string>={'hosted by':'Your hosts','hosts':'Your hosts','with':'With','featuring':'Featuring','music by':'On the decks','djs':'On the decks','presented by':'Presented by','supported by':'With support from'};
 const credits=lineup.split(/(?:\.\s+|\n+)(?=(?:Hosted by|Hosts\s*:|With\b|Featuring\b|Music by|DJs\s*:|Presented by|Supported by))/iu).filter(Boolean).map(part=>{
  const match=part.trim().match(/^(Hosted by|Hosts|With|Featuring|Music by|DJs|Presented by|Supported by)\s*:?\s+(.+)/iu);
  const label=match?labels[match[1].toLowerCase()]:'Line-up';
  const names=(match?match[2]:part).replace(/\.$/u,'').split(/\s*[×·;\n]\s*|,\s*|\s+(?:and|&)\s+/iu).map(n=>n.trim()).filter(Boolean);
  return {label,names};
 });
 return {paragraphs,contacts,credits};
}
