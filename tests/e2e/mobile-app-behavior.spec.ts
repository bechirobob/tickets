import { expect, test } from '@playwright/test';
test.use({ serviceWorkers: 'block' });

test('mobile Back closes navigation before leaving and outside destinations keep the new route', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 760, 'Mobile history boundary');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Sign in' } }));
  await page.goto('/events');
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await trigger.click(); await expect(menu).toBeVisible();
  await page.goBack();
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/);
  await expect(trigger).toBeFocused();
  await trigger.click(); await expect(menu).toBeVisible();
  await page.getByRole('navigation', { name: 'Customer navigation' }).getByRole('link', { name: 'My Nights' }).click();
  await expect(page).toHaveURL(/\/my-nights$/);
  await expect(page.getByRole('heading', { name: 'My Nights', exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/events$/);
  await expect(menu).toHaveCount(0);
});

test('mobile rapid close and reopen keeps exactly the current menu in history', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 760, 'Mobile history boundary');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/events');
  const trigger = page.locator('.night-mobile-menu__trigger');
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Close navigation', exact: true }).click();
  await trigger.click();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/);
});

test('mobile chrome supports safe geometry, reduced transparency and active-tab return', async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile tab bar');
  await page.goto('/events');
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect(dock).toBeVisible();
  const sizes = await dock.getByRole('link').evaluateAll(links => links.map(link => link.getBoundingClientRect().height));
  expect(sizes.every(size => size >= 44)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 400));
  await dock.getByRole('link', { name: 'The Drop' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('mobile-app-drop.png'), fullPage: true });
});

test('mobile menu is a compact reachable sheet with working drag, focus and outside dismissal', async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile sheet and dock');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/events');
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
  await expect(menu).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const layer = page.locator('.night-mobile-menu--sheet');
  const scrim = page.locator('.night-mobile-menu__scrim');
  const layerBox = await layer.boundingBox();
  expect(layerBox!.x).toBe(0);
  expect(layerBox!.width).toBe(page.viewportSize()!.width);
  await expect(menu).toBeInViewport({ ratio: 1 });
  await expect(scrim).toBeInViewport({ ratio: 1 });
  const sheetBox = await menu.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(sheetBox!.x).toBeGreaterThanOrEqual(12);
  expect(sheetBox!.x + sheetBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 12);
  expect(sheetBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(sheetBox!.height).toBeLessThan(340);
  expect(sheetBox!.y).toBeGreaterThan(100);
  expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(dockBox!.y - 5);
  for (const destination of ['Hosts', 'Organisers', 'About us', 'Help']) {
    await expect(menu.getByRole('link', { name: destination, exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: info.outputPath('mobile-bottom-menu.png') });

  const handle = menu.locator('.night-mobile-menu__panel-header');
  let bounds = await handle.boundingBox();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + 9;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 9, { steps: 3 });
  await expect.poll(() => menu.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBe(9);
  await page.mouse.up();
  await expect(menu).toBeVisible();
  await expect(menu).not.toHaveAttribute('data-dragging');
  await expect(menu).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

  bounds = await handle.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 9);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/events$/);

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.locator('.night-mobile-menu__scrim').click({ position: { x: 25, y: 100 } });
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('mobile header and visual-viewport keyboard geometry integration preserve usable navigation', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile guest shell');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/events');
  const header = page.locator('.discovery-directory > .directory-header');
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  const initialHeader = await header.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(dockBox!.x).toBeGreaterThanOrEqual(12);
  expect(dockBox!.width).toBeLessThan(page.viewportSize()!.width - 20);
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 12);
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => header.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(Math.round(initialHeader!.y));
  const active = dock.getByRole('link', { name: 'The Drop', exact: true });
  await expect(active).toHaveAttribute('aria-current', 'page');
  const colors = await active.evaluate(element => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(colors.foreground).not.toBe(colors.background);
  // Exercise MobileAppFrame's focus/resize integration. This is simulated
  // viewport geometry, not evidence from a physical device's keyboard.
  const search = page.getByRole('searchbox', { name: 'Search events, artists or venues' });
  await expect(search).toBeEnabled();
  await search.focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error('Visual viewport is required for this geometry integration');
    Object.defineProperty(viewport, 'height', { configurable: true, value: Math.max(240, innerHeight - 280) });
    Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 0 });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
  await expect(dock).toBeHidden();
  await search.evaluate(input => (input as HTMLInputElement).blur());
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Reflect.deleteProperty(viewport, 'height');
    Reflect.deleteProperty(viewport, 'offsetTop');
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'closed');
  await expect(dock).toBeVisible();
});

test('mobile reduced-transparency preference makes navigation opaque', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium' || (page.viewportSize()?.width ?? 1000) > 700, 'Chromium exposes reduced-transparency media emulation');
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await page.goto('/events');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  for (const selector of ['.discovery-directory > .directory-header', '.customer-dock', '.night-mobile-menu--sheet .night-mobile-menu__panel']) {
    const style = await page.locator(selector).evaluate(element => {
      const computed = getComputedStyle(element);
      return { background: computed.backgroundColor, blur: computed.backdropFilter };
    });
    expect(style.background).toMatch(/^rgb\(/);
    expect(style.blur).toBe('none');
  }
  await session.detach();
});

test('crossing the sheet breakpoint closes the old layout and releases only its owned history', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 980, height: 844 });
  await page.goto('/');
  await page.goto('/events');
  const trigger = page.locator('.night-mobile-menu__trigger');
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const ownsLayer = () => page.evaluate(() => Boolean(history.state?.becoreLayer));

  await trigger.click();
  await expect(menu).toBeVisible();
  expect(await ownsLayer()).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await ownsLayer()).toBe(false);
  await expect(page).toHaveURL(/\/events$/);

  // A new mobile open must install its own Back boundary after the resize.
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect.poll(ownsLayer).toBe(true);
  await page.goBack();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/events$/);

  await trigger.click();
  await expect.poll(ownsLayer).toBe(true);
  await page.setViewportSize({ width: 980, height: 844 });
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(ownsLayer).toBe(false);
  await expect(page).toHaveURL(/\/events$/);
  // The mobile layer is gone; ordinary Back now reaches the prior page.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test('reduced-transparency preference preserves desktop header backgrounds', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium exposes reduced-transparency media emulation');
  await page.setViewportSize({ width: 980, height: 844 });
  const session = await context.newCDPSession(page);
  for (const [path, selector] of [['/', '.discovery-home > .night-header'], ['/events', '.discovery-directory > .directory-header'], ['/help', '.help-page > header']]) {
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    await page.goto(path);
    const header = page.locator(selector);
    const background = await header.evaluate(element => getComputedStyle(element).backgroundColor);
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await expect(header).toHaveCSS('background-color', background);
  }
  await session.detach();
});

test('menu labels and light guest headers keep their responsive visibility and foreground', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 664 });
  await page.goto('/help');
  const trigger = page.locator('.night-mobile-menu__trigger');
  const label = trigger.locator('.night-mobile-menu__trigger-label');
  await expect(trigger).toBeEnabled();
  await expect(label).toBeHidden();
  await page.setViewportSize({ width: 390, height: 664 });
  await expect(label).toBeVisible();
  for (const path of ['/help', '/privacy', '/terms']) {
    await page.goto(path);
    await expect(trigger).toBeEnabled();
    const header = page.locator('main > header').first();
    await expect(header).toHaveCSS('color', 'rgb(40, 27, 43)');
    await expect(label).toBeVisible();
    const triggerStyle = await trigger.evaluate(element => ({ color: getComputedStyle(element).color, font: getComputedStyle(element).fontSize }));
    await expect(label).toHaveCSS('color', triggerStyle.color);
    await expect(label).toHaveCSS('font-size', triggerStyle.font);
    expect(Number.parseFloat(triggerStyle.font)).toBeGreaterThanOrEqual(13);
  }
  await page.setViewportSize({ width: 350, height: 664 });
  await expect(label).toBeHidden();
  await expect(trigger).toBeInViewport();
});
