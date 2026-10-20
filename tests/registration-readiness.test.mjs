import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../app/registration-form.tsx', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs' });
const requireDependency = createRequire(import.meta.url);
function loadRegistrationForm(runtime = {}) {
  const componentModule = { exports: {} };
  const require = specifier => {
    if (specifier === './my-registrations') return { __esModule: true, default: ({ eventSlug }) => createElement('span', { 'data-registration-status': eventSlug }) };
    if (specifier === './confirmation-notifications') return { __esModule: true, default: () => null };
    if (specifier === 'next/link') return { __esModule: true, default: ({ children, ...props }) => createElement('a', props, children) };
    if (specifier === './action') return { ActionButton: ({ children, ...props }) => { delete props.icon; delete props.variant; return createElement('button', props, children); } };
    if (specifier === './customer-runtime') return { useCustomerRuntime: () => runtime };
    if (specifier === '../lib/registration-guidance') return { rsvpGuestGuidance: () => ({ beforeRequest: 'Request your place', form: 'Guest details' }) };
    if (specifier === '../lib/registration-draft') return { registrationDrafts: { read() { throw new Error('Server rendering must not read browser drafts'); } } };
    return requireDependency(specifier);
  };
  runInNewContext(compiled.code, { module: componentModule, exports: componentModule.exports, require });
  return componentModule.exports.default;
}
const RegistrationForm = loadRegistrationForm();

for (const mode of ['rsvp', 'interest']) {
  test(`${mode} server opener is disabled and busy until hydration`, () => {
    const html = renderToStaticMarkup(createElement(RegistrationForm, { eventSlug: 'readiness-fixture', mode, maxPartySize: 1, approvalRequired: false }));
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-busy="true"/);
    assert.doesNotMatch(html, /<form/);
  });
  test(`${mode} direct server form disables inputs and submission without carrying consent`, () => {
    const html = renderToStaticMarkup(createElement(RegistrationForm, { eventSlug: 'readiness-fixture', mode, maxPartySize: 1, approvalRequired: false, initiallyOpen: true }));
    assert.match(html, /<fieldset disabled="" aria-busy="true">/);
    assert.match(html, /name="guestName"/);
    assert.match(html, /name="email"/);
    assert.match(html.match(/<input[^>]*name="acceptedTerms"[^>]*>/)?.[0] ?? '', /required=""/);
    assert.match(html, /type="submit"/);
    assert.doesNotMatch(html, /checked=""/);
  });
}

for (const [surface, runtime] of [['website/PWA', {}], ['secure-browser wrapper', { openSecurePage: async () => {} }]]) {
  for (const mode of ['rsvp', 'interest']) {
    test(`${surface} ${mode} keeps private registration status in its owning runtime`, () => {
      const Form = loadRegistrationForm(runtime);
      const html = renderToStaticMarkup(createElement(Form, { eventSlug: 'readiness-fixture', mode, maxPartySize: 1, approvalRequired: false }));
      const status = /data-registration-status="readiness-fixture"/;
      if (mode === 'rsvp' && !runtime.openSecurePage) assert.match(html, status);
      else assert.doesNotMatch(html, status);
    });
  }
}
