import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { Browser } from '@capacitor/browser';
import { eventPresentationStyle } from '../../lib/event-presentation';
import { RefreshCw } from 'lucide-react';
import '../../styles/customer.css';
import HomeScreen from '../../app/home-screen';
import EventsScreen from '../../app/events/events-screen';
import EventScreen from '../../app/event/[slug]/event-screen';
import CustomerDock from '../../app/customer-dock';
import { CustomerRuntimeProvider } from '../../app/customer-runtime';
import { Navigation } from './adapters/navigation';
import { CATALOGUE_URL, WEB_ORIGIN, readCatalogue, saveCatalogue } from './catalogue';
import { parseScreenCatalogue } from './screen-catalogue';
import { routeFromUrl, screenPath } from './routes';
import { openCustomerPage, shareCustomerEvent } from './platform';
import './style.css';

type Catalogue = ReturnType<typeof parseScreenCatalogue>;
function cachedCatalogue(): Catalogue | null { try { return parseScreenCatalogue(readCatalogue(localStorage)); } catch { return null; } }
function localPath() {
  const screen = routeFromUrl(new URL(location.pathname, WEB_ORIGIN).href);
  return screen && ['home', 'drop'].includes(screen.tab) ? screenPath(screen) : '/';
}

function App() {
  const [pathname, setPathname] = useState(localPath);
  const path = useRef(pathname); path.current = pathname;
  const [catalogue, setCatalogue] = useState<Catalogue | null>(cachedCatalogue);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(Boolean(catalogue));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const positions = useRef(new Map<string, number>());
  const opening = useRef(false);
  const swipe = useRef<{ x: number; y: number; time: number } | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setLoading(true); setError('');
    try {
      const response = await fetch(CATALOGUE_URL, { credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = parseScreenCatalogue(await response.json());
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

  const openSecurePage = useCallback(async (href: string) => {
    if (opening.current) return;
    opening.current = true; setNotice('');
    try { await openCustomerPage(href); }
    catch { setNotice('That page couldn’t open. Give it another go.'); }
    finally { opening.current = false; }
  }, []);

  const navigate = useCallback((href: string) => {
    if (href.startsWith('#')) { document.getElementById(href.slice(1))?.scrollIntoView(); return; }
    const url = new URL(href, WEB_ORIGIN);
    const next = routeFromUrl(url.href);
    if (next && ['home', 'drop'].includes(next.tab) && !url.search && !url.hash) {
      const nextPath = screenPath(next);
      if (path.current === nextPath) { window.scrollTo(0, 0); return; }
      positions.current.set(path.current, window.scrollY);
      history.pushState(null, '', nextPath); setPathname(nextPath); setNotice('');
    } else void openSecurePage(url.href);
  }, [openSecurePage]);

  useEffect(() => { void refresh(); return () => { request.current?.abort(); request.current = null; }; }, [refresh]);
  useEffect(() => {
    history.scrollRestoration = 'manual';
    const back = () => { positions.current.set(path.current, window.scrollY); setPathname(localPath()); };
    window.addEventListener('popstate', back);
    // Plain calendar/contact links follow the same explicit platform routing.
    const anchor = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link) return;
      const href = link.getAttribute('href')!;
      if (href.startsWith('tel:') || href.startsWith('mailto:')) return;
      event.preventDefault(); navigate(href);
    };
    document.addEventListener('click', anchor);
    return () => { window.removeEventListener('popstate', back); document.removeEventListener('click', anchor); };
  }, [navigate]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const go = (url: string) => { const next = routeFromUrl(url); if (active && next) navigate(screenPath(next)); };
    const handles = [
      NativeApp.addListener('appUrlOpen', ({ url }) => go(url)),
      Browser.addListener('browserFinished', () => { if (active) void refresh(); }),
      NativeApp.addListener('appStateChange', ({ isActive }) => { if (active && isActive) void refresh(); }),
      NativeApp.addListener('backButton', () => {
        if (document.querySelector('.night-mobile-menu.is-open')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        else if (path.current !== '/') navigate(path.current.startsWith('/event/') ? '/events' : '/');
        else void NativeApp.minimizeApp();
      }),
      Network.addListener('networkStatusChange', ({ connected }) => { if (active && connected) void refresh(); }),
    ];
    void NativeApp.getLaunchUrl().then(result => { if (result?.url) go(result.url); });
    return () => { active = false; handles.forEach(handle => void handle.then(listener => listener.remove())); };
  }, [refresh, navigate]);
  useLayoutEffect(() => {
    window.scrollTo(0, positions.current.get(pathname) ?? 0);
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [pathname]);
  const current = catalogue?.screens.find(item => `/event/${item.event.slug}` === pathname);
  useEffect(() => {
    document.title = `${current?.event.title ?? (pathname === '/' ? 'Home' : 'The Drop')} · BeCore Tickets`;
    if (Capacitor.isNativePlatform()) void SystemBars.setStyle({ style: current ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
  }, [current, pathname]);
  const runtime = useMemo(() => ({ openSecurePage, share: shareCustomerEvent, stale }), [openSecurePage, stale]);
  const events = catalogue?.screens.map(item => item.event) ?? [];

  return <Navigation.Provider value={{ pathname, navigate }}><CustomerRuntimeProvider value={runtime}>
    <div className="packaged-customer" style={current ? { ...eventPresentationStyle(current.event), backgroundColor: "var(--event-field)" } : undefined} onTouchStart={event => {
      const touch = event.touches[0];
      swipe.current = pathname.startsWith('/event/') && touch.clientX < 24 ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
    }} onTouchEnd={event => {
      const start = swipe.current, end = event.changedTouches[0]; swipe.current = null;
      if (start && end && end.clientX - start.x > 96 && Math.abs(end.clientY - start.y) < 45 && Date.now() - start.time < 650) navigate('/events');
    }} onTouchCancel={() => { swipe.current = null; }}>
      {(error || notice || stale && catalogue) && <div className="catalogue-status">
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {stale && catalogue && <p>Saved events · Updated {new Date(catalogue.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' })}. Availability is checked again online.</p>}
        {error && <button disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} />Try again</button>}
      </div>}
      {!catalogue ? <main className="catalogue-loading"><h1>{loading ? 'Lining up your plans.' : 'The Drop is taking a breather.'}</h1>{loading && <div role="status" aria-label="Loading events" className="catalogue-skeleton"><i /><i /><span /><span /></div>}</main>
        : pathname === '/' ? <HomeScreen events={events} />
        : pathname === '/events' ? <EventsScreen events={events} />
        : current ? <EventScreen key={current.event.slug} {...current} />
        : <main className="catalogue-loading"><h1>This one isn’t on the list.</h1><p>It may have moved. The Drop has the latest.</p><button onClick={() => navigate('/events')}>Back to The Drop</button></main>}
      <CustomerDock />
    </div>
  </CustomerRuntimeProvider></Navigation.Provider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
