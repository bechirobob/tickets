import { describe, expect, it } from "vitest";
import { createGateToken, formatGateCode, gateQrPayload, normalizeGateToken } from "../lib/gate-pass";

describe("gate pass tokens", () => {
  it("creates QR-safe opaque codes that normalize from QR and manual formats", () => {
    const token = createGateToken();
    expect(token).toMatch(/^[2-9A-HJ-NP-Z]{16}$/u);
    expect(normalizeGateToken(gateQrPayload(token))).toBe(token);
    expect(normalizeGateToken(formatGateCode(token).toLowerCase())).toBe(token);
  });

  it("rejects malformed and ambiguous codes", () => {
    expect(normalizeGateToken("BCT-0000-1111-OOOO-IIII")).toBeNull();
    expect(normalizeGateToken("someone@example.com")).toBeNull();
  });
});
