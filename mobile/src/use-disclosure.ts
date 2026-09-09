import { useCallback, useEffect, useRef, useState } from 'react';

export function useDisclosure() {
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPhase('closed');
    else { setPhase(value => value === 'closed' ? 'closed' : 'closing'); timer.current = setTimeout(() => setPhase('closed'), 160); }
  }, []);
  const toggle = useCallback(() => {
    if (phase === 'open') close();
    else { if (timer.current) clearTimeout(timer.current); setPhase('open'); }
  }, [phase, close]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { phase, open: phase === 'open', mounted: phase !== 'closed', close, toggle };
}
