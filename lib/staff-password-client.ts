"use client";

import {
  base64UrlToBytes,
  bytesToBase64Url,
  PASSWORD_ITERATIONS,
  PASSWORD_PROOF_BYTES,
  PASSWORD_SALT_BYTES,
  validateStaffPassword,
  type StaffPasswordPayload,
} from "./staff-password-policy";

// Cloudflare's Worker runtime caps PBKDF2 at 100,000 rounds. Keep the required
// 600,000-round derivation in the browser and send only its fixed-size proof.
export async function deriveStaffPasswordProof(password: string, passwordSalt: string, passwordIterations = PASSWORD_ITERATIONS): Promise<string> {
  validateStaffPassword(password);
  if (passwordIterations !== PASSWORD_ITERATIONS) throw new Error("This password record needs an administrator reset.");
  const salt = base64UrlToBytes(passwordSalt);
  if (salt.length !== PASSWORD_SALT_BYTES) throw new Error("The password record is invalid.");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: passwordIterations }, material, PASSWORD_PROOF_BYTES * 8);
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function prepareStaffPassword(password: string): Promise<StaffPasswordPayload> {
  const passwordSalt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES)));
  return {
    password,
    passwordSalt,
    passwordIterations: PASSWORD_ITERATIONS,
    passwordProof: await deriveStaffPasswordProof(password, passwordSalt),
  };
}
