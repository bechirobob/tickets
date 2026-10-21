/** A top panel shrinks into the visible viewport; it never shifts over the header. */
export function topPanelPosition(input: {
  viewport: { top: number; left: number; width: number; height: number };
  layoutWidth: number; headerBottom: number; anchorRight?: number; dockTop?: number;
  safe: { top: number; right: number; bottom: number; left: number };
}) {
  const { viewport: view, safe } = input;
  const top = Math.max(view.top + safe.top + 12, input.headerBottom + 8);
  const leftEdge = view.left + Math.max(12, safe.left);
  const rightEdge = view.left + view.width - Math.max(12, safe.right);
  const width = Math.max(0, Math.min(360, rightEdge - leftEdge));
  const desiredRight = input.anchorRight ?? rightEdge;
  const left = Math.max(leftEdge, Math.min(desiredRight - width, rightEdge - width));
  const bottom = Math.min(view.top + view.height - Math.max(12, safe.bottom), input.dockTop === undefined ? Infinity : input.dockTop - 8);
  return { top, right: Math.max(0, input.layoutWidth - left - width), width, maxHeight: Math.max(0, Math.min(460, bottom - top)) };
}
