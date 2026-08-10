import { headers } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "bct_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

type RuntimeSecrets = {
  ADMIN_ACCESS_KEY?: string;
  ADMIN_SESSION_SECRET?: string;
};

export type AdminSession = {
  actor: string;
  expiresAt: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function runtimeSecrets(): Promise<RuntimeSecrets> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as RuntimeSecrets;
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  if (!left || !right) return false;
  const leftDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
  );
  const rightDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  );
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

function cookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return null;
}

export async function createAdminSession(accessKey: string): Promise<string | null> {
  const secrets = await runtimeSecrets();
  if (!secrets.ADMIN_ACCESS_KEY || !secrets.ADMIN_SESSION_SECRET) return null;
  if (!(await constantTimeEqual(accessKey, secrets.ADMIN_ACCESS_KEY))) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}.BeCore%20Admin`;
  return `${payload}.${await hmac(payload, secrets.ADMIN_SESSION_SECRET)}`;
}

export async function readAdminSession(
  cookieHeader: string | null,
): Promise<AdminSession | null> {
  const value = cookieValue(cookieHeader);
  if (!value) return null;
  const [expiresAtText, actorText, signature] = value.split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const secrets = await runtimeSecrets();
  if (!secrets.ADMIN_SESSION_SECRET || !signature) return null;
  const payload = `${expiresAtText}.${actorText}`;
  const expected = await hmac(payload, secrets.ADMIN_SESSION_SECRET);
  if (!(await constantTimeEqual(signature, expected))) return null;

  return { actor: decodeURIComponent(actorText), expiresAt };
}

export async function requireAdminSession(returnTo: string): Promise<AdminSession> {
  const requestHeaders = await headers();
  const session = await readAdminSession(requestHeaders.get("cookie"));
  if (session) return session;
  redirect(`/admin/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/admin";
  return value.startsWith("/admin") ? value : "/admin";
}

export function adminCookieHeader(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function expiredAdminCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
