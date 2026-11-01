import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const out = 'docs/boardui-trial/evidence';
const browser = await chromium.launch({ executablePath: process.env.BOARDUI_CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = {
  browser: browser.version(),
  testedApplication: '0415bd0affafa5fce6729647dd07743547cccb2c',
  limitations: 'Chromium mouse and emulated touch only. Text entry uses fill; select values use selectOption. No OS virtual keyboard, real device or Safari testing.',
  scenarios: [], errors: [],
};
try {
  for (const [label, width, height, touch] of [['desktop-mouse', 1440, 1050, false], ['mobile-touch', 390, 844, true], ['narrow-touch', 320, 740, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:8788') return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: url.pathname === '/api/admin/workspace' ? 401 : 200, json: { rooms: [] } });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => results.errors.push({ label, message: error.message }));
    await page.addInitScript(() => {
      window.trialPointerTypes = [];
      window.trialSecurityViolations = [];
      document.addEventListener('pointerdown', event => window.trialPointerTypes.push(event.pointerType));
      document.addEventListener('securitypolicyviolation', event => window.trialSecurityViolations.push(event.violatedDirective));
    });
    const activate = locator => touch ? locator.tap() : locator.click();
    await page.goto('http://127.0.0.1:8788/boardui-trial');
    const dialog = page.getByRole('dialog');
    const add = page.getByRole('button', { name: 'Add guest', exact: true });
    const search = page.getByLabel('Search guests');
    await activate(search);
    await search.fill('example.test');
    await page.getByLabel('Arrival', { exact: true }).selectOption('arrived');
    await page.getByLabel('Sort by', { exact: true }).selectOption('name');
    await activate(page.getByRole('button', { name: 'Next', exact: true }));
    const summary = page.getByText('800 guests · 13–24');
    await expect(summary).toBeVisible();
    const listSnapshot = await page.getByRole('row').allTextContents();
    const trigger = page.getByRole('button', { name: /^Edit / }).first();
    async function expectListUnchanged() {
      await expect(dialog).not.toBeVisible();
      await expect(summary).toBeVisible();
      await expect(search).toHaveValue('example.test');
      await expect(page.getByLabel('Arrival', { exact: true })).toHaveValue('arrived');
      await expect(page.getByLabel('Sort by', { exact: true })).toHaveValue('name');
      expect(await page.getByRole('row').allTextContents()).toEqual(listSnapshot);
    }
    // Both explicit dismissal controls discard every editable field, repeatedly.
    for (const dismissal of ['Cancel', 'Close']) {
      for (let iteration = 1; iteration <= 3; iteration++) {
        await activate(trigger);
        const original = { name: await dialog.getByLabel('Name').inputValue(), email: await dialog.getByLabel('Email').inputValue() };
        await dialog.getByLabel('Name').fill(`Unsaved ${dismissal} ${iteration}`);
        await dialog.getByLabel('Email').fill('unsaved@example.test');
        await activate(dialog.getByLabel('Checked in'));
        await expect(dialog.getByLabel('Checked in')).not.toBeChecked();
        await activate(dialog.getByRole('button', { name: dismissal, exact: true }));
        await expectListUnchanged();
        await expect(trigger).toBeFocused();
        await activate(trigger);
        await expect(dialog.getByLabel('Name')).toHaveValue(original.name);
        await expect(dialog.getByLabel('Email')).toHaveValue(original.email);
        await expect(dialog.getByLabel('Checked in')).toBeChecked();
        await activate(dialog.getByRole('button', { name: dismissal, exact: true }));
        await expectListUnchanged();
        await expect(trigger).toBeFocused();
      }
      results.scenarios.push({ label, flow: `${dismissal}: dirty edit discarded, all fields restored, filter/sort/query/page/rows unchanged, trigger focused; 3 repeated cycles`, passed: true });
    }
    // Native dialog has no light-dismiss handler: backdrop must preserve the draft.
    await activate(trigger);
    await dialog.getByLabel('Name').fill('Keep this unfinished draft');
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThan(4);
    if (touch) await page.touchscreen.tap(4, 4); else await page.mouse.click(4, 4);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('Keep this unfinished draft');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `${out}/${label}-dismissal.png` });
    await activate(dialog.getByRole('button', { name: 'Cancel', exact: true }));
    await expectListUnchanged();
    await expect(trigger).toBeFocused();
    results.scenarios.push({ label, flow: 'Backdrop interaction does not dismiss (unsupported by this dialog); unsaved draft retained, then Cancel discards and restores list/focus', passed: true });
    // New-record dismissal also leaves list state and data unchanged.
    for (const dismissal of ['Cancel', 'Close']) {
      await activate(add);
      await dialog.getByLabel('Name').fill('Uncreated guest');
      await dialog.getByLabel('Email').fill('uncreated@example.test');
      await activate(dialog.getByRole('button', { name: dismissal, exact: true }));
      await expectListUnchanged();
      await expect(add).toBeFocused();
      await activate(add);
      await expect(dialog.getByLabel('Name')).toHaveValue('');
      await expect(dialog.getByLabel('Email')).toHaveValue('');
      await expect(dialog.getByLabel('Checked in')).not.toBeChecked();
      await activate(dialog.getByRole('button', { name: dismissal, exact: true }));
      await expectListUnchanged();
      results.scenarios.push({ label, flow: `New guest ${dismissal}: no record created, empty on reopen, list state and trigger focus restored`, passed: true });
    }
    // Pointer-driven create/edit/save confirms simulated touch reaches real controls.
    await activate(add);
    await dialog.getByLabel('Name').fill('Pointer trial guest');
    await dialog.getByLabel('Email').fill('pointer@example.test');
    await activate(dialog.getByLabel('Checked in'));
    await activate(dialog.getByRole('button', { name: 'Add guest', exact: true }));
    await expect(page.getByText('2,401 guests · 1–12')).toBeVisible();
    await expect(add).toBeFocused();
    await activate(page.getByRole('button', { name: 'Edit Pointer trial guest', exact: true }));
    await expect(dialog.getByLabel('Checked in')).toBeChecked();
    await dialog.getByLabel('Name').fill('Pointer trial saved');
    await activate(dialog.getByRole('button', { name: 'Save changes', exact: true }));
    await expect(page.getByRole('button', { name: 'Edit Pointer trial saved', exact: true })).toBeFocused();
    await activate(page.getByRole('button', { name: 'Next', exact: true }));
    await expect(page.getByText('2,401 guests · 13–24')).toBeVisible();
    await activate(page.getByRole('button', { name: 'Previous', exact: true }));
    await expect(page.getByText('Pointer trial saved', { exact: true })).toBeVisible();
    const pointerTypes = [...new Set(await page.evaluate(() => window.trialPointerTypes))];
    expect(pointerTypes).toEqual([touch ? 'touch' : 'mouse']);
    expect(await page.evaluate(() => window.trialSecurityViolations)).toEqual([]);
    results.scenarios.push({ label, flow: 'Pointer create, checkbox, edit/save and next/previous navigation', passed: true, viewport: { width, height }, pointerTypes });
    await context.close();
  }
  expect(results.errors).toEqual([]);
} finally {
  await writeFile(`${out}/dismissal-touch-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log('Cancel, Close, non-dismissing backdrop and repeated cycles passed in desktop mouse and 390px/320px Chromium touch emulation. No real-device/virtual-keyboard/Safari claim.');
