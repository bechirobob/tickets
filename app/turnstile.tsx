"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

export default function Turnstile({ action, onToken }: { action: string; onToken(token: string): void }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [message, setMessage] = useState("Checking browser security…");

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function setup() {
      const response = await fetch("/api/config/security", { cache: "force-cache" });
      const config = await response.json() as { enabled?: boolean; siteKey?: string | null };
      if (cancelled) return;
      if (!config.enabled || !config.siteKey) {
        onToken("development-bypass");
        setMessage("");
        return;
      }

      const scriptId = "bct-turnstile-script";
      if (!document.getElementById(scriptId)) {
        const script = document.createElement("script");
        script.id = scriptId;
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }

      interval = setInterval(() => {
        if (cancelled || !container.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: config.siteKey,
          action,
          theme: "dark",
          size: "flexible",
          callback: (token: string) => { onToken(token); setMessage(""); },
          "expired-callback": () => { onToken(""); setMessage("Security check expired. Please retry it."); },
          "error-callback": () => { onToken(""); setMessage("Security check could not load. Please retry."); },
        });
      }, 100);
    }

    void setup().catch(() => setMessage("Security check could not load. Please retry."));
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
  }, [action, onToken]);

  return <div className="turnstile-control"><div ref={container} />{message ? <small>{message}</small> : null}</div>;
}
