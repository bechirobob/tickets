import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { hashToken, type AdminSession } from "./admin-session";

type PasskeyRow = {
  id: string;
  credentialId: string;
  publicKey: ArrayBuffer | Uint8Array;
  counter: number;
  transportsJson: string | null;
};

function secureExchangeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function transports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  try {
    const result = JSON.parse(value);
    return Array.isArray(result) ? result.filter((item): item is AuthenticatorTransportFuture => typeof item === "string") : undefined;
  } catch {
    return undefined;
  }
}

function relyingParty(origin: string) {
  const url = new URL(origin);
  return { rpID: url.hostname, expectedOrigin: url.origin };
}

async function saveChallenge(db: D1Database, input: { accountId: string; purpose: "registration" | "authentication"; challenge: string; returnTo?: string | null }) {
  const exchangeToken = secureExchangeToken();
  const now = new Date();
  await db.prepare(`
    INSERT INTO staff_auth_challenges (id, account_id, purpose, challenge, exchange_token_hash, return_to, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), input.accountId, input.purpose, input.challenge, await hashToken(exchangeToken), input.returnTo ?? null,
    new Date(now.getTime() + 5 * 60 * 1000).toISOString(), now.toISOString(),
  ).run();
  return exchangeToken;
}

export async function beginPasskeyRegistration(db: D1Database, session: AdminSession, origin: string) {
  const existing = await db.prepare("SELECT credential_id AS credentialId, transports_json AS transportsJson FROM staff_passkeys WHERE account_id = ?")
    .bind(session.accountId).all<{ credentialId: string; transportsJson: string | null }>();
  const { rpID } = relyingParty(origin);
  const options = await generateRegistrationOptions({
    rpName: "BeCore Tickets Operations",
    rpID,
    userID: new TextEncoder().encode(session.accountId),
    userName: session.email,
    userDisplayName: session.actor,
    attestationType: "none",
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: existing.results.map((item) => ({ id: item.credentialId, transports: transports(item.transportsJson) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  const exchangeToken = await saveChallenge(db, { accountId: session.accountId, purpose: "registration", challenge: options.challenge });
  return { options, exchangeToken };
}

export async function finishPasskeyRegistration(db: D1Database, session: AdminSession, origin: string, input: { exchangeToken: string; response: RegistrationResponseJSON; label?: string }) {
  const challenge = await db.prepare(`
    SELECT id, challenge FROM staff_auth_challenges
    WHERE account_id = ? AND purpose = 'registration' AND exchange_token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1
  `).bind(session.accountId, await hashToken(input.exchangeToken), new Date().toISOString()).first<{ id: string; challenge: string }>();
  if (!challenge) throw new Error("That passkey setup expired. Start again.");
  const { rpID, expectedOrigin } = relyingParty(origin);
  const verification = await verifyRegistrationResponse({ response: input.response, expectedChallenge: challenge.challenge, expectedOrigin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
  if (!verification.verified) throw new Error("The device did not verify this passkey.");
  const info = verification.registrationInfo;
  const now = new Date().toISOString();
  const recoveryCodes = Array.from({ length: 8 }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase().replace(/^(.{5})(.{5})$/u, "$1-$2");
  });
  await db.batch([
    db.prepare(`
      INSERT INTO staff_passkeys (id, account_id, credential_id, public_key, counter, device_type, backed_up, transports_json, label, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), session.accountId, info.credential.id, info.credential.publicKey, info.credential.counter,
      info.credentialDeviceType, info.credentialBackedUp ? 1 : 0, JSON.stringify(input.response.response.transports ?? []),
      (input.label?.trim() || "Passkey").slice(0, 80), now,
    ),
    db.prepare("UPDATE staff_auth_challenges SET used_at = ? WHERE id = ?").bind(now, challenge.id),
    db.prepare("UPDATE staff_accounts SET mfa_required = 1, updated_at = ? WHERE id = ?").bind(now, session.accountId),
    db.prepare("DELETE FROM staff_recovery_codes WHERE account_id = ?").bind(session.accountId),
    ...await Promise.all(recoveryCodes.map(async (code) => db.prepare("INSERT INTO staff_recovery_codes (id, account_id, code_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), session.accountId, await hashToken(code), now))),
  ]);
  return { registered: true, recoveryCodes };
}

export async function beginPasskeyAuthentication(db: D1Database, accountId: string, origin: string, returnTo: string) {
  const passkeys = await db.prepare("SELECT credential_id AS credentialId, transports_json AS transportsJson FROM staff_passkeys WHERE account_id = ?")
    .bind(accountId).all<{ credentialId: string; transportsJson: string | null }>();
  if (!passkeys.results.length) throw new Error("This account has no passkey enrolled. An owner must reset its MFA requirement.");
  const { rpID } = relyingParty(origin);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: passkeys.results.map((item) => ({ id: item.credentialId, transports: transports(item.transportsJson) })),
  });
  const exchangeToken = await saveChallenge(db, { accountId, purpose: "authentication", challenge: options.challenge, returnTo });
  return { options, exchangeToken };
}

export async function readAuthenticationChallengeAccount(db: D1Database, exchangeToken: string): Promise<string | null> {
  if (!exchangeToken) return null;
  const challenge = await db.prepare(`
    SELECT account_id AS accountId
    FROM staff_auth_challenges
    WHERE purpose = 'authentication' AND exchange_token_hash = ?
      AND used_at IS NULL AND expires_at > ? LIMIT 1
  `).bind(await hashToken(exchangeToken), new Date().toISOString()).first<{ accountId: string }>();
  return challenge?.accountId ?? null;
}

export async function finishPasskeyAuthentication(db: D1Database, origin: string, input: { exchangeToken: string; response: AuthenticationResponseJSON }) {
  const challenge = await db.prepare(`
    SELECT id, account_id AS accountId, challenge, return_to AS returnTo
    FROM staff_auth_challenges WHERE purpose = 'authentication' AND exchange_token_hash = ?
      AND used_at IS NULL AND expires_at > ? LIMIT 1
  `).bind(await hashToken(input.exchangeToken), new Date().toISOString()).first<{ id: string; accountId: string; challenge: string; returnTo: string | null }>();
  if (!challenge) throw new Error("That secure sign-in expired. Start again.");
  const passkey = await db.prepare(`
    SELECT id, credential_id AS credentialId, public_key AS publicKey, counter, transports_json AS transportsJson
    FROM staff_passkeys WHERE account_id = ? AND credential_id = ? LIMIT 1
  `).bind(challenge.accountId, input.response.id).first<PasskeyRow>();
  if (!passkey) throw new Error("That passkey does not belong to this account.");
  const { rpID, expectedOrigin } = relyingParty(origin);
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: transports(passkey.transportsJson) },
  });
  if (!verification.verified) throw new Error("The passkey could not verify this sign-in.");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE staff_passkeys SET counter = ?, last_used_at = ? WHERE id = ?").bind(verification.authenticationInfo.newCounter, now, passkey.id),
    db.prepare("UPDATE staff_auth_challenges SET used_at = ? WHERE id = ?").bind(now, challenge.id),
  ]);
  return { accountId: challenge.accountId, returnTo: challenge.returnTo ?? "/admin" };
}

export async function consumeRecoveryCode(db: D1Database, exchangeToken: string, code: string) {
  const challenge = await db.prepare(`
    SELECT id, account_id AS accountId, return_to AS returnTo
    FROM staff_auth_challenges WHERE purpose = 'authentication' AND exchange_token_hash = ?
      AND used_at IS NULL AND expires_at > ? LIMIT 1
  `).bind(await hashToken(exchangeToken), new Date().toISOString()).first<{ id: string; accountId: string; returnTo: string | null }>();
  if (!challenge) throw new Error("That secure sign-in expired. Start again.");
  const recovery = await db.prepare("SELECT id FROM staff_recovery_codes WHERE account_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1")
    .bind(challenge.accountId, await hashToken(code.trim().toUpperCase())).first<{ id: string }>();
  if (!recovery) throw new Error("That recovery code is invalid or already used.");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE staff_recovery_codes SET used_at = ? WHERE id = ?").bind(now, recovery.id),
    db.prepare("UPDATE staff_auth_challenges SET used_at = ? WHERE id = ?").bind(now, challenge.id),
  ]);
  return { accountId: challenge.accountId, returnTo: challenge.returnTo ?? "/admin" };
}
