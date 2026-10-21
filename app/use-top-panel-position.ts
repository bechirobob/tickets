"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { topPanelPosition } from '../lib/top-panel-position';

const pageHeaders = 'header:has(.night-mobile-menu), .night-header, .sub-header, .directory-header, .night-hub__header, .room-header, .wallet-page > header';

export function useTopPanelPosition(mounted: boolean, anchor: RefObject<HTMLButtonElement | null>, onNoSpace: () => void) {
  const dismiss = useRef(onNoSpace);
  useLayoutEffect(() => { dismiss.current = onNoSpace; }, [onNoSpace]);
  const [position, setPosition] = useState({ top: 72, right: 12, width: 296, maxHeight: 0 });
  useLayoutEffect(() => {
    if (!mounted) return;
    const safeArea = document.createElement('div');
    safeArea.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(safeArea);
    const place = () => {
      const viewport = window.visualViewport;
      const view = { top: viewport?.offsetTop ?? 0, left: viewport?.offsetLeft ?? 0, width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
      const headers = [...document.querySelectorAll<HTMLElement>(pageHeaders)].map(header => header.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.bottom > view.top && rect.top < view.top + 120);
      const headerBottom = Math.max(view.top, ...headers.map(rect => rect.bottom));
      const dock = document.querySelector<HTMLElement>('.customer-dock')?.getBoundingClientRect();
      const insets = getComputedStyle(safeArea);
      const next = topPanelPosition({ viewport: view, layoutWidth: window.innerWidth, headerBottom,
        anchorRight: anchor.current?.getBoundingClientRect().right,
        dockTop: dock && dock.width > 0 && dock.top > view.top ? dock.top : undefined,
        safe: { top: parseFloat(insets.paddingTop) || 0, right: parseFloat(insets.paddingRight) || 0, bottom: parseFloat(insets.paddingBottom) || 0, left: parseFloat(insets.paddingLeft) || 0 },
      });
      setPosition(next);
      if (next.maxHeight < 108) dismiss.current();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      safeArea.remove();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, mounted]);
  return { '--notification-top': `${position.top}px`, '--notification-right': `${position.right}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px` } as CSSProperties;
}
