/** Native catalogue parsing resolves artwork URLs; keep the same web treatment. */
export function eventArtworkPath(source: string) {
  try {
    const url = new URL(source, 'https://tickets.becoreops.com');
    return url.origin === 'https://tickets.becoreops.com' && url.pathname.startsWith('/events/') ? url.pathname : null;
  } catch { return null; }
}

/** Existing approved artist treatment, shared by the detail and RSVP views.
 * The artwork guard keeps it off replacement artwork and unrelated events.
 */
export function eventSpecialGuest(event: { slug: string; image: string }) {
  return event.slug === 'sun-chasers-labadi' && eventArtworkPath(event.image) === '/events/on-the-guest-list.webp'
    ? { name: 'Cuppy', role: 'Special Guest DJ' }
    : null;
}
