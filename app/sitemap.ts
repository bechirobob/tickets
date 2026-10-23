import type { MetadataRoute } from "next";
import { getPublicEvents } from "./events";
import { isWebsiteListedEvent } from "../lib/website-event-listings";

const origin = "https://tickets.becoreops.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = (await getPublicEvents()).filter(isWebsiteListedEvent);
  const staticRoutes = ["", "/events", "/hosts", "/about", "/help", "/privacy", "/terms", "/organizer/submit"];
  return [
    ...staticRoutes.map((path, index) => ({
      url: `${origin}${path}`,
      changeFrequency: index < 2 ? "daily" as const : "monthly" as const,
      priority: index === 0 ? 1 : index === 1 ? .9 : .6,
    })),
    ...events.filter((event) => !event.isTestEvent).map((event) => ({
      url: `${origin}/event/${event.slug}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: .8,
    })),
  ];
}
