import Link from 'next/link';
import Image from 'next/image';
import {ArrowLeft,ArrowUpRight,CalendarDays,MapPin} from 'lucide-react';
import {eventImageUrl} from '../../event-images';
import {eventPresentationStyle} from '../../../lib/event-presentation';
import {notFound} from 'next/navigation';
import {findCuratedEvent} from '../../events';
import RegistrationForm from '../../registration-form';
import BrandLogo from '../../brand-logo';
import {registrationSettings,registrationShareState,registrationStartConfirmed} from '../../../lib/registrations';

export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params; const event=await findCuratedEvent(slug);
  if(!event)return {title:'RSVP'};
  const kind=event.registrationMode==='rsvp'?'RSVP':event.registrationMode==='interest'?'Event updates':'Registration';
  const title=`${event.title} · ${kind}`,description=`${event.fullDate} · ${event.venue}, ${event.area}. ${kind} with the host.`,image=eventImageUrl(event.image,1200,82);
  return {title,description,openGraph:{title,description,images:[{url:image,alt:`Event flier for ${event.title}`}]},twitter:{card:'summary_large_image' as const,title,description,images:[image]}};
}

export default async function EventRegistrationPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const {env}=await import('cloudflare:workers');
  const [event,settings]=await Promise.all([findCuratedEvent(slug),registrationSettings(env.DB,slug)]);
  if(!event||!settings||settings.publication!=='published')notFound();
  const sharing=registrationShareState(settings);
  const label=settings.mode==='rsvp'?'RSVP':settings.mode==='interest'?'Event updates':'Paid registration';
  const schedulePending=settings.mode==='rsvp'?!registrationStartConfirmed(settings):settings.mode==='paid'&&settings.scheduleStatus!=='confirmed';
  const unavailable=settings.eventState==='cancelled'?'This event has been cancelled.':settings.eventState==='postponed'?'Registration is paused while the host confirms a new date.':schedulePending?'Registration has not opened yet. The host is confirming the event schedule.':'Registration is closed for this event.';
  return <main className="rsvp-signup" id="register" style={eventPresentationStyle(event)}>
    <header><Link href="/events"><ArrowLeft size={16} aria-hidden="true"/>The Drop</Link><Link href="/" aria-label="BeCore Tickets"><BrandLogo/></Link><Link href={`/event/${encodeURIComponent(slug)}`}>Event details<ArrowUpRight size={15} aria-hidden="true"/></Link></header>
    <div className="rsvp-signup__layout">
      <section className="rsvp-signup__event" aria-labelledby="rsvp-event-title">
        <a className="rsvp-signup__poster" href={eventImageUrl(event.image,1440,90)} target="_blank" rel="noreferrer" aria-label={`View full flier for ${event.title}`}><Image src={eventImageUrl(event.image,960,82)} width={960} height={1423} sizes="(max-width: 700px) 90vw, 400px" alt={`Event flier for ${event.title}`} priority unoptimized/></a>
        <p className="eyebrow">{label} · {event.vibe}</p><h1 id="rsvp-event-title">{event.title}</h1>
        <div className="rsvp-signup__facts"><p><CalendarDays size={17} aria-hidden="true"/><span>{event.fullDate}{event.startsAt?<small>{event.time} · Accra time</small>:null}</span></p><p><MapPin size={17} aria-hidden="true"/><span>{event.venue}<small>{event.area}</small></span></p></div>
      </section>
      <section className="rsvp-signup__response" aria-label="Guest registration">
    {!sharing.ready?<section className="rsvp-signup__notice"><h2>{unavailable}</h2><p>Check the event page for the latest information.</p><Link href={`/event/${encodeURIComponent(slug)}`}>View event</Link></section>:settings.mode==='paid'?<section className="rsvp-signup__notice"><h2>This event uses paid registration</h2><p>Choose your tickets and leave your details at checkout. Your place is confirmed after payment.</p><Link className="ticket-action" href={`/checkout/${encodeURIComponent(slug)}`}>Choose tickets</Link></section>:<RegistrationForm eventSlug={slug} mode={settings.mode} maxPartySize={settings.maxPartySize} approvalRequired={Boolean(settings.approvalRequired)} initiallyOpen deadline={settings.closesAt??undefined}/>}
      </section>
    </div>
  </main>;
}
