'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { mountYorkeMotion } from '../../lib/yorke-motion';

export default function YorkeMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (root.current) return mountYorkeMotion(root.current);
  }, []);
  return <section ref={root} className="yorke-intro" aria-labelledby="yorke-title">{children}</section>;
}
