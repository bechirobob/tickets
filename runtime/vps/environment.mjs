import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { SqliteDatabase } from './database.mjs';
import { NodeRooms } from './rooms.mjs';
import { RateLimiter } from './rate-limit.mjs';
import { DeliveryQueue } from './queue.mjs';
import { images } from './images.mjs';
import { environmentKey } from './cloudflare-workers.mjs';

export function createEnvironment({ directory, values, revision }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const database = new SqliteDatabase(path.join(directory, 'tickets.sqlite'));
  const operations = new DatabaseSync(path.join(directory, 'operations.sqlite'));
  operations.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  const environment = { ...values, RELEASE_SHA: revision, DB: database, IMAGES: images };
  const limits = { LOGIN_RATE_LIMITER: 10, PUBLIC_WRITE_RATE_LIMITER: 12, PAYMENT_RATE_LIMITER: 10, PAYMENT_NETWORK_RATE_LIMITER: 600, ANALYTICS_RATE_LIMITER: 60, AI_RATE_LIMITER: 6 };
  for (const [name, maximum] of Object.entries(limits)) environment[name] = new RateLimiter(operations, name, maximum);
  environment.THE_ROOM = new NodeRooms(path.join(directory, 'rooms'), environment);
  environment.EMAIL_DELIVERY_QUEUE = new DeliveryQueue(operations);
  // Retain the existing safety gate. An unavailable moderation provider must
  // never silently approve uploads. Credentials are read only on the server.
  environment.AI = { async run(model, input) {
    if (!values.CLOUDFLARE_AI_TOKEN || !values.CLOUDFLARE_ACCOUNT_ID) throw new Error('Photo safety provider is unavailable.');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${values.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST', headers: { authorization: `Bearer ${values.CLOUDFLARE_AI_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error('Photo safety provider is unavailable.');
    return result.result;
  } };
  globalThis[environmentKey] = environment;
  return { environment, operations, async close() { await environment.THE_ROOM.close(); database.close(); operations.close(); delete globalThis[environmentKey]; } };
}

export function loadPrivateConfiguration(file) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error('Runtime configuration must be a private regular file (0600).');
  const values = JSON.parse(readFileSync(file, 'utf8'));
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string')) throw new Error('Invalid private runtime configuration.');
  return values;
}
