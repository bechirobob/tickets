type AppleWalletEnv = Cloudflare.Env & {
  APPLE_WALLET_AUTH_SECRET?: string;
  APPLE_WALLET_PASS_TYPE_IDENTIFIER?: string;
  APPLE_WALLET_PUSH_URL?: string;
};

export type AppleWalletTicketPayload = {
  id: string;
  eventSlug: string;
  ticketType: string;
  holder: string;
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  area: string;
  qrPayload: string;
  status?: string;
  eventState?: string;
};

export type AppleWalletPassRecord = {
  id: string;
  ticketId: string;
  attendeeId: string;
  eventSlug: string;
  passTypeIdentifier: string;
  serialNumber: string;
  updateTag: number;
};

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function appleWalletUpdatesConfigured(env: AppleWalletEnv) {
  return Boolean(
    env.APPLE_WALLET_SIGNER_URL
      && env.APPLE_WALLET_SIGNER_TOKEN
      && env.APPLE_WALLET_AUTH_SECRET
      && env.APPLE_WALLET_PASS_TYPE_IDENTIFIER
      && env.APPLE_WALLET_PUSH_URL,
  );
}

export async function appleWalletPassSerial(ticketId: string, attendeeId: string) {
  return `bct-${(await sha256Hex(`${ticketId}|${attendeeId}`)).slice(0, 40)}`;
}

export async function appleWalletAuthenticationToken(env: AppleWalletEnv, serialNumber: string) {
  if (!env.APPLE_WALLET_AUTH_SECRET) throw new Error("Apple Wallet update authentication is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.APPLE_WALLET_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`becore-tickets/apple-wallet/${serialNumber}`));
  return base64Url(new Uint8Array(signature));
}

export async function appleWalletRequestAuthorized(env: AppleWalletEnv, serialNumber: string, authorization: string | null) {
  if (!authorization?.startsWith("ApplePass ")) return false;
  const presented = authorization.slice("ApplePass ".length).trim();
  if (!presented) return false;
  return safeEqual(presented, await appleWalletAuthenticationToken(env, serialNumber));
}

export async function readAppleWalletPass(env: AppleWalletEnv, passTypeIdentifier: string, serialNumber: string) {
  return env.DB.prepare(`
    SELECT id,ticket_id AS ticketId,attendee_id AS attendeeId,event_slug AS eventSlug,
      pass_type_identifier AS passTypeIdentifier,serial_number AS serialNumber,update_tag AS updateTag
    FROM apple_wallet_passes WHERE pass_type_identifier=? AND serial_number=? LIMIT 1
  `).bind(passTypeIdentifier, serialNumber).first<AppleWalletPassRecord>();
}

export async function recordAppleWalletPass(
  env: AppleWalletEnv,
  ticket: Pick<AppleWalletTicketPayload, "id" | "eventSlug">,
  attendeeId: string,
  serialNumber: string,
) {
  if (!appleWalletUpdatesConfigured(env)) return false;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO apple_wallet_passes (
      id,ticket_id,attendee_id,event_slug,pass_type_identifier,serial_number,update_tag,last_pushed_tag,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,1,1,?,?)
    ON CONFLICT(id) DO UPDATE SET event_slug=excluded.event_slug
  `).bind(serialNumber, ticket.id, attendeeId, ticket.eventSlug, env.APPLE_WALLET_PASS_TYPE_IDENTIFIER!, serialNumber, now, now).run();
  return true;
}

export async function signAppleWalletPass(
  env: AppleWalletEnv,
  ticket: AppleWalletTicketPayload,
  origin: string,
  attendeeId: string,
  authenticationToken?: string,
  serialOverride?: string,
) {
  if (!env.APPLE_WALLET_SIGNER_URL || !env.APPLE_WALLET_SIGNER_TOKEN) return null;
  const dynamic = appleWalletUpdatesConfigured(env);
  const serialNumber = dynamic ? (serialOverride ?? await appleWalletPassSerial(ticket.id, attendeeId)) : ticket.id;
  const authToken = dynamic ? (authenticationToken ?? await appleWalletAuthenticationToken(env, serialNumber)) : null;
  const body = dynamic ? {
    ...ticket,
    serialNumber,
    passTypeIdentifier: env.APPLE_WALLET_PASS_TYPE_IDENTIFIER,
    webServiceURL: `${origin}/api/wallet/apple`,
    authenticationToken: authToken,
  } : ticket;
  const response = await fetch(env.APPLE_WALLET_SIGNER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${env.APPLE_WALLET_SIGNER_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  if (dynamic) await recordAppleWalletPass(env, ticket, attendeeId, serialNumber);
  return response;
}

export async function registerAppleWalletDevice(env: AppleWalletEnv, input: {
  passId: string;
  deviceLibraryId: string;
  pushToken: string;
}) {
  const pass = await env.DB.prepare("SELECT id FROM apple_wallet_passes WHERE id=? LIMIT 1").bind(input.passId).first();
  if (!pass) return "missing" as const;
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT 1 AS found FROM apple_wallet_registrations WHERE device_library_id=? AND pass_id=? LIMIT 1")
    .bind(input.deviceLibraryId, input.passId).first();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO apple_wallet_devices (device_library_id,push_token,created_at,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(device_library_id) DO UPDATE SET push_token=excluded.push_token,updated_at=excluded.updated_at
    `).bind(input.deviceLibraryId, input.pushToken, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO apple_wallet_registrations (device_library_id,pass_id,created_at) VALUES (?,?,?)")
      .bind(input.deviceLibraryId, input.passId, now),
  ]);
  return existing ? "existing" as const : "created" as const;
}

export async function unregisterAppleWalletDevice(env: AppleWalletEnv, input: { passId: string; deviceLibraryId: string }) {
  await env.DB.prepare("DELETE FROM apple_wallet_registrations WHERE device_library_id=? AND pass_id=?")
    .bind(input.deviceLibraryId, input.passId).run();
  await env.DB.prepare(`
    DELETE FROM apple_wallet_devices WHERE device_library_id=?
      AND NOT EXISTS (SELECT 1 FROM apple_wallet_registrations WHERE device_library_id=?)
  `).bind(input.deviceLibraryId, input.deviceLibraryId).run();
}

export async function listUpdatedAppleWalletPasses(env: AppleWalletEnv, input: {
  deviceLibraryId: string;
  passTypeIdentifier: string;
  updatedSince: number;
}) {
  // Apple has no page cursor here: truncating a shared update tag permanently
  // skips the remaining passes when the device advances lastUpdated.
  const result = await env.DB.prepare(`
    SELECT pass.serial_number AS serialNumber, pass.update_tag AS updateTag
    FROM apple_wallet_registrations registration
    JOIN apple_wallet_passes pass ON pass.id=registration.pass_id
    WHERE registration.device_library_id=? AND pass.pass_type_identifier=? AND pass.update_tag>?
    ORDER BY pass.update_tag,pass.serial_number
  `).bind(input.deviceLibraryId, input.passTypeIdentifier, input.updatedSince)
    .all<{ serialNumber: string; updateTag: number }>();
  if (!result.results.length) return null;
  return {
    serialNumbers: result.results.map((item) => item.serialNumber),
    lastUpdated: String(Math.max(...result.results.map((item) => Number(item.updateTag)))),
  };
}

async function removeInvalidPushTokens(env: AppleWalletEnv, tokens: string[]) {
  if (!tokens.length) return;
  for (let index = 0; index < tokens.length; index += 100) {
    const batch = tokens.slice(index, index + 100);
    const placeholders = batch.map(() => "?").join(",");
    const devices = await env.DB.prepare(`SELECT device_library_id AS id FROM apple_wallet_devices WHERE push_token IN (${placeholders})`)
      .bind(...batch).all<{ id: string }>();
    for (const device of devices.results) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM apple_wallet_registrations WHERE device_library_id=?").bind(device.id),
        env.DB.prepare("DELETE FROM apple_wallet_devices WHERE device_library_id=?").bind(device.id),
      ]);
    }
  }
}

export async function processAppleWalletUpdatePushes(env: AppleWalletEnv) {
  if (!appleWalletUpdatesConfigured(env)) return { pending: 0, pushed: 0 };
  // Leave one of D1's 100 bound parameters for the device pagination cursor.
  const pending = await env.DB.prepare(`
    SELECT id,update_tag AS updateTag
    FROM apple_wallet_passes
    WHERE update_tag>last_pushed_tag
    ORDER BY updated_at,id
    LIMIT 99
  `).all<{ id: string; updateTag: number }>();
  if (!pending.results.length) return { pending: 0, pushed: 0 };

  const ids = pending.results.map((item) => item.id);
  const placeholders = ids.map(() => "?").join(",");
  const invalidTokens = new Set<string>();
  let pushed = 0;
  let after = "";

  while (true) {
    const devices = await env.DB.prepare(`
      SELECT DISTINCT device.push_token AS pushToken
      FROM apple_wallet_registrations registration
      JOIN apple_wallet_devices device ON device.device_library_id=registration.device_library_id
      WHERE registration.pass_id IN (${placeholders}) AND device.push_token>?
      ORDER BY device.push_token
      LIMIT 500
    `).bind(...ids, after).all<{ pushToken: string }>();
    if (!devices.results.length) break;

    for (let index = 0; index < devices.results.length; index += 100) {
      const pushTokens = devices.results.slice(index, index + 100).map((item) => item.pushToken);
      const response = await fetch(env.APPLE_WALLET_PUSH_URL!, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${env.APPLE_WALLET_SIGNER_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ passTypeIdentifier: env.APPLE_WALLET_PASS_TYPE_IDENTIFIER, pushTokens }),
      });
      if (!response.ok) throw new Error(`Apple Wallet push service returned ${response.status}.`);
      const result = await response.json().catch(() => ({})) as { invalidPushTokens?: string[] };
      for (const token of Array.isArray(result.invalidPushTokens) ? result.invalidPushTokens : []) invalidTokens.add(token);
      pushed += pushTokens.length;
    }

    after = devices.results.at(-1)!.pushToken;
    if (devices.results.length < 500) break;
  }

  await removeInvalidPushTokens(env, [...invalidTokens]);
  await env.DB.batch(pending.results.map((item) => env.DB.prepare(`
    UPDATE apple_wallet_passes
    SET last_pushed_tag=?
    WHERE id=? AND last_pushed_tag<?
  `).bind(item.updateTag, item.id, item.updateTag)));
  return { pending: ids.length, pushed };
}
