// Window-local UI identity only; server sessions remain the authority.
const scannerAppBootstrap = String.raw`
(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!standalone) return;
  const key = 'bct:scanner-app:v1';
  const url = new URL(location.href);
  let scanner = (/^\/scan(?:\/|$)/.test(url.pathname) || url.pathname === '/admin/account') && url.searchParams.get('source') === 'scanner-pwa';
  try {
    if (scanner) sessionStorage.setItem(key, '1');
    scanner = scanner || sessionStorage.getItem(key) === '1';
  } catch { /* Explicit launches work without optional storage. */ }
  if (!scanner) return;
  document.documentElement.dataset.scannerApp = 'true';
  const allowed = path => path === '/scan/app' || path === '/scan/install' || path === '/admin/account' || path === '/offline-scanner.html';
  const restore = () => {
    if (allowed(location.pathname)) return;
    document.documentElement.style.visibility = 'hidden';
    location.replace(location.pathname.startsWith('/offline-') ? '/offline-scanner.html' : '/scan/app?source=scanner-pwa');
  };
  restore();
  window.addEventListener('pageshow', restore);
  window.addEventListener('popstate', restore);
  window.addEventListener('staff-app-route', restore);
})();
`;
export default scannerAppBootstrap;
