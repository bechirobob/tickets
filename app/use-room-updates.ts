"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestJson } from '../lib/client-request';
import type { RoomUpdateSummary } from '../lib/room-updates';

export function useRoomUpdates(enabled: boolean, pathname: string) {
  const [result, setResult] = useState<{ pathname: string; rooms: RoomUpdateSummary[] }>({ pathname: '', rooms: [] });
  // Discard the old path before commit, including a trip through a disabled
  // Room/checkout route followed by a return to the same public page.
  if (result.pathname !== pathname) setResult({ pathname, rooms: [] });
  // A route transition must not flash a previous page's private result.
  const rooms = useMemo(() => enabled && result.pathname === pathname ? result.rooms : [], [enabled, pathname, result]);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    if (!enabled || document.visibilityState !== 'visible') return null;
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await requestJson<{ rooms: RoomUpdateSummary[] }>('/api/customer/room-updates', { signal: controller.signal });
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
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const clearAndRefresh = () => { setResult({ pathname, rooms: [] }); void refresh(); };
    const visibility = () => {
      request.current?.abort();
      setResult({ pathname, rooms: [] });
      if (document.visibilityState === 'visible') void refresh();
    };
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    window.addEventListener('focus', clearAndRefresh);
    window.addEventListener('pageshow', clearAndRefresh);
    window.addEventListener('online', clearAndRefresh);
    window.addEventListener('bct:room-updates-read', clearAndRefresh);
    window.addEventListener('bct:attendee-session-changed', visibility);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      request.current?.abort();
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
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh, rooms.length]);

  useEffect(() => {
    if (!rooms.length) return;
    const expiresAt = Math.min(...rooms.map(room => Date.parse(room.expiresAt)));
    const timer = window.setTimeout(() => {
      setResult(current => ({ ...current, rooms: current.rooms.filter(room => Date.parse(room.expiresAt) > Date.now()) }));
      void refresh();
    }, Math.max(0, Math.min(2_147_483_647, expiresAt - Date.now())));
    return () => window.clearTimeout(timer);
  }, [refresh, rooms]);

  return { rooms, refresh };
}
