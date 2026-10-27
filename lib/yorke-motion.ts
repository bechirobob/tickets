import { captureArrivalDocument, eligibleArrivalEntry, type ArrivalEntry } from './brand-arrival';

const played = new WeakSet<Document>();
const waiting = new WeakMap<Document, symbol>();
const WAIT_LIMIT = 2600; // Existing arrival: at most 500ms asset wait + 2000ms scene.

/** Progressive enhancement only: no hidden markup, focus changes or form gating. */
export function mountYorkeMotion(root: HTMLElement, entry: ArrivalEntry | null = captureArrivalDocument()): () => void {
  const animations: Animation[] = [];
  const removals: Array<() => void> = [];
  const owner = Symbol('yorke-motion');
  let frame = 0, deadline = 0, closed = false, started = false;
  const stop = (consumed = false) => {
    if (closed) return;
    closed = true;
    if (consumed || started) played.add(document);
    window.cancelAnimationFrame(frame);
    window.clearTimeout(deadline);
    for (const animation of animations) animation.cancel();
    for (const remove of removals.splice(0)) remove();
    if (waiting.get(document) === owner) waiting.delete(document);
  };
  const listen = (target: EventTarget, type: string, fn: EventListener, capture = false) => {
    target.addEventListener(type, fn, capture);
    removals.push(() => target.removeEventListener(type, fn, capture));
  };
  try {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!entry || window.location.href !== entry.href || performance.now() - entry.capturedAt > 500 || !eligibleArrivalEntry(entry) || played.has(document) || waiting.has(document) || motion.matches || document.hidden || window.scrollY > 0 || performance.getEntriesByType('first-input').length || typeof root.animate !== 'function') return () => {};
    const phrases = root.querySelectorAll<HTMLElement>('[data-yorke-phrase]');
    const description = root.querySelector<HTMLElement>('.yorke-description');
    const dot = root.querySelector<HTMLElement>('.yorke-eyebrow > span');
    if (phrases.length !== 4 || !description || !dot) return () => {};
    waiting.set(document, owner);
    const href = window.location.href;
    const cancel = () => stop(true);
    // Any intent to use the page immediately reveals the final, still content.
    for (const type of ['pointerdown', 'keydown', 'wheel', 'focusin']) listen(document, type, cancel, true);
    for (const type of ['scroll', 'pagehide', 'popstate', 'hashchange']) listen(window, type, cancel);
    listen(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
    listen(motion, 'change', () => { if (motion.matches) cancel(); });
    const add = (element: HTMLElement, frames: Keyframe[], delay: number, duration = 300, iterations = 1) => {
      // Running, not paused: even if JS stalls, the finite native animation
      // reaches readable content. On real intro completion we advance the hold.
      animations.push(element.animate(frames, { delay: WAIT_LIMIT + delay, duration, iterations, fill: 'backwards', easing: 'cubic-bezier(.2,.7,.2,1)' }));
    };
    phrases.forEach((phrase, index) => {
      const frames = index < 2
        ? [{ transform: 'translateY(105%)' }, { transform: 'translateY(0)' }]
        : index === 2
          ? [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'translateX(0)' }]
          : [{ opacity: 0, transform: 'scale(.94)', transformOrigin: 'left center' }, { opacity: 1, transform: 'scale(1)', transformOrigin: 'left center' }];
      add(phrase, frames, [150, 520, 1070, 1480][index]);
    });
    add(description, [{ opacity: 0 }, { opacity: 1 }], 1950, 500);
    add(dot, [{ opacity: 1 }, { opacity: .65 }, { opacity: 1 }], 0, 1600, 3);
    deadline = window.setTimeout(cancel, WAIT_LIMIT);
    const tick = () => {
      if (closed) return;
      if (document.hidden || motion.matches || window.location.href !== href) { cancel(); return; }
      if (entry.phase === 'done') {
        window.clearTimeout(deadline);
        started = true;
        played.add(document);
        // All effects share the same actual intro completion/skip, not an
        // assumed two-second timeout. No replay on rerenders or SPA returns.
        for (const animation of animations) animation.currentTime = WAIT_LIMIT;
        deadline = window.setTimeout(() => stop(), 4900);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
  } catch { stop(); }
  // StrictMode can safely retry a setup that has not reached the first frame.
  return () => stop();
}
