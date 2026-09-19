"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackProductMetric } from "../lib/client-analytics";
const seen = new Set<string>();

export default function AnalyticsBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const match = pathname.match(/^\/(event|checkout|rsvp)\/([a-z0-9-]+)$/u);
    if (!match) return;
    const metric = match[1] === "event" ? "event_view" : match[1] === "rsvp" ? "rsvp_view" : "checkout_view";
    const key = `bct:metric:${metric}:${match[2]}:${new Date().toISOString().slice(0, 10)}`;
    if (seen.has(key)) return;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch { /* A blocked storage policy must not break the guest page. */ }
    seen.add(key);
    trackProductMetric(metric, match[2]);
  }, [pathname]);

  return null;
}
