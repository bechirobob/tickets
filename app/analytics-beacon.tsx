"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackProductMetric } from "../lib/client-analytics";

export default function AnalyticsBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const match = pathname.match(/^\/(event|checkout)\/([a-z0-9-]+)$/u);
    if (!match) return;
    const metric = match[1] === "event" ? "event_view" : "checkout_view";
    const key = `bct:metric:${metric}:${match[2]}:${new Date().toISOString().slice(0, 10)}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    trackProductMetric(metric, match[2]);
  }, [pathname]);

  return null;
}
