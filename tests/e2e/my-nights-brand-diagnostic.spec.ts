import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from './analytics-fixture';

test('record immediate and settled My Nights header without changing product state', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-webkit', 'Bounded iPhone-viewport WebKit diagnostic.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('.night-mobile-menu__panel')).toBeAttached();
  await page.goto('/my-nights', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images].filter(image => { const box = image.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; });
    await Promise.race([Promise.all(images.map(image => image.decode().catch(() => {}))), new Promise((_, reject) => setTimeout(() => reject(new Error('Image readiness timed out')), 15000))]);
  });
  await page.waitForTimeout(250);
  const records = [];
  for (const state of ['immediate', 'settled']) {
    if (state === 'settled') await page.waitForTimeout(1500);
    const dom = await page.evaluate(() => {
      const header = document.querySelector('.my-nights-page > .directory-header');
      const nodes = [header, header?.querySelector('.brand-mark'), header?.querySelector('.brand-logo'), header?.querySelector('.brand-logo__emblem'), header?.querySelector('.brand-logo__type')];
      return { scroll: { x: scrollX, y: scrollY }, viewport: { width: innerWidth, height: innerHeight }, active: document.activeElement?.tagName,
        headerHtml: header?.outerHTML, nodes: nodes.map(node => {
          if (!(node instanceof HTMLElement)) return null;
          const box = node.getBoundingClientRect(), css = getComputedStyle(node);
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { className: node.className, box: box.toJSON(), display: css.display, visibility: css.visibility, opacity: css.opacity,
            color: css.color, background: css.backgroundColor, transform: css.transform, position: css.position,
            zIndex: css.zIndex, clipPath: css.clipPath, hit: hit?.tagName + '.' + hit?.className,
            image: node instanceof HTMLImageElement ? { src: node.currentSrc, complete: node.complete, width: node.naturalWidth, height: node.naturalHeight } : null };
        }) };
    });
    const filename = `my-nights-brand-${state}.png`;
    const bytes = await page.screenshot({ path: info.outputPath(filename), fullPage: false, scale: 'css' });
    expect(bytes.length).toBeLessThan(3 * 1024 * 1024);
    records.push({ state, filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), dom });
  }
  const manifest = { source: process.env.BECORE_RELEASE_SHA, project: info.project.name, engine: 'Pinned Playwright WebKit on Ubuntu; not physical iPhone or macOS', records };
  writeFileSync(info.outputPath('my-nights-brand-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('MY_NIGHTS_BRAND_DIAGNOSTIC ' + JSON.stringify(manifest));
  await expect(page.locator('.my-nights-page > .directory-header .brand-logo')).toBeVisible();
});
