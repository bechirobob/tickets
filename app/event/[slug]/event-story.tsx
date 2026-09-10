import {ArrowUpRight,Phone,UsersRound,Music2} from 'lucide-react';
import {eventStory} from '../../../lib/event-story';
export default function EventStory({note,lineup,quip,ageRestriction,showEntry}:{note:string;lineup:string;quip:string;ageRestriction:string;showEntry:boolean}){
 const story=eventStory(note,lineup,quip);
 return <section className="event-story-content"><div className="event-story-intro"><p className="eyebrow">The plan</p>{quip?<h2>{quip}</h2>:null}{story.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</div>
 <div className="event-credits">{story.credits.map((group,i)=><section key={i} aria-label={group.label}><h3>{group.label==='On the decks'?<Music2 size={17}/>:<UsersRound size={17}/>} {group.label}</h3><ul>{group.names.map((name,index)=><li key={index}>{name}</li>)}</ul></section>)}</div>
 {story.contacts.length?<section className="event-enquiries"><div><h3>Need the inside info?</h3><p>Ask the event team.</p></div>{story.contacts.map(contact=><a key={contact.href} href={contact.href} aria-label={`Call ${contact.label.toLowerCase()} ${contact.number}`}><Phone size={18}/><span><b>{contact.label}</b>{contact.number}</span><ArrowUpRight size={17}/></a>)}</section>:null}
 {showEntry?<p className="event-entry-note">{ageRestriction} · Bring your ID. One scan gets one guest in.</p>:null}</section>;
}
