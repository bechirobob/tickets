import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const productionOrigin = 'https://tickets.becoreops.com';
const fullSha = /^[a-f0-9]{40}$/u;

export function verifyReleaseIdentity(version, { health, expectedRevision } = {}) {
  if (version?.service !== 'becore-tickets' || !fullSha.test(version.revision ?? '')) {
    throw new Error('Website release identity must name Tickets and a full commit SHA');
  }
  if (expectedRevision && version.revision !== expectedRevision) {
    throw new Error('Website revision changed or does not match the expected source');
  }
  if (health && (health.service !== 'becore-tickets' || health.runtime !== 'vps' ||
    health.active !== true || health.revision !== version.revision)) {
    throw new Error('Production health must identify the same active Tickets VPS revision');
  }
  return version.revision;
}

export function isReadOnlyRequest(method) {
  return method === 'GET' || method === 'HEAD';
}

export function isInsideViewport(bounds, viewport) {
  if (!bounds || !viewport || ![bounds.x, bounds.y, bounds.width, bounds.height, viewport.width, viewport.height].every(Number.isFinite)) return false;
  return viewport.width > 0 && viewport.height > 0 && bounds.width > 0 && bounds.height > 0 &&
    bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height;
}

export function assessMenuGeometry(geometry) {
  const problems = [];
  const excludedControls = [];
  const check = (name, element) => {
    if (!isInsideViewport(element?.bounds, geometry.viewport)) problems.push(`${name} must have positive dimensions fully inside the viewport`);
    if (element?.visible !== true || element?.inert || element?.ariaHidden === 'true') problems.push(`${name} is hidden or inert`);
    if (element?.visibilityAncestors?.some(ancestor => !ancestor.visible || ancestor.inert || ancestor.ariaHidden === 'true')) problems.push(`${name} has a hidden or inert ancestor inside the panel`);
  };
  check('Menu panel', geometry.panel);
  check('Menu close control', geometry.close);
  if (!geometry.controls?.length) problems.push('Menu must contain visible navigation controls');
  for (const [index, control] of (geometry.controls ?? []).entries()) {
    // notifications.css intentionally removes only these dock duplicates at
    // <=700px. Hidden secondary or unexpected controls must still fail.
    const primaryDuplicate = geometry.viewport?.width <= 700 && geometry.customerDockPresent === true &&
      control.tag === 'A' && ['/', '/events', '/my-nights'].includes(control.href) &&
      control.className?.split(/\s+/u).includes('menu-primary-route') && control.computed?.display === 'none';
    if (primaryDuplicate) excludedControls.push({ index, href: control.href, reason: 'Intentional hidden duplicate of mobile dock destination' });
    else check(`Menu control ${index + 1}`, control);
  }
  for (const href of ['/hosts', '/organizer/submit', '/about', '/help']) {
    if (!geometry.controls?.some(control => control.tag === 'A' && control.href === href)) problems.push(`Required menu destination is missing: ${href}`);
  }
  for (const ancestor of geometry.ancestors ?? []) {
    if (!ancestor.visible || ancestor.inert || ancestor.ariaHidden === 'true') problems.push('Menu has a hidden or inert ancestor');
  }
  return { passed: problems.length === 0, problems, ...(excludedControls.length ? { excludedControls } : {}) };
}

async function measureMenuGeometry(page) {
  return page.evaluate(viewport => {
    const panel = document.querySelector('.night-mobile-menu__panel');
    const describe = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visibilityAncestors = [];
      if (element !== panel) {
        for (let ancestor = element.parentElement; ancestor && ancestor !== panel; ancestor = ancestor.parentElement) {
          const inherited = getComputedStyle(ancestor);
          visibilityAncestors.push({
            tag: ancestor.tagName, className: ancestor.className, inert: ancestor.inert, ariaHidden: ancestor.getAttribute('aria-hidden'),
            display: inherited.display, visibility: inherited.visibility, opacity: inherited.opacity,
            visible: inherited.display !== 'none' && inherited.visibility === 'visible' && Number(inherited.opacity) > 0,
          });
        }
      }
      const computed = Object.fromEntries([
        'display', 'visibility', 'opacity', 'backgroundColor', 'backdropFilter', 'webkitBackdropFilter', 'position', 'top', 'right', 'bottom', 'left',
        'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
        'justifySelf', 'alignSelf', 'justifyContent', 'alignItems', 'gridTemplateColumns', 'gridTemplateRows',
        'transform', 'translate', 'zIndex', 'pointerEvents', 'overflow', 'overflowX', 'overflowY',
      ].map(property => [property, style[property]]));
      return {
        tag: element.tagName, className: element.className, id: element.id, href: element.getAttribute('href'),
        label: element.getAttribute('aria-label'), phase: element.getAttribute('data-phase'),
        ariaHidden: element.getAttribute('aria-hidden'), inert: element.inert, visibilityAncestors,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, computed,
        visible: style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0,
      };
    };
    const ancestors = [];
    for (let element = panel?.parentElement; element; element = element.parentElement) ancestors.push(describe(element));
    return {
      viewport, layoutViewport: { width: innerWidth, height: innerHeight }, customerDockPresent: Boolean(document.querySelector('.customer-dock')),
      visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale } : null,
      scroll: { x: scrollX, y: scrollY },
      panel: describe(panel), close: describe(panel?.querySelector('.night-mobile-menu__close')),
      controls: [...(panel?.querySelectorAll('a[href], button:not(.night-mobile-menu__close)') ?? [])].map(describe),
      ancestors,
    };
  }, page.viewportSize());
}

async function readJson(origin, pathname) {
  const response = await fetch(new URL(pathname, origin), {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
    headers: { 'accept': 'application/json', 'cache-control': 'no-cache' },
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`Release evidence requires HTTP 200: ${pathname} (${response.status})`);
  }
  if (!response.body) throw new Error(`Release evidence body is missing: ${pathname}`);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) {
        await reader.cancel();
        throw new Error(`Release evidence exceeds 64 KiB: ${pathname}`);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export async function readReleaseEvidence(origin, { production = false, expectedRevision } = {}) {
  const version = await readJson(origin, '/api/version');
  const health = production ? await readJson(origin, '/healthz') : undefined;
  if (production && !health) throw new Error('Production health evidence is missing');
  const revision = verifyReleaseIdentity(version, { health, expectedRevision });
  return {
    origin, revision, verifiedAt: new Date().toISOString(),
    version: { service: version.service, revision, versionId: version.versionId ?? null },
    ...(production ? { health: { service: health.service, runtime: health.runtime, active: health.active, revision: health.revision } } : {}),
  };
}

function mainHistoryEvidence(repo, revision) {
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git(['show-ref', '--verify', 'refs/remotes/origin/main']);
    git(['cat-file', '-e', `${revision}^{commit}`]);
  } catch {
    return { verified: false, reason: 'Main reference or baseline commit unavailable in this checkout' };
  }
  try {
    git(['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main']);
  } catch {
    if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
      return { verified: false, reason: 'Shallow checkout cannot establish main ancestry' };
    }
    throw new Error('Live baseline commit is not in the available origin/main history');
  }
  return { verified: true, mainRevision: git(['rev-parse', 'refs/remotes/origin/main']) };
}

async function settleVisiblePage(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Decode only artwork in this viewport. Do not alter production page content
    // or turn a deferred image outside the viewport into a network prerequisite.
    const visibleImages = [...document.images].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight;
    });
    await Promise.race([
      Promise.all(visibleImages.map(image => image.decode().catch(() => {}))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Visible artwork did not settle')), 15000)),
    ]);
  });
  await page.waitForTimeout(250);
}

// Independent anonymous contexts are deliberate: the live side never receives
// the catalogue fixtures or local artwork routes used by the native parity pass.
export async function captureWebsiteComparison({ browser, device, outputDir, repo, candidateOrigin, sourceRevision, expectedBaselineRevision }) {
  if (!fullSha.test(sourceRevision ?? '')) throw new Error('Candidate comparison requires the exact source commit SHA');
  const directory = path.join(outputDir, 'website-comparison');
  await mkdir(directory, { recursive: true });
  const manifest = {
    schemaVersion: 1, status: 'capturing', startedAt: new Date().toISOString(),
    engine: 'Playwright WebKit on macOS, iPhone 13 viewport',
    viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor,
    authentication: 'Fresh anonymous contexts; no account data entered',
    requestPolicy: 'GET and HEAD only; other requests and WebSockets blocked; no response substitutions',
    baseline: null, candidate: null, screenshots: [], menuChecks: [], blockedRequests: [],
  };
  const save = () => writeFile(path.join(directory, 'comparison.json'), JSON.stringify(manifest, null, 2) + '\n');
  await save();
  try {
    const baselineBefore = await readReleaseEvidence(productionOrigin, { production: true, expectedRevision: expectedBaselineRevision });
    const candidateBefore = await readReleaseEvidence(candidateOrigin, { expectedRevision: sourceRevision });
    manifest.baseline = { side: 'before', sourceRevision: baselineBefore.revision, before: baselineBefore, mainHistory: mainHistoryEvidence(repo, baselineBefore.revision) };
    manifest.candidate = { side: 'after', sourceRevision, before: candidateBefore };
    await save();
    for (const [side, origin, revision] of [
      ['before', productionOrigin, baselineBefore.revision],
      ['after', candidateOrigin, sourceRevision],
    ]) {
      const context = await browser.newContext(device);
      try {
        await context.route('**/*', async route => {
          if (isReadOnlyRequest(route.request().method())) return route.continue();
          // This also blocks analytics POSTs. Do not install a later analytics
          // route that would override the comparison's read-only contract.
          // Public paths only are recorded, never bodies, cookies or tokens.
          manifest.blockedRequests.push({ side, method: route.request().method(), path: new URL(route.request().url()).pathname });
          return route.abort('blockedbyclient');
        });
        await context.routeWebSocket('**/*', socket => socket.close());
        const page = await context.newPage();
        for (const [state, route] of [['home', '/'], ['menu', '/'], ['my-nights', '/my-nights']]) {
          if (state !== 'menu') {
            const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
            if (!response?.ok()) throw new Error(`${side} ${state} returned an unsuccessful page response`);
            await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 20000 });
            await page.getByRole('button', { name: 'Open navigation', exact: true }).waitFor({ state: 'visible' });
          } else {
            await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
            await page.locator('.night-mobile-menu__panel').waitFor({ state: 'attached' });
          }
          await settleVisiblePage(page);
          const actualUrl = new URL(page.url());
          if (actualUrl.origin !== origin || actualUrl.pathname !== route) throw new Error(`${side} ${state} navigated away from the expected public page`);
          let menuCheck;
          if (state === 'menu') {
            const geometry = await measureMenuGeometry(page);
            menuCheck = { side, sourceRevision: revision, measuredAt: new Date().toISOString(), geometry, assessment: assessMenuGeometry(geometry) };
            manifest.menuChecks.push(menuCheck);
            // Save even invalid geometry before taking the diagnostic image or
            // throwing: an offscreen sheet must never produce green evidence.
            await save();
          }
          const filename = `${side}-${state}.png`;
          await page.screenshot({ path: path.join(directory, filename), animations: 'disabled', fullPage: false });
          manifest.screenshots.push({ side, state, filename, url: page.url(), sourceRevision: revision, capturedAt: new Date().toISOString(), viewport: page.viewportSize(), horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
          await save();
          if (menuCheck && !menuCheck.assessment.passed) throw new Error(`${side} menu geometry failed: ${menuCheck.assessment.problems.join('; ')}`);
          console.log(`Website comparison ${side}: ${state} (${revision})`);
        }
      } finally { await context.close(); }
    }
    manifest.baseline.after = await readReleaseEvidence(productionOrigin, { production: true, expectedRevision: baselineBefore.revision });
    manifest.candidate.after = await readReleaseEvidence(candidateOrigin, { expectedRevision: sourceRevision });
    manifest.status = 'complete';
    manifest.finishedAt = new Date().toISOString();
    await save();
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = error instanceof Error ? error.message : String(error);
    await save();
    throw error;
  }
  return manifest;
}
