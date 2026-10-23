import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './analytics-fixture';
import { expectVisibleLettering } from './text-visibility';

test.use({ serviceWorkers: 'block' });

const destinations = [
  ['Discover hosts', '/hosts'],
  ['List your event', '/organizer/submit'],
  ['About us', '/about'],
  ['Help', '/help'],
];

test('Option A keeps full-width rows, quiet controls and keyboard access in portrait and landscape', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 320, height: 664 }, { width: 390, height: 844 }, { width: 700, height: 390 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/events');
    const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await trigger.press('Enter');
    const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const close = menu.getByRole('button', { name: 'Close navigation', exact: true });
    await expect(menu).toBeVisible();
    await expect(close).toBeFocused();
    await expect(menu).toHaveCSS('border-radius', '0px');
    await expect(menu.locator('.night-mobile-menu__links')).toHaveCSS('border-top-left-radius', '10px');
    await expect(menu).toHaveCSS('box-shadow', 'none');
    await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const anchor = await trigger.boundingBox();
    const cap = await menu.locator('.night-mobile-menu__panel-header').boundingBox();
    expect(cap!.x).toBeCloseTo(anchor!.x, 1);
    expect(cap!.y).toBeCloseTo(anchor!.y, 1);
    expect(cap!.width).toBeCloseTo(anchor!.width, 1);
    expect(cap!.height).toBeCloseTo(anchor!.height, 1);
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(194);
    const logo = page.locator('.directory-header .brand').first();
    if (await logo.count()) {
      expect(await logo.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
    const closeBounds = await close.boundingBox();
    expect(closeBounds!.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds!.height).toBeGreaterThanOrEqual(44);
    const rows = menu.getByRole('link');
    const geometry = await rows.evaluateAll(links => links.map(link => {
      const { x, y, width, height } = link.getBoundingClientRect();
      return { x, y, width, height };
    }));
    for (let index = 0; index < geometry.length; index++) {
      expect(geometry[index].height).toBeGreaterThanOrEqual(44);
      expect(geometry[index].x).toBeCloseTo(geometry[0].x, 1);
      expect(geometry[index].width).toBeCloseTo(geometry[0].width, 1);
      if (index > 0) expect(geometry[index].y).toBeGreaterThanOrEqual(geometry[index - 1].y + geometry[index - 1].height);
    }
    if (viewport.width <= 700) {
      await expect(rows).toHaveCount(4);
      for (const [name, href] of destinations) await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
      await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    }
    for (let index = 0; index < await rows.count(); index++) {
      await page.keyboard.press('Tab');
      await expect(rows.nth(index)).toBeFocused();
      await expect(rows.nth(index)).toBeInViewport({ ratio: 1 });
    }
    await expectVisibleLettering(page, '.night-mobile-menu__panel');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await close.focus();
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport({ ratio: 1 });
    expect((await new AxeBuilder({ page }).include('.night-mobile-menu__panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`option-a-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  }
});

test('Option A keeps existing host and organiser destinations and Back behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [name, href] of destinations.slice(0, 2)) {
    await page.goto('/events');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    await menu.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(menu).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/events$/);
    await expect(menu).toHaveCount(0);
  }
});

test('Option A wraps enlarged labels and retains navigation on a page without the customer dock', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/organizer/submit');
  // Keep production style-src 'self' enforced while exercising enlarged labels.
  const enlargedLabelsUrl = new URL('/__e2e__/menu-enlarged-labels.css', page.url()).href;
  await page.route(enlargedLabelsUrl, route => route.fulfill({ contentType: 'text/css', body: '.night-mobile-menu__panel a > span { font-size: 28px; }' }));
  await page.addStyleTag({ url: enlargedLabelsUrl });
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  await trigger.click();
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const rows = menu.getByRole('link');
  await expect(rows).toHaveCount(7);
  for (let index = 0; index < await rows.count(); index++) {
    await expect(rows.nth(index).locator(':scope > span')).toHaveCSS('font-size', '28px');
    await page.keyboard.press('Tab');
    await expect(rows.nth(index)).toBeFocused();
    await expect(rows.nth(index)).toBeInViewport({ ratio: 1 });
  }
  await expectVisibleLettering(page, '.night-mobile-menu__panel');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('Option A keeps native keyboard focus inside the short-landscape scrollport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 390 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/events');
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await trigger.press('Enter');
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const close = menu.getByRole('button', { name: 'Close navigation', exact: true });
  const rows = menu.getByRole('link');
  await expect(close).toBeFocused();
  await expect(rows).toHaveCount(4);
  const scrollport = menu.locator('.night-mobile-menu__links');
  await expect(scrollport).toHaveCSS('scroll-padding-top', '6px');
  await expect(scrollport).toHaveCSS('scroll-padding-bottom', '6px');
  // Compact rows need not overflow at 390px high; force a shorter viewport to
  // exercise native keyboard scrolling without changing production row sizes.
  await page.setViewportSize({ width: 700, height: 300 });
  expect(await scrollport.evaluate(panel => panel.scrollHeight > panel.clientHeight)).toBe(true);

  // Only native Tab changes focus/scrolling. Never repair visibility in the test.
  for (const direction of ['Tab', 'Shift+Tab']) {
    const indices = direction === 'Tab' ? [0, 1, 2, 3] : [2, 1, 0];
    for (const index of indices) {
      await page.keyboard.press(direction);
      const row = rows.nth(index);
      await expect(row).toBeFocused();
      await expect(row).toBeInViewport({ ratio: 1 });
      await expect.poll(() => row.evaluate(link => {
        const panel = link.closest('.night-mobile-menu__links')!;
        const bounds = panel.getBoundingClientRect();
        const style = getComputedStyle(panel);
        const rowBounds = link.getBoundingClientRect();
        return Math.min(
          rowBounds.top - bounds.top - parseFloat(style.borderTopWidth),
          bounds.bottom - parseFloat(style.borderBottomWidth) - rowBounds.bottom,
        );
      })).toBeGreaterThan(2);
    }
  }
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('header menu retracts into its button and interrupted exits cannot navigate or steal focus', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/events');
  const trigger = page.locator('.night-mobile-menu__trigger');
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const menu = page.locator('.night-mobile-menu--anchored .night-mobile-menu__panel');
  await expect(menu).toHaveAttribute('data-phase', 'open');
  await expect(menu).toHaveCSS('clip-path', 'inset(0px)');
  await page.screenshot({ path: info.outputPath('header-origin-390-open.png') });
  await menu.evaluate(panel => {
    const close = panel.querySelector<HTMLButtonElement>('button')!;
    close.addEventListener('click', () => requestAnimationFrame(() => {
      const surface = panel.querySelector('.night-mobile-menu__links')!;
      const bounds = surface.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.right - 20, bounds.top + 20);
      panel.setAttribute('data-exit-probe', JSON.stringify({ phase: panel.getAttribute('data-phase'), covered: hit !== null && panel.contains(hit), inert: (panel as HTMLElement).inert }));
    }), { once: true });
  });
  // A real pointer click, not programmatic activation, exercises cap hit testing.
  await menu.getByRole('button', { name: 'Close navigation' }).click();
  await expect(menu).toHaveAttribute('data-exit-probe', /closing/);
  const closing = JSON.parse((await menu.getAttribute('data-exit-probe'))!);
  expect(closing.phase).toBe('closing');
  expect(closing.covered).toBe(true);
  expect(closing.inert).toBe(false);
  await expect(trigger).toBeFocused();
  // Keyboard users can reopen from the restored trigger during its exit.
  await trigger.press('Enter');
  await expect(menu).toHaveAttribute('data-phase', 'open');
  await expect(menu.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('data-phase', 'closed');
  await expect(menu).toHaveAttribute('inert', '');
  await expect(trigger).toHaveCSS('opacity', '1');
  await expect(page).toHaveURL(/\/events$/);
});
