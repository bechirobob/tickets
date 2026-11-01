import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'docs/boardui-trial/evidence';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BOARDUI_CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = { browser: browser.version(), scenarios: [], errors: [], securityViolations: [] };
try {
for (const [label, width, height] of [['desktop', 1440, 1050], ['mobile', 390, 844], ['narrow', 320, 740]]) {
 const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
 // This UI-only trial never accesses APIs or external hosts. Existing root-shell
 // optional room fetches receive an empty fixture; those endpoints are not tested.
 await context.route('**/*', route => {
   const url = new URL(route.request().url());
   if (url.origin !== 'http://127.0.0.1:8788') return route.abort();
   if (url.pathname.startsWith('/api/')) return route.fulfill({ status: url.pathname === '/api/admin/workspace' ? 401 : 200, json: { rooms: [] } });
   return route.continue();
 });
 const page = await context.newPage();
 await page.addInitScript(() => { window.trialSecurityViolations = []; document.addEventListener('securitypolicyviolation', e => window.trialSecurityViolations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI })); });
 page.on('pageerror', error => results.errors.push({ label, message: error.message }));
 await page.goto('http://127.0.0.1:8788/boardui-trial');
 await expect(page.getByRole('heading', { name: 'Guest list', exact: true })).toBeVisible();
 await expect(page.getByText('2,400 guests · 1–12')).toBeVisible();
 await page.getByLabel('Sort by', { exact: true }).selectOption('name');
 await expect(page.getByRole('row').nth(1)).toContainText('Abena Addo 0007');
 await page.getByLabel('Sort by', { exact: true }).selectOption('ticket');
 await page.getByLabel('Search guests').fill('guest2400@example.test');
 await expect(page.getByText('1 guest · 1–1')).toBeVisible();
 await expect(page.getByText('Kwame Arthur 2400', { exact: true })).toBeVisible();
 await page.getByLabel('Search guests').fill('not-found');
 await expect(page.getByText('No guests found. Try another name or clear your filters.')).toBeVisible();
 await page.getByRole('button', { name: 'Clear filters' }).click();
 await page.getByLabel('Arrival', { exact: true }).selectOption('arrived');
 await expect(page.getByText('800 guests · 1–12')).toBeVisible();
 await page.getByRole('button', { name: 'Next', exact: true }).click();
 await expect(page.getByText('800 guests · 13–24')).toBeVisible();
 const editOnPageTwo = page.getByRole('button', { name: /^Edit / }).first();
 await editOnPageTwo.click();
 await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
 await expect(page.getByText('800 guests · 13–24')).toBeVisible();
 await expect(editOnPageTwo).toBeFocused();
 await page.getByRole('button', { name: 'Clear filters' }).click();
 await page.getByRole('button', { name: 'Go to page 200', exact: true }).click();
 await expect(page.getByText('2,400 guests · 2389–2400')).toBeVisible();
 await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
 await page.getByLabel('Search guests').fill('Nana Adwoa');
 await expect(page.getByText('1 guest · 1–1')).toBeVisible();
 await page.getByRole('button', { name: 'Clear filters' }).click();
 await page.screenshot({ path: `${out}/${label}-list.png`, fullPage: true });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 const axe = await new AxeBuilder({ page }).include('.boardui-trial').analyze();
 results.scenarios.push({ label, stage: 'list accessibility', violations: axe.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })) });
 expect(axe.violations).toEqual([]);
 const add = page.getByRole('button', { name: 'Add guest', exact: true });
 await add.focus(); await page.keyboard.press('Enter');
 const dialog = page.getByRole('dialog');
 await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
 await expect(dialog.getByLabel('Name')).toBeFocused();
 await dialog.getByRole('button', { name: 'Add guest', exact: true }).click();
 await expect(page.getByText('Enter a name with at least 2 characters.')).toBeVisible();
 await expect(page.getByText('Enter a valid email address.')).toBeVisible();
 await expect(dialog.getByLabel('Name')).toBeFocused();
 await page.screenshot({ path: `${out}/${label}-validation.png`, fullPage: false });
 // Escape/cancel discards an unfinished edit and restores the trigger.
 await dialog.getByLabel('Name').fill('Discarded fictional name');
 await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(add).toBeFocused();
 await page.keyboard.press('Enter'); await expect(dialog.getByLabel('Name')).toHaveValue('');
 await dialog.getByLabel('Name').fill('Trial guest');
 await page.keyboard.press('Tab'); await expect(dialog.getByLabel('Email')).toBeFocused();
 await page.keyboard.type('trial@example.test');
 await page.keyboard.press('Tab'); await page.keyboard.press('Space');
 await expect(dialog.getByLabel('Checked in')).toBeChecked();
 await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
 await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Add guest', exact: true })).toBeFocused();
 await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 await page.keyboard.press('Enter');
 await expect(dialog).not.toBeVisible(); await expect(add).toBeFocused();
 await expect(page.getByText('2,401 guests · 1–12')).toBeVisible();
 await page.getByRole('button', { name: 'Edit Trial guest', exact: true }).click();
 await expect(dialog.getByLabel('Email')).toHaveValue('trial@example.test');
 await expect(dialog.getByLabel('Checked in')).toBeChecked();
 await dialog.getByLabel('Name').fill('Trial guest updated');
 await page.screenshot({ path: `${out}/${label}-dialog.png`, fullPage: false });
 expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
 const dialogAxe = await new AxeBuilder({ page }).include('.trial-dialog').analyze();
 expect(dialogAxe.violations).toEqual([]);
 // Two submit events in one task must apply only one mutation.
 await dialog.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
 await expect(page.getByText('Trial guest updated', { exact: true })).toBeVisible();
 await expect(page.getByText('2,401 guests · 1–12')).toBeVisible();
 for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Edit Trial guest updated', exact: true }).click(); await page.keyboard.press('Escape'); }
 await page.reload(); await expect(page.getByText('2,400 guests · 1–12')).toBeVisible();
 results.scenarios.push({ label, stage: 'interactions', passed: true, viewport: { width, height } });
 const violations = await page.evaluate(() => window.trialSecurityViolations);
 results.securityViolations.push({label, violations}); expect(violations).toEqual([]);
 await context.close();
}
expect(results.errors).toEqual([]);
} finally { await writeFile(`${out}/browser-results.json`, JSON.stringify(results, null, 2)); await browser.close(); }
console.log('Desktop, mobile and narrow Chromium UI checks passed. Mobile is viewport simulation, not iPhone/Safari.');
