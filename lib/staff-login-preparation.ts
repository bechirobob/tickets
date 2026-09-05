import { bytesToBase64Url, PASSWORD_SALT_BYTES } from "./staff-password-policy";

/** A stable, privately keyed decoy is indistinguishable from an account's random salt. */
export async function staffLoginDecoySalt(email: string, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("Staff login privacy key is unavailable.");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`staff-login-decoy:v1:${email.trim().toLowerCase()}`));
  return bytesToBase64Url(new Uint8Array(digest).slice(0, PASSWORD_SALT_BYTES));
}
