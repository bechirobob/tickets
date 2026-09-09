import Link from 'next/link';
import {notFound} from 'next/navigation';
import {findCuratedEvent} from '../../events';
import RegistrationForm from '../../registration-form';
import BrandLogo from '../../brand-logo';
import {registrationSettings,registrationShareState,registrationStartConfirmed} from '../../../lib/registrations';

export const dynamic='force-dynamic';
export const metadata={title:'Event registration'};

export default async function EventRegistrationPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const {env}=await import('cloudflare:workers');
  const [event,settings]=await Promise.all([findCuratedEvent(slug),registrationSettings(env.DB,slug)]);
  if(!event||!settings||settings.publication!=='published')notFound();
  const sharing=registrationShareState(settings);
  const label=settings.mode==='rsvp'?'Free RSVP':settings.mode==='interest'?'Event updates':'Paid registration';
  const schedulePending=settings.mode==='rsvp'?!registrationStartConfirmed(settings):settings.mode==='paid'&&settings.scheduleStatus!=='confirmed';
  const unavailable=settings.eventState==='cancelled'?'This event has been cancelled.':settings.eventState==='postponed'?'Registration is paused while the host confirms a new date.':schedulePending?'Registration has not opened yet. The host is confirming the event schedule.':'Registration is closed for this event.';
  return <main className="rsvp-signup" id="register">
    <header><Link href="/events" aria-label="BeCore Tickets — events"><BrandLogo/></Link><Link href={`/event/${encodeURIComponent(slug)}`}>Event details ↗</Link></header>
    <p className="eyebrow">{label}</p><h1>{event.title}</h1>
    <p className="rsvp-signup__facts">{event.fullDate} · {event.venue}, {event.area}</p>
    {!sharing.ready?<section className="rsvp-signup__notice"><h2>{unavailable}</h2><p>Check the event page for the latest information.</p><Link href={`/event/${encodeURIComponent(slug)}`}>View event</Link></section>:settings.mode==='paid'?<section className="rsvp-signup__notice"><h2>This event uses paid registration</h2><p>Choose your tickets and leave your details at checkout. Your place is confirmed after payment.</p><Link className="ticket-action" href={`/checkout/${encodeURIComponent(slug)}`}>Choose tickets</Link></section>:<RegistrationForm eventSlug={slug} mode={settings.mode} maxPartySize={settings.maxPartySize} approvalRequired={Boolean(settings.approvalRequired)} initiallyOpen deadline={settings.closesAt??undefined}/>}
  </main>;
}
