import { constants, privateDecrypt, createDecipheriv } from 'node:crypto';
export function openEnvelope(envelope, privateKey, purpose, now = Date.now()) {
  if (!envelope || typeof envelope.header !== 'string' || envelope.header.length > 2048) throw new Error('Invalid envelope.');
  const header = JSON.parse(envelope.header);
  if (header.version !== 1 || header.source !== 'becore-tickets' || header.purpose !== purpose ||
      !Number.isFinite(Date.parse(header.expiresAt)) || Date.parse(header.expiresAt) <= now ||
      !Number.isFinite(Date.parse(header.createdAt)) || Date.parse(header.createdAt) > now + 60000 ||
      Date.parse(header.createdAt) < now - 3600000) throw new Error('Envelope identity or expiry rejected.');
  for (const name of ['nonce', 'wrappedKey', 'ciphertext']) {
    if (typeof envelope[name] !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope[name]) || envelope[name].length > 24 * 1024 * 1024) throw new Error('Invalid envelope encoding.');
  }
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.wrappedKey, 'base64'));
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  if (key.length !== 32 || nonce.length !== 12 || ciphertext.length < 16) throw new Error('Invalid envelope size.');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(envelope.header));
  decipher.setAuthTag(ciphertext.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'));
}
