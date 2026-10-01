import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("staff login server HTML keeps input and submission disabled until React is ready", async () => {
  const source = await readFile(new URL("../app/admin/login/login-form.tsx", import.meta.url), "utf8");
  const compiled = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" });
  const componentModule = { exports: {} };
  const requireDependency = createRequire(import.meta.url);
  const unexpectedAuthentication = () => { throw new Error("SSR must not attempt authentication"); };
  const require = specifier => {
    if (specifier === "next/navigation") return { useSearchParams: () => new URLSearchParams() };
    if (specifier === "@simplewebauthn/browser") return { startAuthentication: unexpectedAuthentication };
    if (specifier === "../../../lib/staff-password-client") return { deriveStaffPasswordProof: unexpectedAuthentication };
    return requireDependency(specifier);
  };
  runInNewContext(compiled.code, { module: componentModule, exports: componentModule.exports, require });
  const html = renderToStaticMarkup(createElement(componentModule.exports.default));
  for (const id of ["staff-email", "staff-password"]) {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(input, `${id} remains in the server form`);
    assert.match(input, /disabled=""/u);
    assert.match(input, /required=""/u);
    assert.match(input, /value=""/u);
  }
  assert.match(html, /<button disabled="" type="submit">Sign in<\/button>/u);
});

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
