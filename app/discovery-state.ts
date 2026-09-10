"use client";

import { useCallback, useSyncExternalStore } from 'react';
import type { CustomerEvent } from '../lib/customer-screen';
import type { EventWindow } from '../lib/event-discovery';
type Filters = { windowFilter: EventWindow; area: string; vibe: CustomerEvent['vibe'] | 'All'; page: number; search: string };
const initial: Filters = { windowFilter: 'next', area: 'All areas', vibe: 'All', page: 0, search: '' };
const snapshots = new Map<string, Filters>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const serverSnapshot = () => initial;

/** Public browsing state survives route changes in both runtimes, never an identity. */
export function useDiscoveryState(full: boolean) {
  const key = full ? 'drop' : 'home';
  const getSnapshot = useCallback(() => snapshots.get(key) ?? initial, [key]);
  const state = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const update = (next: Partial<Filters>) => {
    snapshots.set(key, { ...getSnapshot(), ...next });
    listeners.forEach(listener => listener());
  };
  return { ...state,
    setWindowFilter: (windowFilter: Filters['windowFilter']) => update({ windowFilter, page: 0 }),
    setArea: (area: string) => update({ area, page: 0 }),
    setVibe: (vibe: Filters['vibe']) => update({ vibe, page: 0 }),
    setPage: (page: number | ((current: number) => number)) => update({ page: typeof page === "function" ? page(getSnapshot().page) : page }),
    setSearch: (search: string) => update({ search, page: 0 }),
  };
}
