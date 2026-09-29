import { describe, expect, it } from 'vitest';
import { requireHandover, sealHandover } from '../worker/handover-crypto';

describe('encrypted operator handover', () => {
  it('is disabled by default, after expiry and for an unbounded activation window', () => {
    expect(() => requireHandover({})).toThrow('disabled');
    expect(() => requireHandover({ HANDOVER_RECIPIENT_SPKI: 'x', HANDOVER_EXPIRES_AT: new Date(Date.now() - 1).toISOString() })).toThrow('disabled');
    expect(() => requireHandover({ HANDOVER_RECIPIENT_SPKI: 'x', HANDOVER_EXPIRES_AT: new Date(Date.now() + 7200000).toISOString() })).toThrow('disabled');
  });
  it('encrypts only to the configured destination and authenticates envelope metadata', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))));
    const settings = { HANDOVER_RECIPIENT_SPKI: publicKey, HANDOVER_EXPIRES_AT: new Date(Date.now() + 600000).toISOString() };
    const original = { secret: 'synthetic-test-secret', unicode: 'é 🔥', nested: [1, null] };
    const envelope = await sealHandover(settings, 'configuration', original);
    expect(JSON.stringify(envelope)).not.toContain(original.secret);
    const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
    const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pair.privateKey, decode(envelope.wrappedKey));
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.nonce), additionalData: new TextEncoder().encode(envelope.header) }, key, decode(envelope.ciphertext));
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(original);
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.nonce), additionalData: new TextEncoder().encode(envelope.header + ' ') }, key, decode(envelope.ciphertext))).rejects.toThrow();
  });
});
