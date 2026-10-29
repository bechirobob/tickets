/** Browser-document lifetime only. No storage, auth, network or native-app state. */
export type ArrivalEntry = {
  href: string;
  navigationHref: string;
  navigationType: string;
  referrer: string;
  discarded: boolean;
  prerendering: boolean;
  late?: boolean;
  interacted?: boolean;
  capturedAt: number;
  phase: "new" | "pending" | "shown" | "done";
  owner?: symbol;
};

const documents = new WeakMap<Document, ArrivalEntry>();
const criticalQuery = new Set([
  "welcome", "recovered", "recover", "transfer", "token", "claim", "reference", "trxref",
  "pending", "prompt", "code", "state", "error", "payment", "payment_intent", "redirect_status",
  "client_secret", "access_token", "refresh_token", "transaction_id", "register",
]);
const criticalPath = /^\/(?:payment|checkout|rsvp|tickets|scan|admin|staff|organizer|room|account|auth|api)(?:\/|$)|^\/my-nights\//;

function pageWasInteractedWith(): boolean {
  return performance.getEntriesByType("first-input").length > 0 || window.scrollY > 0;
}

function safeBrowsingUrl(value: string): boolean {
  const url = new URL(value);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const staffLaunch = url.searchParams.get("source") === "staff-pwa" &&
    /^\/(?:admin(?:\/(?:operations|events|registrations|promoters|orders|support|rooms|fees|yorkeway-audience|platform-audience|hosts|accounts|account|help))?|scan|organizer\/(?:workspace|analytics|assistant))$/.test(path);
  if (!(staffLaunch || /^\/(?:events|hosts|about|help|privacy|terms|my-nights|the-yorke-way|staff)?$/.test(path) || /^\/(?:event|hosts)\/[^/]+$/.test(path))) return false;
  if ([...url.searchParams.keys()].some(key => criticalQuery.has(key.toLowerCase()))) return false;
  if (/^(?:passes|purchase|ticket|qr)$/i.test(url.searchParams.get("view") ?? "")) return false;
  if (url.searchParams.get("kind") === "transfer") return false;
  if (/(?:^|[&#?])(?:token|claim|code|state|access_token|refresh_token|transfer)=/i.test(url.hash)) return false;
  return true;
}

export function eligibleArrivalEntry(entry: ArrivalEntry): boolean {
  try {
    if (!['navigate', 'reload'].includes(entry.navigationType) || entry.discarded || entry.prerendering || entry.late || entry.interacted) return false;
    if (!safeBrowsingUrl(entry.href) || !safeBrowsingUrl(entry.navigationHref)) return false;
    if (entry.referrer) {
      const from = new URL(entry.referrer), target = new URL(entry.href);
      if (from.origin === target.origin && (criticalPath.test(from.pathname) || !safeBrowsingUrl(from.href))) return false;
      if (/(?:^|\.)(?:paystack\.com|paystack\.co|stripe\.com|seevplus\.com|coinbase\.com|accounts\.google\.com)$/.test(from.hostname)) return false;
    }
    return true;
  } catch { return false; }
}

/** Capture before child effects can strip a recovery token or callback query. */
export function captureArrivalDocument(): ArrivalEntry | null {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const existing = documents.get(document);
  if (existing) return existing;
  try {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const entry: ArrivalEntry = {
      href: window.location.href,
      navigationHref: navigation?.name || window.location.href,
      navigationType: navigation?.type ?? "unknown",
      referrer: document.referrer,
      discarded: (document as Document & { wasDiscarded?: boolean }).wasDiscarded ?? false,
      prerendering: (document as Document & { prerendering?: boolean }).prerendering ?? false,
      // Do not cover a page that has already been usable while JS was delayed.
      late: performance.now() - (navigation?.startTime ?? 0) > 1500,
      interacted: pageWasInteractedWith(),
      capturedAt: performance.now(),
      phase: "new",
    };
    documents.set(document, entry);
    return entry;
  } catch { return null; }
}

/** Hiding the scene at pointerdown can retarget the same touch's click below it. */
function guardDismissalGesture(pointer: PointerEvent): () => void {
  const removals: Array<() => void> = [];
  const options = { capture: true, passive: false };
  let timer = 0;
  const release = () => {
    window.clearTimeout(timer);
    for (const remove of removals.splice(0)) remove();
  };
  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler, options);
    removals.push(() => target.removeEventListener(type, handler, options));
  };
  const matches = (event: Event) => {
    const id = (event as PointerEvent).pointerId;
    return typeof id !== "number" || id === pointer.pointerId;
  };
  const suppress = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const ended = () => {
    // Keep long presses protected until release, then allow the legacy touch
    // click delay. A fresh pointer/key action always releases this guard first.
    window.clearTimeout(timer);
    timer = window.setTimeout(release, 500);
  };
  listen(window, "pointerup", event => {
    if (matches(event)) { suppress(event); ended(); }
  });
  if (pointer.pointerType === "touch") {
    listen(window, "touchend", event => {
      if ((event as TouchEvent).touches?.length) return;
      suppress(event); ended();
    });
    listen(window, "touchcancel", event => { if (!(event as TouchEvent).touches?.length) release(); });
  }
  listen(window, "click", event => {
    if ((event as MouseEvent).detail === 0 || !matches(event)) return;
    suppress(event); release();
  });
  listen(window, "pointercancel", event => { if (matches(event)) release(); });
  listen(window, "pointerdown", release);
  listen(window, "keydown", release);
  listen(window, "pagehide", release);
  listen(document, "visibilitychange", () => { if (document.hidden) release(); });
  return release;
}

/** All exits synchronously hide the isolated decoration; page content is never touched. */
export function mountBrandArrival(root: HTMLElement, entry: ArrivalEntry | null): () => void {
  root.hidden = true;
  root.removeAttribute("data-running");
  if (!entry || entry.phase === "done" || entry.phase === "shown") return () => {};
  const owner = Symbol("brand-arrival");
  let closed = false, shown = false, frame = 0, timer = 0, started = 0;
  let releaseGesture = () => {};
  let image: HTMLImageElement | undefined;
  const removals: Array<() => void> = [];
  const close = (strictReplay = false) => {
    if (closed) return;
    closed = true;
    root.hidden = true;
    root.removeAttribute("data-running");
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    if (image) { image.onload = null; image.onerror = null; }
    for (const remove of removals.splice(0)) remove();
    if (entry.owner === owner) {
      // StrictMode's setup/cleanup/setup happens before the first RAF. Nothing
      // has been shown yet, so that one pending setup may safely be retried.
      entry.phase = strictReplay && !shown && window.location.href === entry.href ? "new" : "done";
      delete entry.owner;
    }
  };
  const listen = (target: EventTarget, type: string, handler: EventListener, capture = false) => {
    target.addEventListener(type, handler, capture);
    removals.push(() => target.removeEventListener(type, handler, capture));
  };
  try {
    entry.owner = owner;
    entry.phase = "pending";
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Hydration can follow module capture after the visitor has already acted.
    if (!eligibleArrivalEntry(entry) || pageWasInteractedWith() || document.hidden || motion.matches || window.location.href !== entry.href || performance.now() - entry.capturedAt > 500) {
      close(); return () => {};
    }
    // Missing/failed CSS cannot expose an unstyled full-screen element.
    if (window.getComputedStyle(root).getPropertyValue("--brand-arrival-ready").trim() !== "1") {
      close(); return () => {};
    }
    listen(document, "visibilitychange", () => { if (document.hidden) close(); });
    listen(window, "pagehide", () => close());
    listen(window, "pageshow", event => { if ((event as PageTransitionEvent).persisted) close(); });
    listen(window, "popstate", () => close());
    listen(window, "hashchange", () => close());
    listen(motion, "change", () => { if (motion.matches) close(); });
    listen(document, "keydown", () => close(), true);
    listen(document, "wheel", () => close(), true);
    listen(document, "pointerdown", event => {
      if (shown && root.contains(event.target as Node)) {
        // Dismiss only, never turn a tap on the obscuring scene into a click on
        // an unseen RSVP/payment/link beneath it.
        event.preventDefault(); event.stopPropagation();
        releaseGesture = guardDismissalGesture(event as PointerEvent);
      }
      close();
    }, true);
    listen(root, "click", event => { event.preventDefault(); event.stopPropagation(); close(); });
    let loaded = false;
    image = new Image();
    image.onload = () => { loaded = true; };
    image.onerror = () => close();
    image.src = "/brand/becore-ticket.webp";
    loaded = image.complete && image.naturalWidth > 0;
    timer = window.setTimeout(() => close(), 500);
    const tick = () => {
      if (closed || entry.owner !== owner) return;
      try {
        if (document.hidden || motion.matches || window.location.href !== entry.href) { close(); return; }
        const now = performance.now();
        if (!shown && (pageWasInteractedWith() || now - entry.capturedAt > 500)) { close(); return; }
        if (!shown && loaded) {
          window.clearTimeout(timer);
          // Install the independent deadline before exposing anything.
          timer = window.setTimeout(() => close(), 2000);
          root.style.setProperty("--brand-arrival-exit-scale", String(Math.max(window.innerWidth / 35, window.innerHeight / 47.5) * 4));
          started = now; shown = true; entry.phase = "shown";
          root.setAttribute("data-running", "");
          root.hidden = false;
        }
        if (shown && now - started >= 2000) { close(); return; }
        frame = window.requestAnimationFrame(tick);
      } catch { close(); }
    };
    frame = window.requestAnimationFrame(tick);
  } catch { close(); }
  return () => { releaseGesture(); close(true); };
}
