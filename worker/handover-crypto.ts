// Operator-only handover: the destination private key never leaves Hermes.
export type HandoverSettings = {
  HANDOVER_RECIPIENT_SPKI?: string;
  HANDOVER_EXPIRES_AT?: string;
};
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
function encoded(value: ArrayBuffer | Uint8Array): string {
  return btoa(Array.from(new Uint8Array(value instanceof Uint8Array ? value.buffer : value), byte => String.fromCharCode(byte)).join(''));
}
export function requireHandover(settings: HandoverSettings): void {
  const expiry = Date.parse(settings.HANDOVER_EXPIRES_AT ?? '');
  if (!settings.HANDOVER_RECIPIENT_SPKI || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 3_600_000) {
    throw new Error('Handover is disabled.');
  }
}
export async function sealHandover(settings: HandoverSettings, purpose: string, value: unknown) {
  requireHandover(settings);
  const publicBytes = bytes(settings.HANDOVER_RECIPIENT_SPKI!);
  const publicKey = await crypto.subtle.importKey('spki', publicBytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  if ((publicKey.algorithm as RsaKeyAlgorithm).modulusLength < 3072) throw new Error('Invalid recipient.');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const header = JSON.stringify({ version: 1, purpose, source: 'becore-tickets', expiresAt: settings.HANDOVER_EXPIRES_AT, createdAt: new Date().toISOString() });
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (plaintext.byteLength > 16 * 1024 * 1024) throw new Error('Handover requires pagination.');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(header) }, key, plaintext);
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, await crypto.subtle.exportKey('raw', key));
  return { header, nonce: encoded(nonce), wrappedKey: encoded(wrappedKey), ciphertext: encoded(ciphertext) };
}
