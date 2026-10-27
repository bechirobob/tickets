// A fail-closed readiness check, not release admission or an audit replacement.
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateVersions(config, lock, installed, nodeVersion, osRelease) {
  assert.match(config.image, new RegExp(`^mcr\\.microsoft\\.com/playwright:v${config.playwrightVersion.replaceAll('.', '\\.')}\\-noble@sha256:[a-f0-9]{64}$`));
  assert.equal(lock.packages['node_modules/@playwright/test'].version, config.playwrightVersion);
  assert.equal(lock.packages['node_modules/playwright'].version, config.playwrightVersion);
  assert.equal(installed, config.playwrightVersion);
  assert.equal(nodeVersion, config.nodeVersion);
  assert.match(osRelease, new RegExp(`^ID=${config.osId}$`, 'm'));
  assert.match(osRelease, new RegExp(`^VERSION_ID="${config.osVersion.replaceAll('.', '\\.')}"$`, 'm'));
}

export async function verifyBrowserEnvironment(engines) {
  assert.ok(engines.length > 0 && engines.every(name => ['chromium', 'webkit', 'firefox'].includes(name)));
  const started = performance.now();
  const config = JSON.parse(await readFile(new URL('./browser-environment.json', import.meta.url), 'utf8'));
  const require = createRequire(resolve('package.json'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const installed = require('@playwright/test/package.json').version;
  validateVersions(config, lock, installed, process.versions.node, await readFile('/etc/os-release', 'utf8'));
  assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright');
  const playwright = require('@playwright/test');
  const checks = [];
  for (const engine of engines) {
    const executable = playwright[engine].executablePath();
    assert.ok(resolve(executable).startsWith('/ms-playwright' + sep));
    await access(executable, constants.X_OK);
    const start = performance.now();
    const browser = await playwright[engine].launch(engine === 'chromium' ? { channel: 'chromium' } : {});
    try {
      const page = await browser.newPage();
      await page.setContent('<main>Prepared browser ready</main>');
      assert.equal(await page.locator('main').textContent(), 'Prepared browser ready');
      checks.push({ engine, version: browser.version(), readyMs: Math.round(performance.now() - start) });
    } finally {
      await browser.close();
    }
  }
  console.log(JSON.stringify({ image: config.image, node: process.versions.node, playwright: installed,
    checks, totalReadyMs: Math.round(performance.now() - started) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyBrowserEnvironment(process.argv.slice(2));
}
