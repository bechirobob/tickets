/** Keep geometry fresh after iOS suspends the installed app. Never reload a route. */
export function mountMobileViewport(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let baseline = window.innerHeight;
  let frame = 0;
  const update = () => {
    // WebKit can report zero/transient geometry while its window is suspended.
    // Preserve the last useful size until the next foreground measurement.
    if (document.hidden || (viewport && viewport.scale !== 1)) return;
    const height = viewport?.height ?? window.innerHeight;
    const offset = viewport?.offsetTop ?? 0;
    if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(offset)) return;
    const editing = document.activeElement instanceof HTMLElement && document.activeElement.matches("input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]");
    if (!editing) baseline = Math.max(window.innerHeight, height);
    const keyboard = Math.max(0, (editing ? Math.max(baseline, window.innerHeight) : window.innerHeight) - height - offset);
    root.style.setProperty("--app-viewport-height", `${height}px`);
    root.style.setProperty("--app-keyboard-inset", `${keyboard}px`);
    root.dataset.keyboard = keyboard > 120 ? "open" : "closed";
  };
  const resume = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    if (document.hidden) return;
    update();
    // pageshow/visibilitychange can precede WebKit's restored viewport layout.
    frame = window.requestAnimationFrame(() => { frame = 0; update(); });
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", update);
  return () => {
    window.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("pageshow", resume);
    document.removeEventListener("visibilitychange", resume);
    document.removeEventListener("focusin", update);
    document.removeEventListener("focusout", update);
    root.style.removeProperty("--app-viewport-height");
    root.style.removeProperty("--app-keyboard-inset");
    delete root.dataset.keyboard;
  };
}
