import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const requireDependency = createRequire(import.meta.url);
const source = await readFile(new URL('../app/mobile-navigation.tsx', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;

function renderMenu({ open = true, pathname = '/events', primaryVisible = false } = {}) {
  const component = { exports: {} };
  runInNewContext(compiled, {
    module: component, exports: component.exports,
    require(specifier) {
      if (specifier === 'next/link') return { __esModule: true, default: ({ children, ...props }) => createElement('a', props, children) };
      if (specifier === 'next/navigation') return { usePathname: () => pathname };
      if (specifier === './use-header-panel') return { useHeaderPanel: () => ({ open, phase: open ? 'open' : 'closed', ready: true, trigger: { current: null }, panel: { current: null }, id: 'menu', toggle() {}, close() {} }) };
      return requireDependency(specifier);
    },
  });
  return renderToStaticMarkup(createElement(component.exports.default, { primaryVisible }));
}

test('Option A gives existing destinations clearer labels without changing routes or roles', () => {
  const html = renderMenu({ primaryVisible: true });
  const links = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map(([, attributes, body]) => ({
    href: attributes.match(/href="([^"]+)"/)?.[1],
    label: body.match(/<span>([^<]+)<\/span>/)?.[1],
    attributes, body,
  }));
  assert.deepEqual(links.map(({ href, label }) => [href, label]), [
    ['/', 'Home'], ['/events', 'The Drop'], ['/hosts', 'Discover hosts'], ['/my-nights', 'My Nights'],
    ['/organizer/submit', 'List your event'], ['/about', 'About us'], ['/help', 'Help'],
  ]);
  assert.equal(links.filter(link => link.attributes.includes('menu-primary-route')).length, 3);
  assert.match(links.find(link => link.href === '/hosts').attributes, /menu-host-route/);
  assert.equal(links.filter(link => link.attributes.includes('menu-secondary-route')).length, 2);
  assert.match(links.find(link => link.href === '/about').attributes, /menu-section-start/);
  for (const link of links) {
    assert.match(link.body, /class="lucide lucide-chevron-right night-mobile-menu__chevron"/);
    assert.equal((link.body.match(/aria-hidden="true"/g) ?? []).length, 2);
  }
  assert.match(links.find(link => link.href === '/events').attributes, /aria-current="page"/);
  assert.match(html, /<nav[^>]*aria-label="Main navigation"[^>]*aria-hidden="false"/);
  assert.doesNotMatch(html, /role="(?:menu|dialog)"/);
});

test('closed Option A remains inert and keeps every destination outside keyboard navigation', () => {
  const html = renderMenu({ open: false });
  assert.match(html, /<nav[^>]*inert=""[^>]*aria-hidden="true"/);
  assert.equal((html.match(/<a[^>]*tabindex="-1"/g) ?? []).length, 7);
  assert.match(html, /aria-label="Close navigation"[^>]*tabindex="-1"/);
  assert.match(html, /aria-expanded="false"[^>]*aria-controls="menu"/);
});

test('header-origin menu keeps a narrow contiguous surface and accessible targets without a sheet', async () => {
  const css = await readFile(new URL('../app/header-origin-menu.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /--menu-anchor-top/);
  assert.match(css, /--menu-anchor-width/);
  assert.match(css, /--menu-anchor-height/);
  assert.match(css, /background:\s*transparent[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.night-mobile-menu__panel-header\s*\{[^}]*border-radius:\s*10px 10px 0 0[^}]*background:\s*#30212c/s);
  assert.match(css, /\.night-mobile-menu__links\s*\{[^}]*border-radius:\s*10px 0 10px 10px[^}]*background:\s*#30212c/s);
  assert.match(css, /\.night-mobile-menu__close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  assert.match(css, /a\.menu-secondary-route\s*\{[^}]*min-height:\s*44px/);
  assert.doesNotMatch(source, /night-mobile-menu--sheet|night-mobile-menu__scrim/);
});

test('header-origin menu scrolls the list without moving the close control, with a reduced-motion fallback', async () => {
  const css = await readFile(new URL('../app/header-origin-menu.css', import.meta.url), 'utf8');
  assert.match(css, /\.night-mobile-menu__links\s*\{[^}]*overflow:\s*auto[^}]*scroll-padding-block:\s*6px/);
  assert.match(css, /\.night-mobile-menu__panel\s*\{[^}]*overflow:\s*visible[^}]*grid-template-rows:\s*var\(--menu-anchor-height, 44px\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none; transform: none/);
});
