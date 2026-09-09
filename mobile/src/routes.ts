import { WEB_ORIGIN } from './catalogue.ts';

export type Screen = { tab: 'drop' | 'nights' | 'buzz'; slug?: string };
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
    if (path === '/' || path === '/events') return { tab: 'drop' };
    if (path === '/my-nights') return { tab: 'nights' };
    if (path === '/notifications') return { tab: 'buzz' };
    return null;
  } catch { return null; }
}

export function customerUrl(path: string): string {
  const url = new URL(path, WEB_ORIGIN);
  if (url.origin !== WEB_ORIGIN || url.username || url.password
    || !/^\/(?:event\/[a-z0-9-]{1,80}|my-nights|notifications|help|account\/privacy)$/.test(url.pathname)
    || url.search || url.hash) throw new Error('Unsupported destination');
  return url.href;
}
