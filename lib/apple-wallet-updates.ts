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

export function appleWalletUpdatesConfigured(env: AppleWalletEnv) {
  return Boolean(
    env.APPLE_WALLET_SIGNER_URL
      && env.APPLE_WALLET_SIGNER_TOKEN
      && env.APPLE_WALLET_AUTH_SECRET
      && env.APPLE_WALLET_PASS_TYPE_IDENTIFIER
      && env.APPLE_WALLET_PUSH_URL,
  );
}

export async function appleWalletAuthenticationToken(env: AppleWalletEnv, ticketId: string) {
  if (!env.APPLE_WALLET_AUTH_SECRET) throw new Error("Apple Wallet update authentication is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.APPLE_WALLET_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`becore-tickets/apple-wallet/${ticketId}`));
  return base64Url(new Uint8Array(signature));
}

export async function appleWalletRequestAuthorized(env: AppleWalletEnv, ticketId: string, authorization: string | null) {
  if (!authorization?.startsWith("ApplePass ")) return false;
  const presented = authorization.slice("ApplePass ".length).trim();
  if (!presented) return false;
  return safeEqual(presented, await appleWalletAuthenticationToken(env, ticketId));
}

export async function recordAppleWalletPass(env: AppleWalletEnv, ticket: Pick<AppleWalletTicketPayload, "id" | "eventSlug">) {
  if (!appleWalletUpdatesConfigured(env)) return false;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO apple_wallet_passes (
      ticket_id,event_slug,pass_type_identifier,serial_number,update_tag,created_at,updated_at
    ) VALUES (?,?,?,?,1,?,?)
    ON CONFLICT(ticket_id) DO UPDATE SET
      event_slug=excluded.event_slug,
      pass_type_identifier=excluded.pass_type_identifier,
      serial_number=excluded.serial_number
  `).bind(ticket.id, ticket.eventSlug, env.APPLE_WALLET_PASS_TYPE_IDENTIFIER!, ticket.id, now, now).run();
  return true;
}

export async function signAppleWalletPass(
  env: AppleWalletEnv,
  ticket: AppleWalletTicketPayload,
  origin: string,
  authenticationToken?: string,
) {
  if (!env.APPLE_WALLET_SIGNER_URL || !env.APPLE_WALLET_SIGNER_TOKEN) return null;
  const dynamic = appleWalletUpdatesConfigured(env);
  const authToken = dynamic ? (authenticationToken ?? await appleWalletAuthenticationToken(env, ticket.id)) : null;
  const body = dynamic ? {
    ...ticket,
    serialNumber: ticket.id,
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
  if (dynamic) await recordAppleWalletPass(env, ticket);
  return response;
}

export async function registerAppleWalletDevice(env: AppleWalletEnv, input: {
  ticketId: string;
  deviceLibraryId: string;
  pushToken: string;
}) {
  const pass = await env.DB.prepare("SELECT ticket_id FROM apple_wallet_passes WHERE ticket_id=? LIMIT 1")
    .bind(input.ticketId).first();
  if (!pass) return "missing" as const;
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT 1 AS found FROM apple_wallet_registrations WHERE device_library_id=? AND ticket_id=? LIMIT 1")
    .bind(input.deviceLibraryId, input.ticketId).first();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO apple_wallet_devices (device_library_id,push_token,created_at,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(device_library_id) DO UPDATE SET push_token=excluded.push_token,updated_at=excluded.updated_at
    `).bind(input.deviceLibraryId, input.pushToken, now, now),
    env.DB.prepare("INSERT OR IGNORE INTO apple_wallet_registrations (device_library_id,ticket_id,created_at) VALUES (?,?,?)")
      .bind(input.deviceLibraryId, input.ticketId, now),
  ]);
  return existing ? "existing" as const : "created" as const;
}

export async function unregisterAppleWalletDevice(env: AppleWalletEnv, input: { ticketId: string; deviceLibraryId: string }) {
  await env.DB.prepare("DELETE FROM apple_wallet_registrations WHERE device_library_id=? AND ticket_id=?")
    .bind(input.deviceLibraryId, input.ticketId).run();
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
  const result = await env.DB.prepare(`
    SELECT pass.serial_number AS serialNumber, pass.update_tag AS updateTag
    FROM apple_wallet_registrations registration
    JOIN apple_wallet_passes pass ON pass.ticket_id=registration.ticket_id
    WHERE registration.device_library_id=? AND pass.pass_type_identifier=? AND pass.update_tag>?
    ORDER BY pass.update_tag,pass.serial_number
    LIMIT 200
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
  const placeholders = tokens.map(() => "?").join(",");
  const devices = await env.DB.prepare(`SELECT device_library_id AS id FROM apple_wallet_devices WHERE push_token IN (${placeholders})`)
    .bind(...tokens).all<{ id: string }>();
  for (const device of devices.results) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM apple_wallet_registrations WHERE device_library_id=?").bind(device.id),
      env.DB.prepare("DELETE FROM apple_wallet_devices WHERE device_library_id=?").bind(device.id),
    ]);
  }
}

export async function markAppleWalletEventUpdated(env: AppleWalletEnv, eventSlug: string) {
  if (!appleWalletUpdatesConfigured(env)) return { updated: 0, pushed: 0 };
  const now = new Date().toISOString();
  const updated = await env.DB.prepare("UPDATE apple_wallet_passes SET update_tag=update_tag+1,updated_at=? WHERE event_slug=?")
    .bind(now, eventSlug).run();
  if (!updated.meta.changes) return { updated: 0, pushed: 0 };
  const devices = await env.DB.prepare(`
    SELECT DISTINCT device.push_token AS pushToken
    FROM apple_wallet_passes pass
    JOIN apple_wallet_registrations registration ON registration.ticket_id=pass.ticket_id
    JOIN apple_wallet_devices device ON device.device_library_id=registration.device_library_id
    WHERE pass.event_slug=?
    LIMIT 1000
  `).bind(eventSlug).all<{ pushToken: string }>();
  let pushed = 0;
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
    await removeInvalidPushTokens(env, Array.isArray(result.invalidPushTokens) ? result.invalidPushTokens : []);
    pushed += pushTokens.length;
  }
  return { updated: Number(updated.meta.changes), pushed };
}
