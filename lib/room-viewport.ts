/** Room height is independent of the public shell's viewport CSS variable. */
export function mountRoomViewport(onHeight: (height: number) => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  const update = () => {
    if (document.hidden || viewport.scale !== 1 || !Number.isFinite(viewport.height) || viewport.height <= 0) return;
    onHeight(viewport.height);
  };
  const resume = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    if (document.hidden) return;
    update();
    // iOS may restore the viewport after delivering its foreground event.
    frame = window.requestAnimationFrame(() => { frame = 0; update(); });
  };
  update();
  viewport.addEventListener("resize", update);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    window.cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", update);
    window.removeEventListener("pageshow", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
