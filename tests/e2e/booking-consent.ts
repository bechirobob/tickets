import { expect, type Page } from '@playwright/test';
import { expectVisibleLettering } from './text-visibility';

/** Capture the real compact group after scrolling, without changing fixed UI. */
export async function captureConsentPreview(page: Page, selector: string, path: string) {
  const group = page.locator(selector);
  await group.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await expect(group).toBeInViewport({ ratio: 1 });
  const visibility = await group.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const dock = document.querySelector('.customer-dock')?.getBoundingClientRect();
    const overlapsDock = !!dock?.width && !!dock.height && bounds.left < dock.right && bounds.right > dock.left && bounds.top < dock.bottom && bounds.bottom > dock.top;
    const covered = Array.from(element.querySelectorAll('label, input[type="checkbox"], button')).filter(control => {
      const rect = control.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !hit || !control.contains(hit);
    }).map(control => control.textContent?.trim() || control.getAttribute('name') || control.tagName);
    return { overlapsDock, covered };
  });
  expect(visibility, 'Consent and submit controls must be above the real dock and receive pointer input.').toEqual({ overlapsDock: false, covered: [] });
  await expectVisibleLettering(page, selector);
  await group.screenshot({ path });
}
