import { describe, expect, it } from 'vitest';
import { validPushEndpoint, validPushKeys } from '../lib/push-subscription';

describe('push destination validation', () => {
  it.each(['https://fcm.googleapis.com/fcm/send/token', 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://web.push.apple.com/token', 'https://wns2.notify.windows.com/w/?token=abc'])('accepts browser push service %s', endpoint => {
    expect(validPushEndpoint(endpoint)).toBe(true);
  });
  it.each(['https://127.0.0.1/internal', 'https://[::1]/admin', 'https://example.com/push', 'http://fcm.googleapis.com/send', 'https://fcm.googleapis.com.evil.example/send', 'https://evilpush.apple.com/send', 'https://user:password@web.push.apple.com/send', 'https://web.push.apple.com:8443/send', 'https://web.push.apple.com/send#fragment'])('rejects arbitrary destinations and URL tricks: %s', endpoint => {
    expect(validPushEndpoint(endpoint)).toBe(false);
  });
  it('requires correctly sized browser encryption keys', () => {
    const key = btoa(String.fromCharCode(4) + 'a'.repeat(64)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
    const auth = btoa('a'.repeat(16)).replace(/=+$/u,'');
    expect(validPushKeys(key, auth)).toBe(true);
    expect(validPushKeys('a'.repeat(65), auth)).toBe(false);
    expect(validPushKeys(key, 'invalid')).toBe(false);
  });
});
