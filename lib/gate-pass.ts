import { hashToken } from "./attendee-auth";

const GATE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const GATE_TOKEN_LENGTH = 16;

export function createGateToken(): string {
  const bytes = new Uint8Array(GATE_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => GATE_ALPHABET[byte & 31]).join("");
}

export function formatGateCode(token: string): string {
  return `BCT-${token.match(/.{1,4}/gu)?.join("-") ?? token}`;
}

export function gateQrPayload(token: string): string {
  return `BCT:${token}`;
}

export function normalizeGateToken(value: string): string | null {
  const upper = value.trim().toUpperCase();
  const payload = upper.startsWith("BCT:") ? upper.slice(4) : upper;
  const token = payload.replace(/^BCT-/u, "").replaceAll("-", "").replaceAll(" ", "");
  return token.length === GATE_TOKEN_LENGTH && [...token].every((character) => GATE_ALPHABET.includes(character))
    ? token
    : null;
}

export function hashGateToken(token: string): Promise<string> {
  return hashToken(token);
}
