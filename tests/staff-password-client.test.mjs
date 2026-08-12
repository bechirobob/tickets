import assert from "node:assert/strict";
import test from "node:test";

function base64UrlToBytes(value) {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

test("the browser-compatible Web Crypto path derives the 600,000-round production vector", async () => {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode("CorrectHorse9Battery"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: base64UrlToBytes("AAECAwQFBgcICQoLDA0ODw"),
    iterations: 600_000,
  }, material, 256);
  assert.equal(Buffer.from(bits).toString("base64url"), "XTlKa_gLf3KD0M8mv-ZrlYn-p7YiT-JYfq52B4UNCVI");
});
