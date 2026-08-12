export const PASSWORD_ITERATIONS = 600_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_PROOF_BYTES = 32;

export type StaffPasswordPayload = {
  password: string;
  passwordProof: string;
  passwordSalt: string;
  passwordIterations: number;
};

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("The password record is invalid.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function validateStaffPassword(value: string): void {
  if (value.length < 12 || value.length > 256) throw new Error("Use a password between 12 and 256 characters.");
  if (!/[a-z]/u.test(value) || !/[A-Z]/u.test(value) || !/[0-9]/u.test(value)) {
    throw new Error("Use upper-case, lower-case and number characters in the password.");
  }
}
