import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { ArrowLeft, ArrowUpRight, BadgeCheck, Bell, CalendarDays, ChevronRight, Flame, MapPin, RefreshCw, Share2, Shirt, Ticket, Wine, X } from 'lucide-react';
import { eventPresentationVariables } from '../../lib/event-palette';
const eventPresentationStyle = (event: PublicEvent) => eventPresentationVariables(event) as React.CSSProperties;
import type { PublicCatalogue, PublicEvent } from '../../lib/public-event';
import { CATALOGUE_URL, eventImage, parseCatalogue, readCatalogue, saveCatalogue, ticketLabel } from './catalogue';
import { routeFromUrl, type Screen } from './routes';
import { openCustomerPage, shareEvent } from './platform';
import './style.css';
import { useDisclosure } from './use-disclosure';

function cachedCatalogue() { try { return readCatalogue(localStorage); } catch { return null; } }

function Poster({ event }: { event: PublicEvent }) {
  const [failed, setFailed] = useState(false);
  const src = eventImage(event.image);
  return <div className="poster" style={eventPresentationStyle(event)}>{src && !failed
    ? <img src={src} alt={`${event.title} event poster`} loading="lazy" onError={() => setFailed(true)} />
    : <span className="poster-fallback"><CalendarDays aria-hidden="true" /><span>{event.title}</span></span>}</div>;
}

function Countdown({ startsAt }: { startsAt: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  if (!startsAt) return null;
  const minutes = Math.floor((Date.parse(startsAt) - now) / 60000);
  if (minutes < 1) return null;
  return <p className="countdown"><span>The wait</span><b>{Math.floor(minutes / 1440)}<small>d</small> {Math.floor(minutes / 60) % 24}<small>h</small> {minutes % 60}<small>m</small></b></p>;
}

function App() {
  const [screen, setScreen] = useState<Screen>({ tab: 'drop' });
  const [catalogue, setCatalogue] = useState<PublicCatalogue | null>(cachedCatalogue);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(Boolean(catalogue));
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const disclosure = useDisclosure();
  const menu = disclosure.open;
  const closeMenu = disclosure.close;
  const menuOpen = useRef(menu);
  menuOpen.current = menu;
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const request = useRef<AbortController | null>(null);
  const screenRef = useRef(screen);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  screenRef.current = screen;

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setLoading(true); setError('');
    try {
      const response = await fetch(CATALOGUE_URL, { credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = parseCatalogue(await response.json());
      if (request.current !== controller) return;
      setCatalogue(data); setStale(false);
      try { saveCatalogue(localStorage, data); } catch { /* Public cache is optional. */ }
    } catch {
      if (request.current !== controller) return;
      setStale(true); setError('The Drop couldn’t refresh. Check your connection and try again.');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); return () => { request.current?.abort(); request.current = null; }; }, [refresh]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const go = (url: string) => { const next = routeFromUrl(url); if (active && next) { closeMenu(); setScreen(next); } };
    const handles = [
      NativeApp.addListener('appUrlOpen', ({ url }) => go(url)),
      NativeApp.addListener('appStateChange', ({ isActive }) => { if (active && isActive) void refresh(); }),
      NativeApp.addListener('backButton', () => {
        if (menuOpen.current) closeMenu();
        else if (screenRef.current.slug || screenRef.current.tab !== 'drop') setScreen({ tab: 'drop' });
        else void NativeApp.minimizeApp();
      }),
      Network.addListener('networkStatusChange', ({ connected }) => { if (active && connected) void refresh(); }),
    ];
    void NativeApp.getLaunchUrl().then(result => { if (result?.url) go(result.url); });
    return () => { active = false; handles.forEach(handle => void handle.then(listener => listener.remove())); };
  }, [refresh, closeMenu]);
  useEffect(() => { closeMenu(); setNotice(''); window.scrollTo(0, 0); heading.current?.focus(); }, [screen, closeMenu]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !menuButton.current?.contains(event.target as Node)) closeMenu(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeMenu(); menuButton.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [menu, closeMenu]);

  async function open(path: string) {
    if (opening) return;
    setOpening(true); setNotice(''); closeMenu();
    try { await openCustomerPage(path); } catch { setNotice('That page couldn’t open. Give it another go.'); }
    finally { setOpening(false); }
  }
  const event = screen.slug ? catalogue?.events.find(item => item.slug === screen.slug) : null;
  useEffect(() => {
    if (Capacitor.isNativePlatform()) void SystemBars.setStyle({ style: event ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => { /* The native default remains visible. */ });
  }, [event]);
  const events = catalogue?.events.filter(item => filter === 'All' || item.vibe === filter) ?? [];
  const title = screen.slug ? (event?.title ?? 'Event') : screen.tab === 'drop' ? 'The Drop' : screen.tab === 'nights' ? 'My Nights' : 'The Buzz';

  return <div className={`app${event ? ' event-page' : ''}`} style={event ? eventPresentationStyle(event) : undefined}>
    <header className="header">
      {screen.slug ? <button className="icon-button" aria-label="Back to The Drop" onClick={() => setScreen({ tab: 'drop' })}><ArrowLeft /></button>
        : <span className="brand"><img src="/becore-ticket.webp" alt="" /><span><b>BeCore</b><small>Tickets</small></span></span>}
      {screen.slug && <span className="header-label">The Drop</span>}
      <button ref={menuButton} className="icon-button menu-trigger" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="more-navigation" onClick={disclosure.toggle}><span aria-hidden="true">{menu ? <X /> : '•••'}</span></button>
      {disclosure.mounted && <div inert={!menu} aria-hidden={!menu} data-phase={disclosure.phase} ref={menuRef} id="more-navigation" className="more-menu" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== menuButton.current) closeMenu(); }}>
        <nav aria-label="More"><button onClick={() => void open('/help')}>Help <ArrowUpRight /></button><button onClick={() => void open('/account/privacy')}>Privacy <ArrowUpRight /></button></nav>
      </div>}
    </header>
    <main>
      <div className="title-row"><div>{!screen.slug && <p className="eyebrow">Accra, Ghana</p>}<h1 ref={heading} tabIndex={-1}>{title}</h1></div>{screen.tab === 'drop' && !screen.slug && <button className={`icon-button${loading ? ' refreshing' : ''}`} aria-label="Refresh events" disabled={loading} onClick={() => void refresh()}><RefreshCw /></button>}</div>
      {notice && <p role="status" className="status">{notice}</p>}
      {screen.tab === 'drop' && <>
        {error && <div className="status" role="alert"><p>{error}</p><button disabled={loading} onClick={() => void refresh()}>Try again</button></div>}
        {stale && catalogue && <p className="cache-note">Saved events · Updated {new Date(catalogue.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Availability is checked again online.</p>}
        {loading && !catalogue && <div aria-label="Loading events" role="status" className="loading-grid"><div /><div /></div>}
        {screen.slug ? event ? <article className="event-detail">
          <Poster key={event.slug} event={event} />
          {event.isVerified && <p className="verified"><BadgeCheck />Verified event</p>}
          {event.quip && <p className="event-quip">{event.quip}</p>}
          <Countdown startsAt={event.startsAt} />
          <dl className="details-grid">
            <div><dt><CalendarDays />The plan</dt><dd>{event.fullDate}{event.startsAt && <small>{event.time}</small>}</dd></div>
            <div><dt><MapPin />Find us</dt><dd>{event.venue}<small>{event.area}</small></dd></div>
            {event.dressCode && <div><dt><Shirt />The look</dt><dd>{event.dressCode}</dd></div>}
            {event.guestPerk && <div><dt>{/grill|braai/i.test(event.guestPerk) ? <Flame /> : <Wine />}The good stuff</dt><dd>{event.guestPerk}</dd></div>}
          </dl>
          {event.note && <p className="description">{event.note}</p>}
          {event.awarenessNote && <p className="description">{event.awarenessNote}</p>}
          {event.lineup && <section className="lineup"><h2>In good company</h2><p>{event.lineup}</p></section>}
          <div className="ticket-action"><p><strong>{ticketLabel(event)}</strong>{event.ageRestriction && <small>{event.ageRestriction}</small>}</p>
            {(event.ticketsAvailable || event.registrationOpen) && !stale && <button className="primary" disabled={opening} onClick={() => void open(`/event/${event.slug}`)}>{event.registrationMode === 'rsvp' ? 'RSVP for free' : event.registrationMode === 'interest' ? 'Keep me posted' : 'Get tickets'} <ArrowUpRight /></button>}
            <button className="text-action" onClick={async () => { try { setNotice(await shareEvent(event.slug, event.title)); } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setNotice('Sharing couldn’t open. Try again.'); } }}><Share2 />Bring your people</button>
          </div>
        </article> : !loading && <section className="empty"><h2>This one isn’t on the list.</h2><p>It may have moved. The Drop has the latest.</p><button className="primary" onClick={() => setScreen({ tab: 'drop' })}>Back to The Drop</button></section>
        : <>
          <p className="intro">Good plans don’t make themselves.</p>
          {catalogue && catalogue.events.length > 0 && <nav className="filters" aria-label="Event mood">{['All', ...new Set(catalogue.events.map(item => item.vibe))].map(vibe => <button key={vibe} aria-pressed={filter === vibe} onClick={() => setFilter(vibe)}>{vibe}</button>)}</nav>}
          <div className="event-grid">{events.map(item => <button className="event-card" key={item.slug} onClick={() => setScreen({ tab: 'drop', slug: item.slug })}>
            <Poster event={item} /><span className="card-date">{item.fullDate}</span><h2>{item.title}</h2><span className="card-venue">{item.venue}<small>{item.area}</small></span><span className="card-quip">{item.quip}</span><span className="card-price">{ticketLabel(item)}</span><span className="card-footer">{item.isVerified && <span className="verified"><BadgeCheck />Verified event</span>}<ChevronRight aria-hidden="true" /></span>
          </button>)}</div>
          {!loading && !error && events.length === 0 && <section className="empty"><h2>The next good plan is on its way.</h2><p>Check back for fresh drops.</p></section>}
        </>}
      </>}
      {screen.tab === 'nights' && <section className="account-entry"><Ticket className="entry-icon" /><h2>Your way in. Your people inside.</h2><p>Tickets, entry passes and The Room live in My Nights. Use your checkout email to find yours.</p><button disabled={opening} className="primary" onClick={() => void open('/my-nights')}>{opening ? 'Opening…' : 'Open My Nights'}<ArrowUpRight /></button><small>Opens securely in your browser. Your ticket access stays there during this first app build.</small></section>}
      {screen.tab === 'buzz' && <section className="account-entry"><Bell className="entry-icon" /><h2>Word from your nights.</h2><p>Host updates and the changes worth knowing about, all in your private inbox.</p><button disabled={opening} className="primary" onClick={() => void open('/notifications')}>{opening ? 'Opening…' : 'Open The Buzz'}<ArrowUpRight /></button><small>Opens your secure inbox in the browser. Native notifications are on the way.</small></section>}
    </main>
    <nav className="dock" aria-label="Main">{([{ tab: 'drop', label: 'The Drop', Icon: CalendarDays }, { tab: 'nights', label: 'My Nights', Icon: Ticket }, { tab: 'buzz', label: 'The Buzz', Icon: Bell }] as const).map(({ tab, label, Icon }) => <button key={tab} aria-current={screen.tab === tab ? 'page' : undefined} onClick={() => setScreen({ tab })}><Icon /><span>{label}</span></button>)}</nav>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
