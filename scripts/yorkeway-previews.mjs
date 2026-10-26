/** Private, synthetic preview only. No database, email delivery, or deployment. */
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'outputs/yorkeway-previews');
const port = Number(process.env.YORKEWAY_PREVIEW_PORT || 4183);
const origin = `http://127.0.0.1:${port}`;
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.vps.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog = (serverLog + chunk.toString()).slice(-16000); });
let browser, page;
const checks = [];
const errors = [];
const consoleErrors = [];
const syntheticToken = 'a'.repeat(43);
try {
  // Vite announces readiness before the first route compile. Never print request data.
  const started = Date.now();
  while (!stripVTControlCharacters(serverLog).includes('Local:')) {
    if (server.exitCode !== null || Date.now() - started > 60000) throw new Error(`Local preview server did not start. ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const posts = [];
  let signupStatus = 202;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      if (request.method() === 'POST') posts.push({ path: url.pathname, body: request.postDataJSON() });
      if (url.pathname === '/api/yorkeway') return route.fulfill({ status: signupStatus, json: signupStatus === 202 ? { received: true } : { error: 'Synthetic preview failure' } });
      if (url.pathname === '/api/yorkeway/withdraw') return route.fulfill({ status: 200, json: { received: true } });
      if (url.pathname === '/api/admin/workspace') return route.fulfill({ status: 401, json: { error: 'Not signed in' } });
      return route.fulfill({ status: 404, json: { error: 'Not part of this isolated preview' } });
    }
    // The source email's approved brand asset is served locally, never fetched externally.
    if (url.hostname === 'tickets.becoreops.com' && (url.pathname.startsWith('/brand/') || url.pathname === '/hosts/the-yorke-way-email.png')) {
      const file = path.join(root, 'public', url.pathname);
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.png') ? 'image/png' : 'image/webp', body: await readFile(file) });
    }
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.setDefaultTimeout(20000);
  async function open(route = '/the-yorke-way') {
    const response = await page.goto(origin + route, { waitUntil: 'networkidle', timeout: 120000 });
    assert.equal(response.status(), 200);
    await page.locator('.yorke-way').waitFor();
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.complete ? undefined : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; }))); });
  }
  async function assertLayout(label) {
    const measure = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, shadows: [...document.querySelectorAll('.yorke-way, .yorke-way *')].filter(el => { const css = getComputedStyle(el); return css.boxShadow !== 'none' || css.textShadow !== 'none' || css.filter.includes('drop-shadow'); }).length }));
    assert.ok(measure.scroll <= measure.width, `${label}: horizontal overflow`);
    assert.equal(measure.shadows, 0, `${label}: shadow rule regression`);
    const axe = await new AxeBuilder({ page }).include('.yorke-way').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], `${label}: accessibility violations`);
    checks.push(`${label}: no overflow, no shadows, automated accessibility pass`);
  }
  async function snapshot(filename) {
    let html = await page.content();
    const css = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; } }).join('\n'));
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    for (const [asset, mime] of [['/hosts/the-yorke-way.svg','image/svg+xml'],['/brand/becore-ticket.webp','image/webp']]) {
      const data = `data:${mime};base64,${(await readFile(path.join(root, 'public', asset))).toString('base64')}`;
      html = html.replaceAll(asset, data);
    }
    html = html.replace('</head>', `<style>${css}</style></head>`).replace('<body>', '<body><div style="padding:10px 20px;background:white;color:#281b2b;font:12px/1.5 system-ui;text-align:center">Unpublished visual snapshot. Forms and navigation are inactive.</div>');
    html = html.replace(/<form\b/g, '<form inert').replace(/<a\b([^>]*?)href="[^"]*"/g, '<a$1');
    await writeFile(path.join(output, filename), html);
  }

  await open();
  await page.getByRole('button', { name: 'Put me on the list', exact: true }).waitFor();
  assert.equal(await page.locator('#yorke-consent').isChecked(), false);
  assert.equal(await page.locator('.customer-dock').count(), 0);
  assert.equal(await page.locator('img[src*="kofi-bills"]').count(), 0, 'No portrait in the revised page');
  assert.equal(await page.locator('meta[content*="kofi-bills.webp"]').count(), 0, 'No portrait in social metadata');
  assert.equal(await page.locator('.yorke-logo-stage img[src*="the-yorke-way.svg"]').count(), 1, 'Original host logo is the hero');
  await page.screenshot({ path: path.join(output, 'yorke-way-desktop.png'), fullPage: true });
  await assertLayout('Desktop 1440');
  await snapshot('yorke-way-visual-preview.html');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'yorke-way-mobile.png'), fullPage: true });
  await assertLayout('Mobile 390');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: path.join(output, 'yorke-way-mobile-320.png'), fullPage: true });
  await assertLayout('Mobile 320');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Your name', { exact: true }).fill('Preview Guest');
  await page.getByLabel('Email address', { exact: true }).fill('preview@example.invalid');
  await page.getByRole('button', { name: 'Put me on the list', exact: true }).click();
  assert.equal(posts.length, 0, 'Unchecked consent must not POST');
  await page.locator('#yorke-consent').check();
  signupStatus = 503;
  await page.getByRole('button', { name: 'Put me on the list', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Preview Guest');
  assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), 'preview@example.invalid');
  await page.screenshot({ path: path.join(output, 'yorke-way-retry-mobile.png'), fullPage: true });
  signupStatus = 202;
  await page.getByRole('button', { name: 'Put me on the list', exact: true }).click();
  await page.getByRole('heading', { name: 'You’re on the list.' }).waitFor();
  assert.deepEqual(posts.at(-1).body, { name: 'Preview Guest', email: 'preview@example.invalid', consent: true });
  await page.screenshot({ path: path.join(output, 'yorke-way-success-mobile.png'), fullPage: true });
  checks.push('Signup: unchecked consent blocks POST; synthetic failure preserves draft; retry reaches early-access signup success without another confirmation step');

  const beforeUnsubscribe = posts.length;
  await open(`/the-yorke-way/unsubscribe#${syntheticToken}`);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(posts.length, beforeUnsubscribe, 'Unsubscribe GET must not mutate');
  await page.screenshot({ path: path.join(output, 'yorke-way-unsubscribe-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
  await page.getByRole('heading', { name: 'Request received.' }).waitFor();
  assert.equal(posts.at(-1).path, '/api/yorkeway/withdraw');
  assert.equal(posts.at(-1).body.token, syntheticToken);
  checks.push('Unsubscribe: hash removed; no automatic POST; deliberate action accepted');

  // Build the actual email renderer with a non-working synthetic token, not a copy of its markup.
  const emailModule = path.join(output, 'email-renderer.mjs');
  await build({ stdin: { contents: `export { yorkewayWelcomeEmail } from './lib/yorkeway-early-access.ts';`, resolveDir: root, loader: 'ts' }, outfile: emailModule, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  const { yorkewayWelcomeEmail } = await import(pathToFileURL(emailModule).href);
  const email = yorkewayWelcomeEmail(syntheticToken);
  const inertEmail = email.html.replace(/href="[^"]*"/g, 'href="#preview-link-disabled"');
  await writeFile(path.join(output, 'welcome-email.html'), inertEmail);
  for (const [name, width, height] of [['desktop',800,900], ['mobile',390,844]]) {
    await page.setViewportSize({ width, height });
    await page.setContent(inertEmail, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await document.fonts.ready; });
    const hostLogo = page.locator('img[src*="the-yorke-way-email.png"]');
    assert.equal(await hostLogo.count(), 1, 'Welcome email contains the actual host logo');
    assert.match(await hostLogo.getAttribute('alt'), /The Yorke Way/i);
    assert.ok(Number(await hostLogo.getAttribute('width')) > 0 && Number(await hostLogo.getAttribute('height')) > 0, 'Email logo has dimensions');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Email ${name}: overflow`);
    await page.screenshot({ path: path.join(output, `welcome-email-${name}.png`), fullPage: true });
  }
  await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.fallback());
  await page.setContent(inertEmail, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'You’re on the list. Good call.' }).waitFor();
  assert.equal(await page.getByText('The Yorke Way', { exact: true }).isVisible(), true, 'Email brand remains readable with images blocked');
  await page.screenshot({ path: path.join(output, 'welcome-email-images-blocked-mobile.png'), fullPage: true });
  checks.push('Actual welcome-email renderer: host logo and alt/dimensions; desktop/mobile and blocked-image snapshots; inert links; no delivery');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ sourceRevision: process.env.PREVIEW_SOURCE_SHA ?? null, localOnly: true, apiResponses: 'mocked', databaseUsed: false, emailSent: false, checks, browserErrors: errors }, null, 2));
  console.log(`Saved ${checks.length} passed preview checks and unpublished artifacts to outputs/yorkeway-previews.`);
} catch (error) {
  // Only synthetic preview state is present. Preserve useful visual evidence even
  // when hydration, layout, or accessibility fails before the normal captures.
  let diagnostic = null;
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'preview-failure.png'), fullPage: true }).catch(() => {});
    diagnostic = await page.evaluate(() => ({ path: location.pathname, title: document.title, text: document.body.innerText.slice(0, 3000), campaignNodes: document.querySelectorAll('.yorke-way').length })).catch(() => null);
  }
  await writeFile(path.join(output, 'preview-error.txt'), `${String(error.stack ?? error)}\n\nBrowser errors:\n${errors.join('\n')}\n\nPage:\n${JSON.stringify(diagnostic, null, 2)}\n\nLocal server:\n${stripVTControlCharacters(serverLog)}`);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ sourceRevision: process.env.PREVIEW_SOURCE_SHA ?? null, localOnly: true, apiResponses: 'mocked', databaseUsed: false, emailSent: false, passed: false, checks, browserErrors: errors, consoleErrors, diagnostic }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
