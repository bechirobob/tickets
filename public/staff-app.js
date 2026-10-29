/* Window-local install intent only. Never infer an app identity from cookies. */
(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!standalone) return;
  const key = 'bct:staff-app:v1';
  const staffPath = path => /^\/(?:staff|admin|scan)(?:\/|$)/.test(path) || /^\/organizer\/(?:workspace|analytics|assistant|activate|team)(?:\/|$)/.test(path) || path === '/offline-staff.html';
  const url = new URL(location.href);
  let staff = staffPath(url.pathname) && url.searchParams.get('source') === 'staff-pwa';
  try {
    if (staff) sessionStorage.setItem(key, '1');
    staff = staff || sessionStorage.getItem(key) === '1';
  } catch { /* The explicit launch still works when optional storage is blocked. */ }
  if (!staff) return;
  document.documentElement.dataset.staffApp = 'true';
  const restore = () => {
    if (staffPath(location.pathname)) return;
    // Runs in the head before a restored public document can paint.
    document.documentElement.style.visibility = 'hidden';
    location.replace(location.pathname.startsWith('/offline-ticket') ? '/offline-staff.html' : '/staff?source=staff-pwa');
  };
  restore();
  window.addEventListener('pageshow', restore);
  window.addEventListener('popstate', restore);
  window.addEventListener('staff-app-route', restore);
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download')) return;
    const target = new URL(link.href, location.href);
    if (!['https:', 'http:'].includes(target.protocol) || (target.origin === location.origin && staffPath(target.pathname))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.open(target.href, '_blank', 'noopener,noreferrer');
  }, true);
})();
