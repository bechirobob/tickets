"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { requestJson } from '../lib/client-request';
import type { RoomUpdateSummary } from '../lib/room-update-summary';

// Diagnostic-only observer. No listener is installed in the application.
function traceRoom(phase: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  const trace = (window as unknown as { __bctRoomTrace?: (record: Record<string, unknown>) => void }).__bctRoomTrace;
  trace?.({ phase, ...detail });
}

export function useRoomUpdates(enabled: boolean, pathname: string, isVisible: () => boolean) {
  const [result, setResult] = useState<{ pathname: string; rooms: RoomUpdateSummary[] }>({ pathname: '', rooms: [] });
  // Discard the old path before commit, including a trip through a disabled
  // Room/checkout route followed by a return to the same public page.
  if (result.pathname !== pathname || (!enabled && result.rooms.length > 0)) setResult({ pathname, rooms: [] });
  // A route transition must not flash a previous page's private result.
  const rooms = useMemo(() => enabled && result.pathname === pathname ? result.rooms : [], [enabled, pathname, result]);
  traceRoom('render', { enabled, pathname, rooms: rooms.length });
  const request = useRef<AbortController | null>(null);
  const committed = useRef({ enabled: false, pathname });
  useLayoutEffect(() => {
    committed.current = { enabled, pathname };
    traceRoom('layout-commit', { enabled, pathname });
    return () => {
      traceRoom('layout-cleanup', { enabled, pathname });
      committed.current = { enabled: false, pathname };
      request.current?.abort();
    };
  }, [enabled, pathname]);
  const refresh = useCallback(async () => {
    traceRoom('refresh-entry', { enabled, pathname, committed: { ...committed.current } });
    // Queued callbacks can outlive their render and passive-effect cleanup.
    if (!enabled || !committed.current.enabled || committed.current.pathname !== pathname || !isVisible()) { traceRoom('refresh-rejected'); return null; }
    request.current?.abort();
    if (document.visibilityState !== 'visible') { traceRoom('refresh-hidden'); return null; }
    const controller = new AbortController();
    request.current = controller;
    traceRoom('request-start', { enabled, pathname });
    try {
      const result = await requestJson<{ rooms: RoomUpdateSummary[] }>('/api/customer/room-updates', { signal: controller.signal });
      traceRoom('request-result', { aborted: controller.signal.aborted, enabled, pathname });
      if (controller.signal.aborted) return null;
      if (!Array.isArray(result.rooms) || result.rooms.some(room => !/^[a-z0-9-]{1,80}$/u.test(room.eventSlug)
        || typeof room.title !== 'string' || !Number.isSafeInteger(room.unread) || room.unread < 0 || !Number.isFinite(Date.parse(room.expiresAt)))) throw new Error('Invalid Room summary');
      const current = result.rooms.filter(room => Date.parse(room.expiresAt) > Date.now());
      setResult({ pathname, rooms: current });
      return current;
    } catch {
      if (!controller.signal.aborted) setResult({ pathname, rooms: [] });
      return null;
    }
  }, [enabled, pathname, isVisible]);

  useEffect(() => {
    traceRoom('passive-subscription', { enabled, pathname });
    if (!enabled) return;
    const clearAndRefresh = (event?: Event) => { traceRoom('resume', { event: event?.type, enabled, pathname }); setResult({ pathname, rooms: [] }); void refresh(); };
    const visibility = (event?: Event) => {
      traceRoom('visibility-session', { event: event?.type, enabled, pathname });
      request.current?.abort();
      setResult({ pathname, rooms: [] });
      if (document.visibilityState === 'visible') void refresh();
    };
    const initial = window.setTimeout(() => { traceRoom('initial-fire', { enabled, pathname }); void refresh(); }, 0);
    traceRoom('initial-set', { timer: initial, enabled, pathname });
    window.addEventListener('focus', clearAndRefresh);
    window.addEventListener('pageshow', clearAndRefresh);
    window.addEventListener('online', clearAndRefresh);
    window.addEventListener('bct:room-updates-read', clearAndRefresh);
    window.addEventListener('bct:attendee-session-changed', visibility);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      request.current?.abort();
      traceRoom('passive-cleanup', { timer: initial, enabled, pathname });
      window.clearTimeout(initial);
      window.removeEventListener('focus', clearAndRefresh);
      window.removeEventListener('pageshow', clearAndRefresh);
      window.removeEventListener('online', clearAndRefresh);
      window.removeEventListener('bct:room-updates-read', clearAndRefresh);
      window.removeEventListener('bct:attendee-session-changed', visibility);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, pathname, refresh]);

  useEffect(() => {
    // Anonymous visitors and guests with no active Room do not keep polling.
    if (!rooms.length) return;
    const timer = window.setInterval(() => { traceRoom('interval-fire', { timer, enabled, pathname }); if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    traceRoom('interval-set', { timer, enabled, pathname });
    return () => { traceRoom('interval-clear', { timer, enabled, pathname }); window.clearInterval(timer); };
  }, [refresh, rooms.length]);

  useEffect(() => {
    if (!rooms.length) return;
    const expiresAt = Math.min(...rooms.map(room => Date.parse(room.expiresAt)));
    const timer = window.setTimeout(() => {
      traceRoom('expiry-fire', { timer, enabled, pathname });
      setResult(current => ({ ...current, rooms: current.rooms.filter(room => Date.parse(room.expiresAt) > Date.now()) }));
      void refresh();
    }, Math.max(0, Math.min(2_147_483_647, expiresAt - Date.now())));
    traceRoom('expiry-set', { timer, expiresAt, enabled, pathname });
    return () => { traceRoom('expiry-clear', { timer, enabled, pathname }); window.clearTimeout(timer); };
  }, [refresh, rooms]);

  return { rooms, refresh };
}
