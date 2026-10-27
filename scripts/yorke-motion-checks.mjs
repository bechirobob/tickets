import assert from 'node:assert/strict';
import path from 'node:path';

/** Existing isolated preview context already blocks external/API traffic. */
export async function verifyYorkeMotion({ page, origin, output, checks }) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  // Observe actual browser animations without controlling production state.
  await page.addInitScript(() => {
    const evidence = { intro: false, heldDuringIntro: false, startedAfterIntro: false };
    window.__yorkeMotionEvidence = evidence;
    const start = performance.now();
    const observe = () => {
      const intro = document.querySelector('.brand-arrival[data-running]:not([hidden])');
      const first = document.querySelector('[data-yorke-phrase]')?.getAnimations()[0];
      if (intro) {
        evidence.intro = true;
        if (first && Number(first.currentTime) < 2600) evidence.heldDuringIntro = true;
      } else if (first && Number(first.currentTime) >= 2600) evidence.startedAfterIntro = true;
      if (performance.now() - start < 8000) requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  // Warm source compilation already occurred during the static preview.
  await page.goto(origin + '/the-yorke-way', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__yorkeMotionEvidence?.startedAfterIntro, null, { timeout: 10000 });
  const evidence = await page.evaluate(() => window.__yorkeMotionEvidence);
  assert.equal(evidence.intro, true, 'Fresh exact campaign URL uses existing Tickets intro');
  assert.equal(evidence.heldDuringIntro, true, 'Editorial stays held under the real intro');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-yorke-phrase], .yorke-description, .yorke-eyebrow > span')].every(el => el.getAnimations().length === 0), null, { timeout: 10000 });
  assert.equal(await page.getByRole('button', { name: 'Put me on the list', exact: true }).isEnabled(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'yorke-way-editorial-settled-mobile.png'), fullPage: true });
  checks.push('Editorial browser: fresh direct route uses existing doorway intro; hero waits for actual completion; finite effects settle; signup remains enabled');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.brand-arrival[data-running]:not([hidden])').waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button', { name: 'Skip opening animation' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Preview Guest');
  assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Preview Guest');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-yorke-phrase]')].flatMap(el => el.getAnimations()).length), 0);
  checks.push('Editorial browser: dismissing intro and entering signup leaves final static text with no animation/input gate');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.brand-arrival[data-running]').count(), 0);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-yorke-phrase]')].flatMap(el => el.getAnimations()).length), 0);
  assert.equal(await page.getByRole('heading', { name: 'Your year-end plans called. They said Kofi Bills.' }).isVisible(), true);
  checks.push('Editorial browser: reduced-motion route remains readable, static and ready');
}
