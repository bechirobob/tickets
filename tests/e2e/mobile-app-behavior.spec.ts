import AxeBuilder from "@axe-core/playwright";
import { expect, test } from './analytics-fixture';
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

test('mobile menu is a compact header-origin menu with working drag, focus and outside dismissal', async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile menu and dock');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/events');
  const trigger = page.locator('.night-mobile-menu__trigger');
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await trigger.click();
  await expect(trigger).toHaveAccessibleName('Close navigation');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
  await expect(menu).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const layer = page.locator('.night-mobile-menu--anchored');
  await expect(page.locator('.night-mobile-menu__scrim')).toHaveCount(0);
  // The portal wrapper is not a full-width sheet. Measure its visible cap
  // and panel against the actual header control, including hit-target size.
  await expect(layer).toHaveCSS('pointer-events', 'none');
  const anchorBox = await trigger.boundingBox();
  const capBox = await menu.locator('.night-mobile-menu__panel-header').boundingBox();
  expect(anchorBox).not.toBeNull();
  expect(capBox).not.toBeNull();
  expect(capBox!.x).toBeCloseTo(anchorBox!.x, 1);
  expect(capBox!.y).toBeCloseTo(anchorBox!.y, 1);
  expect(capBox!.width).toBeCloseTo(anchorBox!.width, 1);
  expect(capBox!.height).toBeCloseTo(anchorBox!.height, 1);
  expect(capBox!.width).toBeGreaterThanOrEqual(44);
  expect(capBox!.height).toBeGreaterThanOrEqual(44);
  await expect(menu).toBeInViewport({ ratio: 1 });
  const panelBox = await menu.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(12);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 12);
  expect(panelBox!.height).toBeLessThan(340);
  expect(panelBox!.y).toBeCloseTo(anchorBox!.y, 1);
  expect(panelBox!.x + panelBox!.width).toBeCloseTo(anchorBox!.x + anchorBox!.width, 1);
  expect(panelBox!.width).toBeLessThanOrEqual(194);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(dockBox!.y - 5);
  for (const destination of ['Discover hosts', 'List your event', 'About us', 'Help']) {
    await expect(menu.getByRole('link', { name: destination, exact: true })).toBeInViewport();
  }
  const menuBacking = await menu.locator('.night-mobile-menu__links').evaluate(element => {
    const channels = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    return channels.length === 4 ? channels[3] : 1;
  });
  expect(menuBacking).toBeGreaterThanOrEqual(.97);
  expect((await new AxeBuilder({ page }).include('.night-mobile-menu--anchored').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('mobile-header-origin-menu.png') });

  const handle = menu.locator('.night-mobile-menu__panel-header');
  let bounds = await handle.boundingBox();
  const x = bounds!.x + 3;
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
  await page.mouse.move(bounds!.x + 3, bounds!.y + 9);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 3, bounds!.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/events$/);

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(8, 200);
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await expect(trigger).toBeFocused();
});

test('mobile header and visual-viewport keyboard geometry integration preserve usable navigation', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile guest shell');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/events');
  const header = page.locator('.discovery-directory > .directory-header');
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  // Streamed navigation can finish before the guest shell has mounted/hydrated.
  // Measure real, ready elements rather than treating a missing box as geometry.
  await expect(header).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeEnabled();
  let initialHeader = await header.boundingBox();
  let dockBox = await dock.boundingBox();
  await expect.poll(async () => {
    initialHeader = await header.boundingBox();
    dockBox = await dock.boundingBox();
    return initialHeader !== null && dockBox !== null
      && initialHeader.width > 0 && initialHeader.height > 0
      && dockBox.width > 0 && dockBox.height > 0;
  }, { message: 'The hydrated mobile header and dock must have usable geometry' }).toBe(true);
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
  for (const selector of ['.discovery-directory > .directory-header', '.customer-dock', '.night-mobile-menu--anchored .night-mobile-menu__links']) {
    const style = await page.locator(selector).evaluate(element => {
      const computed = getComputedStyle(element);
      return { background: computed.backgroundColor, blur: computed.backdropFilter };
    });
    expect(style.background).toMatch(/^rgb\(/);
    expect(style.blur).toBe('none');
  }
  await session.detach();
});

test('crossing the mobile breakpoint closes the old layout and releases only its owned history', async ({ page }) => {
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

test('dense My Nights headers keep the full brand and separate 44px controls at narrow widths', async ({ page }, info) => {
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated header geometry' } }));
  await page.goto('/my-nights');
  const header = page.locator('.my-nights-page > .directory-header');
  const back = header.getByRole('link', { name: 'Back to The Drop', exact: true });
  const brand = header.locator('.brand-mark');
  const menu = header.getByRole('button', { name: 'Open navigation', exact: true });
  const bell = header.getByRole('button', { name: 'Notifications', exact: true });
  const geometries = [];
  for (const width of [320, 350, 390, 430]) {
    await page.setViewportSize({ width, height: 664 });
    await expect(menu).toBeEnabled();
    for (const element of [back, brand, menu, bell]) await expect(element).toBeInViewport({ ratio: 1 });
    await expect(brand.getByRole('img', { name: 'BeCore Tickets', exact: true })).toBeVisible();
    await expect(brand.locator('.brand-logo__type')).toBeVisible();
    await expect(menu.locator('.night-mobile-menu__trigger-label')).toBeHidden();
    const boxes = await Promise.all([back, brand, menu, bell].map(element => element.boundingBox()));
    geometries.push({ width, back: boxes[0], brand: boxes[1], menu: boxes[2], bell: boxes[3] });
    for (const box of boxes) {
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index]!.x - boxes[index - 1]!.x - boxes[index - 1]!.width).toBeGreaterThanOrEqual(8);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await info.attach('member-header-geometry.json', { body: JSON.stringify(geometries, null, 2), contentType: 'application/json' });
  // Dense member headers do not remove the discoverable label elsewhere.
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/events');
  await expect(page.locator('.night-mobile-menu__trigger-label')).toBeVisible();
});

test('an open anchored menu keeps one-click notification switching and its short-screen close control reachable', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 760, 'Mobile menu interaction');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated panel interaction' } }));
  await page.route('**/api/customer/notifications', route => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/my-nights');
  const header = page.locator('.my-nights-page > .directory-header');
  const trigger = header.locator('.night-mobile-menu__trigger');
  const bell = header.getByRole('button', { name: 'Notifications', exact: true });
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const dialog = page.getByRole('dialog', { name: 'The Buzz', exact: true });
  const reachableAtCenter = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return hit === element || (hit !== null && element.contains(hit));
  };
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await trigger.click();
  await expect(trigger).toHaveAccessibleName('Close navigation');
  await expect(menu).toBeInViewport({ ratio: 1 });
  expect(await bell.evaluate(reachableAtCenter)).toBe(true);
  // No modal scrim competes with the header or destination controls.
  await expect(page.locator('.night-mobile-menu__scrim')).toHaveCount(0);
  await bell.click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close notifications', exact: true }).click();
  await trigger.click();
  await page.setViewportSize({ width: 390, height: 320 });
  await expect(menu).toBeInViewport({ ratio: 1 });
  const close = menu.getByRole('button', { name: 'Close navigation', exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });
  const triggerBounds = await trigger.boundingBox();
  const menuBounds = await menu.boundingBox();
  const capBounds = await menu.locator('.night-mobile-menu__panel-header').boundingBox();
  expect(triggerBounds).not.toBeNull();
  expect(menuBounds).not.toBeNull();
  expect(capBounds).not.toBeNull();
  expect(capBounds!.x).toBeCloseTo(triggerBounds!.x, 1);
  expect(capBounds!.y).toBeCloseTo(triggerBounds!.y, 1);
  expect(capBounds!.width).toBeCloseTo(triggerBounds!.width, 1);
  expect(capBounds!.height).toBeCloseTo(triggerBounds!.height, 1);
  expect(menuBounds!.x + menuBounds!.width).toBeCloseTo(triggerBounds!.x + triggerBounds!.width, 1);
  expect(menuBounds!.y).toBeCloseTo(triggerBounds!.y, 1);
  expect(await close.evaluate(reachableAtCenter)).toBe(true);
  await close.click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await expect(trigger).toBeFocused();
});


test('a fractionally clipped desktop trigger still opens inside the viewport and materially clipped anchors close', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 980, height: 844 });
  await page.goto('/events');
  const trigger = page.locator('.night-mobile-menu__trigger');
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await expect(trigger).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  const initialTop = await trigger.evaluate(element => element.getBoundingClientRect().top);
  // The isolated catalogue can be shorter than the live catalogue. Give only
  // the page surface scroll room; do not move or resize the header/menu itself.
  await page.locator('main.discovery-directory').evaluate(surface => {
    (surface as HTMLElement).style.minHeight = `${innerHeight + 80}px`;
  });
  expect(await trigger.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(initialTop, 5);
  // Scroll positions can be integral; derive a <=1px clip from the rendered
  // header instead of assuming every engine/font has the same header metrics.
  const clippedScroll = Math.floor(initialTop) + 1;
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThanOrEqual(clippedScroll + 2);
  await page.evaluate(y => window.scrollTo(0, y), clippedScroll);
  await expect.poll(() => trigger.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(0);
  expect(await trigger.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  // Locator clicks scroll partially clipped elements into view in WebKit.
  // Send a real pointer click at a verified visible point without that repair.
  const point = await trigger.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    return { x, y, left: Math.max(0, bounds.left), right: Math.min(innerWidth, bounds.right),
      top: Math.max(0, bounds.top), bottom: Math.min(innerHeight, bounds.bottom),
      receivesPointer: element.contains(document.elementFromPoint(x, y)) };
  });
  expect(point.x).toBeGreaterThan(point.left);
  expect(point.x).toBeLessThan(point.right);
  expect(point.y).toBeGreaterThan(point.top);
  expect(point.y).toBeLessThan(point.bottom);
  expect(point.receivesPointer).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect(menu).toBeVisible();
  // Prove Playwright did not make this pass by scrolling the trigger back in.
  expect(await page.evaluate(() => scrollY)).toBe(clippedScroll);
  expect(await trigger.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(0);
  expect(await trigger.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  const bounds = await menu.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844 - 8);
  await page.evaluate(y => window.scrollTo(0, y), clippedScroll + 2);
  await expect.poll(() => trigger.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(-1);
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
