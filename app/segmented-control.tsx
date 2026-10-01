"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLElement> & { as?: "div" | "nav" };

/** Presentation only: the caller keeps its selection, semantics and navigation. */
export default function SegmentedControl({ as: Element = "div", className = "", children, ...props }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const update = () => {
      const selected = Array.from(node.children).find(child => child.matches('button[aria-pressed="true"], button[aria-selected="true"], button[aria-current]:not([aria-current="false"]), a[aria-current]:not([aria-current="false"])')) as HTMLElement | undefined;
      if (!selected || !selected.offsetWidth || !selected.offsetHeight) {
        delete node.dataset.measured;
        return;
      }
      node.style.setProperty("--segment-x", `${selected.offsetLeft}px`);
      node.style.setProperty("--segment-y", `${selected.offsetTop}px`);
      node.style.setProperty("--segment-width", `${selected.offsetWidth}px`);
      node.style.setProperty("--segment-height", `${selected.offsetHeight}px`);
      node.dataset.measured = "true";
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(node);
    for (const child of node.children) if (child instanceof HTMLElement && child.tagName !== "SPAN") resize.observe(child);
    const mutations = new MutationObserver(update);
    mutations.observe(node, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "aria-selected", "aria-current"], childList: true });
    return () => { resize.disconnect(); mutations.disconnect(); };
  }, [children]);
  return <Element {...props} ref={root} className={`segmented-control ${className}`}><span className="segmented-control__selection" aria-hidden="true" />{children}</Element>;
}
