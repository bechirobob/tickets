/** Browser push services only; subscriptions are an outbound-request boundary. */
export function validPushEndpoint(value: string): boolean {
  try {
    if (value.length > 2000) return false;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    return url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com'
      || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
  } catch { return false; }
}

export function validPushKeys(p256dh: string, auth: string): boolean {
  try {
    if (!/^[A-Za-z0-9_-]{86,87}={0,2}$/u.test(p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/u.test(auth)) return false;
    const decode = (value: string) => atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const key = decode(p256dh);
    return key.length === 65 && key.charCodeAt(0) === 4 && decode(auth).length === 16;
  } catch { return false; }
}
