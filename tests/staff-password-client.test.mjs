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

// Exercise the server entry with the production role/return-path helpers.
async function loginEntry(session, returnTo) {
  const requireDependency = createRequire(import.meta.url);
  const compile = async (path, dependencies = {}) => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const compiled = transformSync(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs', supported: { 'dynamic-import': false } });
    const component = { exports: {} };
    runInNewContext(compiled.code, { module: component, exports: component.exports, require: name => name in dependencies ? dependencies[name] : requireDependency(name) });
    return component.exports;
  };
  const roles = await compile('../lib/staff-roles.ts');
  const auth = await compile('../lib/admin-session.ts', { './staff-roles': roles, './staff-password-policy': {} });
  const page = await compile('../app/staff/page.tsx', {
    '../../lib/admin-session': { ...auth, readAdminSession: async () => session },
    'next/headers': { headers: async () => new Headers() },
    'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
    '../../styles/workspace.css': {}, '../admin/login/page': { __esModule: true, default: () => createElement('form', { 'data-existing-login': true }) },
    'cloudflare:workers': { env: { DB: { prepare: () => ({ first: async () => ({ count: 1 }) }) } } },
  });
  return page.default({ searchParams: Promise.resolve({ returnTo }) });
}

for (const [role, destination] of Object.entries({ owner: '/admin', curator: '/admin', finance: '/admin/orders', support: '/admin/support', organizer: '/organizer/workspace', gate: '/scan', moderator: '/admin/rooms' })) {
  test(`staff entry continues ${role} only to an allowed workspace`, async () => {
    for (const returnTo of [undefined, 'https://evil.example', '//evil.example', '/admin/../staff', '/staff', '/admin\\evil.example', ['/admin/orders', '/scan']]) {
      await assert.rejects(loginEntry({ role }, returnTo), { message: `redirect:${destination}` });
    }
    await assert.rejects(loginEntry({ role }, `${destination}?view=all`), { message: `redirect:${destination}?view=all` });
    await assert.rejects(loginEntry({ role, mustChangePassword: true }, destination), { message: 'redirect:/admin/account' });
  });
}
test('missing or rejected staff session renders the existing login form', async () => {
  const html = renderToStaticMarkup(await loginEntry(null, '/admin/accounts'));
  assert.match(html, /data-existing-login/);
});

test('customer notifications do not replace an open staff entry tab', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listeners = new Map();
  let opened;
  const self = {
    location: { origin: 'https://tickets.becoreops.com' },
    addEventListener: (name, listener) => listeners.set(name, listener),
    clients: {
      matchAll: async () => [{ url: 'https://tickets.becoreops.com/staff', focus() {}, navigate() { throw new Error('Staff tab must remain untouched'); } }],
      openWindow: async target => { opened = target; },
    },
  };
  runInNewContext(source, { self, URL });
  let pending;
  listeners.get('notificationclick')({ notification: { close() {}, data: { url: '/notifications' } }, waitUntil: value => { pending = value; } });
  await pending;
  assert.equal(opened, '/notifications');
});
