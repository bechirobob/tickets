import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteDatabase } from '../runtime/vps/database.mjs';
import { NodeRooms } from '../runtime/vps/rooms.mjs';
import { environmentKey } from '../runtime/vps/cloudflare-workers.mjs';
import { RateLimiter } from '../runtime/vps/rate-limit.mjs';
import { DatabaseSync } from 'node:sqlite';
import { addTestTransport } from './vps-sockets.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'tickets-vps-test-'));
export const env = {
  ...JSON.parse(readFileSync('wrangler.test.jsonc', 'utf8')).vars,
  DB: new SqliteDatabase(':memory:'), ENVIRONMENT: 'test',
  PAYSTACK_SECRET_KEY: 'sk_test_payment-operations', RESEND_API_KEY: 're_test_delivery',
  ADMIN_ACCESS_KEY: 'bootstrap-test-key', STAFF_LOGIN_DECOY_SECRET: 'test-only-login-decoy-key-at-least-32-characters',
};
env.THE_ROOM = new NodeRooms(directory, env);
addTestTransport(env.THE_ROOM);
const cache = new Map();
globalThis.caches = { default: {
  async put(key, response) { cache.set(key.url, response.clone()); },
  async match(key) { return cache.get(key.url)?.clone(); },
  async delete(key) { return cache.delete(key.url); },
} };
const operations = new DatabaseSync(':memory:');
for (const config of JSON.parse(readFileSync('wrangler.test.jsonc', 'utf8')).ratelimits) env[config.name] = new RateLimiter(operations, config.name, config.simple.limit, config.simple.period);
globalThis[environmentKey] = env;
export async function applyD1Migrations(db) {
  for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join('drizzle', file), 'utf8'));
}
export async function closeBindings() { await env.THE_ROOM.close(); env.DB.close(); operations.close(); rmSync(directory, { recursive: true, force: true }); }
