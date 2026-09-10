import { WEB_ORIGIN } from './catalogue.ts';
export type Screen = { tab: 'home' | 'drop' | 'nights' | 'buzz'; slug?: string };
const validSlug = /^[a-z0-9-]{1,80}$/;
export function routeFromUrl(input: string): Screen | null {
  try {
    if (/(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(input)) return null;
    const url = new URL(input);
    let path = url.pathname;
    if (url.protocol === 'becoretickets:') path = `/${url.hostname}${url.pathname}`;
    else if (url.origin !== WEB_ORIGIN) return null;
    if (url.username || url.password) return null;
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 2 && parts[0] === 'event' && validSlug.test(parts[1])) return { tab: 'drop', slug: parts[1] };
    if (path === '/') return { tab: 'home' };
    if (path === '/events') return { tab: 'drop' };
    if (path === '/my-nights') return { tab: 'nights' };
    if (path === '/notifications') return { tab: 'buzz' };
    return null;
  } catch { return null; }
}
export function screenPath(screen: Screen): string {
  return screen.slug ? `/event/${screen.slug}` : screen.tab === 'home' ? '/' : screen.tab === 'drop' ? '/events' : screen.tab === 'nights' ? '/my-nights' : '/notifications';
}
export function customerUrl(path: string): string {
  if (/(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(path)) throw new Error('Unsupported destination');
  const url = new URL(path, WEB_ORIGIN);
  if (url.origin !== WEB_ORIGIN || url.username || url.password
    || !/^\/(?:|events|event\/[a-z0-9-]{1,80}|rsvp\/[a-z0-9-]{1,80}|checkout\/[a-z0-9-]{1,80}|my-nights|notifications|help|account\/privacy|privacy|terms|about|hosts(?:\/[a-z0-9-]{1,80})?|organizer\/submit|admin\/login|api\/calendar\/[a-z0-9-]{1,80})$/.test(url.pathname)
    || [...url.searchParams.keys()].some(key => key !== 'ref')
    || (url.search && !/^[A-Z0-9_-]{1,32}$/.test(url.searchParams.get('ref') ?? ''))
    || (url.hash && !['#register', '#purchase'].includes(url.hash))) throw new Error('Unsupported destination');
  return url.href;
}

/** External venue maps get browser isolation, never access to the native bridge. */
export function browserUrl(input: string): string {
  const url = new URL(input, WEB_ORIGIN);
  if (url.origin === WEB_ORIGIN) return customerUrl(input);
  if (url.protocol !== 'https:' || url.username || url.password
    || !['maps.google.com', 'maps.app.goo.gl', 'www.google.com', 'maps.apple.com'].includes(url.hostname)
    || (url.hostname === 'www.google.com' && !url.pathname.startsWith('/maps'))) throw new Error('Unsupported destination');
  return url.href;
}
