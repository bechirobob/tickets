import { test as base, expect } from "@playwright/test";
import type { PublicCatalogue } from "../../lib/public-event";

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
