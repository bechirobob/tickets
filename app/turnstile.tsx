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
  const [attempt, setAttempt] = useState(0);
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;

    onToken("");

    function fail(messageText: string) {
      if (cancelled || failed) return;
      failed = true;
      if (interval) clearInterval(interval);
      setMessage(messageText);
      setCanRetry(true);
    }

    function renderWidget(siteKey: string) {
      if (cancelled || failed || !container.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        theme: "dark",
        size: "flexible",
        retry: "auto",
        "retry-interval": 5000,
        "refresh-expired": "auto",
        "refresh-timeout": "auto",
        callback: (token: string) => {
          if (cancelled || failed) return;
          if (loadTimeout) {
            clearTimeout(loadTimeout);
            loadTimeout = null;
          }
          onToken(token);
          setCanRetry(false);
          setMessage("");
        },
        "expired-callback": () => { onToken(""); setMessage("Security check refreshed. One quick moment."); },
        "timeout-callback": () => { onToken(""); setMessage("Security check timed out and is trying again…"); },
        "unsupported-callback": () => fail("This browser could not run the security check."),
        "error-callback": () => fail("Security check lost the signal."),
      });
    }

    async function setup() {
      const response = await fetch("/api/config/security", { cache: "force-cache" });
      if (!response.ok) throw new Error("Security configuration unavailable");
      const config = await response.json() as { enabled?: boolean; siteKey?: string | null };
      if (cancelled) return;
      if (!config.enabled || !config.siteKey) {
        onToken("development-bypass");
        setMessage("");
        return;
      }

      const scriptId = "bct-turnstile-script";
      const existingScript = document.getElementById(scriptId);
      if (attempt > 0 && existingScript && !window.turnstile) existingScript.remove();
      if (!document.getElementById(scriptId)) {
        const script = document.createElement("script");
        script.id = scriptId;
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.addEventListener("error", () => fail("Security check could not reach Cloudflare."), { once: true });
        document.head.appendChild(script);
      }

      loadTimeout = setTimeout(() => fail("Security check is taking too long."), 12_000);
      interval = setInterval(() => {
        renderWidget(config.siteKey as string);
      }, 100);
      renderWidget(config.siteKey);
    }

    void setup().catch(() => fail("Security check could not load."));
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (loadTimeout) clearTimeout(loadTimeout);
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action, attempt, onToken]);

  function retry() {
    setCanRetry(false);
    setMessage("Checking browser security again…");
    setAttempt((value) => value + 1);
  }

  return <div className="turnstile-control"><div ref={container} />{message ? <small>{message}</small> : null}{canRetry ? <button type="button" onClick={retry}>Try the security check again</button> : null}</div>;
}
