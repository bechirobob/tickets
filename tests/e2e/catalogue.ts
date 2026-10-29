import { test as base, expect } from "./analytics-fixture";
import type { PublicCatalogue } from "../../lib/public-event";
import type { Page } from '@playwright/test';
import { isWebsiteListedEvent } from '../../lib/website-event-listings';
import { matchesEventWindow } from '../../lib/event-discovery';

export function nextWebsiteEvents(catalogue: PublicCatalogue, now = Date.now()) {
  return catalogue.screens!.map(({ event }) => event).filter(event => isWebsiteListedEvent(event) && matchesEventWindow(event, 'next', now));
}

/** Publication permits direct access; website discovery has its own visibility policy. */
export async function expectWebsiteDiscovery(page: Page, catalogue: PublicCatalogue) {
  if (catalogue.events.some(isWebsiteListedEvent)) {
    await expect(page.getByRole('button', { name: 'Next up', exact: true })).toBeEnabled();
    return true;
  }
  await expect(page.locator('.event-empty')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The next plan is still cooking.', exact: true })).toBeVisible();
  await expect(page.locator('.event-empty').getByRole('link', { name: 'Submit an event' })).toHaveAttribute('href', '/organizer/submit');
  await expect(page.locator('.drop-card, .discovery-explorer')).toHaveCount(0);
  await expect(page.getByLabel('Pick a date')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Search events, artists or venues' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  return false;
}

/** Resolve server-rendered routes before installing private API mocks. */
export const test = base.extend<{ catalogue: PublicCatalogue; eventSlug: string }>({
  catalogue: async ({ request }, provide) => {
    const response = await request.get("/api/public/events");
    expect(response.ok(), "The published catalogue must be available").toBe(true);
    const catalogue = await response.json() as PublicCatalogue;
    expect(catalogue.version).toBe(1);
    expect(catalogue.events.length, "This launch audit requires a published event").toBeGreaterThan(0);
    await provide(catalogue);
  },
  eventSlug: async ({ catalogue }, provide) => {
    await provide(catalogue.events[0].slug);
  },
});
export { expect };
