import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Buffer as NodeBuffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import { previewData, renderCustomerEmailPreviews, renderFirstHostEmailPreview, renderHostPassEmailPreview } from '../../scripts/customer-email-previews.mjs';
import { expectVisibleLettering } from '../e2e/text-visibility';

const names = ['purchase-confirmation', 'rsvp-confirmed', 'email-verification', 'ticket-recovery', 'ticket-transfer', 'waitlist-offer', 'abandoned-checkout', 'support-update', 'purchase-announcement-verification', 'rsvp-announcement-verification', 'first-host-post', 'host-pass-invitation'];
let previews: Awaited<ReturnType<typeof renderCustomerEmailPreviews>>;

test.beforeAll(async () => { previews = [...await renderCustomerEmailPreviews(), renderFirstHostEmailPreview(), renderHostPassEmailPreview()]; });

async function expectReadableEmail(page: Page) {
  await expectVisibleLettering(page, 'body');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const lowContrast = await page.evaluate(() => {
    const issues: string[] = [];
    const rgb = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element || element.closest('script,style')) continue;
      let background = [255, 255, 255], visible = true, foundBackground = false;
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') visible = false;
        const color = rgb(style.backgroundColor);
        if (!foundBackground && color.length >= 3 && (color.length < 4 || color[3] === 1)) { background = color; foundBackground = true; }
      }
      if (!visible) continue;
      const foreground = luminance(rgb(getComputedStyle(element).color));
      const behind = luminance(background);
      const contrast = (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
      if (contrast < 4.5) issues.push(`${contrast.toFixed(2)}: ${text.slice(0, 100)}`);
    }
    return issues;
  });
  expect(lowContrast, 'All visible customer email text should meet normal-text AA contrast.').toEqual([]);
}

for (const name of names) {
  test(`customer email ${name} is readable in light and dark hosts`, async ({ page }, info) => {
    const preview = previews.find(item => item.name === name)!;
    const unexpectedRequests: string[] = [];
    const logo = await readFile(new URL('../../public/brand/becore-ticket.png', import.meta.url));
    const flyer = await readFile(new URL('../../public/events/on-the-guest-list-email.jpg', import.meta.url));
    // Keep the exact production HTML. Fulfil its existing hosted images locally;
    // every other request is blocked, including any accidental provider call.
    await page.route('**/*', route => {
      if (route.request().url() === 'https://tickets.becoreops.com/brand/becore-ticket.png?v=5') return route.fulfill({ body: logo, contentType: 'image/png' });
      if (route.request().url() === 'https://tickets.becoreops.com/events/on-the-guest-list-email.jpg') return route.fulfill({ body: flyer, contentType: 'image/jpeg' });
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    let lightDigest: string | undefined;
    let darkDigest: string | undefined;
    const captures: { name: string; png: Uint8Array }[] = [];
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setContent(preview.html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (['purchase-confirmation', 'rsvp-confirmed', 'purchase-announcement-verification'].includes(name)) {
        await expect(page.getByText('Kofi Bills is your host.', { exact: false })).toBeVisible();
      } else {
        await expect(page.locator('body')).not.toContainText('Kofi Bills is your host.');
      }
      const disclosure = page.getByText('Confirming this link also confirms the BeCore Tickets email updates you chose. You can unsubscribe at any time.', { exact: true });
      if (name === 'purchase-announcement-verification') {
        await expect(disclosure).toBeVisible();
        expect(await disclosure.evaluate(element => element.closest('td')?.getAttribute('bgcolor'))).toBe('#f8f4ec');
      } else {
        await expect(disclosure).toHaveCount(0);
      }
      if (name === 'rsvp-announcement-verification') {
        const optional = page.getByText('Your RSVP is already saved. Confirm the BeCore Tickets email updates you chose. Email updates are optional and aren’t needed for your RSVP.', { exact: false });
        await expect(optional).toBeVisible();
        expect(await optional.evaluate(element => element.closest('td')?.getAttribute('bgcolor'))).toBe('#f8f4ec');
        await expect(page.locator('body')).not.toContainText('A place is only reserved');
        await expect(page.locator('body')).not.toContainText('continue your registration');
        await expect(page.getByText('You can unsubscribe at any time.', { exact: false })).toBeVisible();
      }
      const action = page.getByRole('link', { name: preview.actionLabel, exact: true });
      await expect(action).toBeVisible();
      if (name === 'first-host-post') {
        await expect(action).toHaveAttribute('href', 'https://tickets.becoreops.com/room/accra-after-hours?from=host-first-post&message=preview-host-post-001');
        await expect(page.getByRole('link', { name: 'Manage this event’s notifications' })).toHaveAttribute('href', 'https://tickets.becoreops.com/room/accra-after-hours?notifications=settings');
      } else if (name === 'host-pass-invitation') {
        await expect(action).toHaveAttribute('href', 'https://tickets.becoreops.com/my-nights/access?kind=host#token=SAMPLE-NOT-ACTIVE');
        await expect(page.locator('body')).toContainText('Kofi Bills · Host');
        await expect(page.locator('body')).toContainText('PURO EXCESO');
      } else await expect(action).toHaveAttribute('href', /^https:\/\/tickets\.example\.invalid\//);
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
      const artwork = page.locator('img[src="https://tickets.becoreops.com/events/on-the-guest-list-email.jpg"]');
      if (await artwork.count()) {
        await expect(artwork).toHaveAttribute('alt', new RegExp(previewData.event.title));
        const geometry = await artwork.evaluate(image => {
          const img = image as HTMLImageElement;
          const rect = img.getBoundingClientRect();
          return { width: rect.width, height: rect.height, ratio: rect.width / rect.height, naturalRatio: img.naturalWidth / img.naturalHeight, fit: getComputedStyle(img).objectFit };
        });
        expect(geometry.width).toBeLessThanOrEqual(240);
        expect(geometry.height).toBeLessThanOrEqual(380);
        expect(Math.abs(geometry.ratio - geometry.naturalRatio), 'Show the complete flyer at its original aspect ratio.').toBeLessThan(0.01);
        expect(geometry.fit).not.toBe('cover');
      }
      await expectReadableEmail(page);
      const pixels = await page.screenshot({ fullPage: true, path: info.outputPath(`${name}-${colorScheme}-original.png`) });
      captures.push({ name: `${colorScheme}-original`, png: NodeBuffer.from(pixels) });
      const digest = createHash('sha256').update(pixels).digest('hex');
      if (colorScheme === 'light') lightDigest = digest;
      else darkDigest = digest;
    }
    // Diagnostic only: preserve both original captures and the original assertion.
    // A separate settled pass distinguishes image decoding/paint from host colors.
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setContent(preview.html, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images, image => image.decode()));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      const pixels = await page.screenshot({ fullPage: true, path: info.outputPath(`${name}-${colorScheme}-settled.png`) });
      captures.push({ name: `${colorScheme}-settled`, png: NodeBuffer.from(pixels) });
      console.log('EMAIL_RENDER_DIAGNOSTIC', JSON.stringify({ name, colorScheme, phase: 'settled', sha256: createHash('sha256').update(pixels).digest('hex'), state: await page.evaluate(() => ({ fonts: document.fonts.status, images: Array.from(document.images, image => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })), animations: document.getAnimations().length })) }));
    }
    console.log('EMAIL_RENDER_DIAGNOSTIC', JSON.stringify({ name, phase: 'original', lightDigest, darkDigest }));
    // Synthetic-only evidence, following the existing bounded scanner-log transport.
    if (name !== 'purchase-confirmation' || info.project.name !== 'mobile-webkit'
      || previewData.order.customerEmail !== 'guest@example.invalid'
      || page.url() !== 'about:blank' || unexpectedRequests.length) throw new Error('Unexpected diagnostic fixture');
    const source = process.env.GITHUB_SHA;
    if (!process.env.CI || !source || !/^[a-f0-9]{40}$/u.test(source)
      || process.env.GITHUB_REF !== 'refs/heads/diag/email-webkit-render-20261031') throw new Error('Diagnostic branch identity required');
    let totalBytes = 0;
    for (const capture of captures) {
      const png = NodeBuffer.from(capture.png);
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      totalBytes += png.length;
      if (!png.subarray(0, 8).equals(NodeBuffer.from([137,80,78,71,13,10,26,10]))
        || png.length > 2 * 1024 * 1024 || totalBytes > 8 * 1024 * 1024
        || width > 1600 || height > 6000 || width * height > 6_000_000) throw new Error('Diagnostic PNG bounds exceeded');
      const identity = { source, project: info.project.name, fixture: 'customer-email-synthetic-v1', name: capture.name, sha256: createHash('sha256').update(png).digest('hex') };
      const emit = (record: object) => console.log(`BECORE_EMAIL_DIAGNOSTIC_V1 ${JSON.stringify({ ...identity, ...record })}`);
      const chunks = Math.ceil(png.length / 3072);
      emit({ type: 'begin', bytes: png.length, chunks, width, height });
      for (let index = 0; index < chunks; index++) emit({ type: 'chunk', index, data: png.subarray(index * 3072, (index + 1) * 3072).toString('base64') });
      emit({ type: 'end', bytes: png.length, chunks });
    }
    const decoded = await Promise.all(captures.map(capture => sharp(NodeBuffer.from(capture.png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    for (const [left, right] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      const a = decoded[left], b = decoded[right];
      const sameDimensions = a.info.width === b.info.width && a.info.height === b.info.height && a.info.channels === b.info.channels;
      let changedPixels = 0, maxDelta = 0;
      const bounds = { left: a.info.width, top: a.info.height, right: -1, bottom: -1 };
      if (sameDimensions) for (let pixel = 0; pixel < a.info.width * a.info.height; pixel++) {
        let changed = false;
        for (let channel = 0; channel < a.info.channels; channel++) {
          const offset = pixel * a.info.channels + channel;
          const delta = Math.abs(a.data[offset] - b.data[offset]);
          changed ||= delta !== 0;
          maxDelta = Math.max(maxDelta, delta);
        }
        if (changed) {
          changedPixels++;
          const x = pixel % a.info.width, y = Math.floor(pixel / a.info.width);
          bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
        }
      }
      console.log('EMAIL_PIXEL_COMPARISON', JSON.stringify({ source, left: captures[left].name, right: captures[right].name, sameDimensions, changedPixels: sameDimensions ? changedPixels : null, maxDelta, bounds: changedPixels ? bounds : null }));
    }
    expect(darkDigest, 'The complete email must preserve its explicit colors in a dark host.').toBe(lightDigest);
    expect(unexpectedRequests).toEqual([]);
    await writeFile(info.outputPath(`${name}.html`), preview.html);
  });
}

test('long customer and event fields wrap without hiding the primary action', async ({ page }) => {
  const longValue = `AccraAfterHours${'VeryLongUnbrokenReference'.repeat(8)}`;
  const [preview] = await renderCustomerEmailPreviews({ event: { title: longValue, venue: longValue, imageUrl: null }, order: { customerName: longValue, reference: longValue } });
  await page.route('**/*', route => route.abort());
  await page.setContent(preview.html);
  await expectReadableEmail(page);
  await expect(page.getByRole('link', { name: 'Open My Nights', exact: true })).toBeVisible();
});

for (const [name, event] of [['missing', { imageUrl: null }], ['private', { publicArtwork: 0 }], ['unsupported', { imageUrl: '/events/unknown.webp' }]] as const) {
  test(`${name} flyer still leaves a complete readable customer email`, async ({ page }) => {
    const [preview] = await renderCustomerEmailPreviews({ event });
    await page.route('**/*', route => route.abort());
    await page.setContent(preview.html);
    await expect(page.locator('img:not([src*="/brand/"])')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: previewData.event.title })).toBeVisible();
    if (name === 'private') await expect(page.locator('body')).not.toContainText('Kofi Bills is your host.');
    await expect(page.getByRole('link', { name: 'Open My Nights', exact: true })).toBeVisible();
    await expectReadableEmail(page);
  });
}
