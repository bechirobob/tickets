"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson, requestErrorMessage, RequestError } from "../../lib/client-request";

export type NotificationItem = { id: string; eventSlug: string | null; eventTitle?: string | null; kind: string; title: string; body: string; url: string; createdAt: string; readAt: string | null };

export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const busy = useRef(new Set<string>());
  const reads = useRef(new Map<string, string>());
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const data = await requestJson<{ notifications: NotificationItem[] }>("/api/customer/notifications", { cache: "no-store", signal: controller.signal });
      if (!Array.isArray(data.notifications)) throw new Error("Notifications could not be loaded. Please try again.");
      if (controller.signal.aborted) return;
      setItems(data.notifications.map((item) => ({ ...item, readAt: item.readAt ?? reads.current.get(item.id) ?? null })));
      setLocked(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof RequestError && error.status === 401) { setLocked(true); setItems(null); reads.current.clear(); }
      else setLoadError(requestErrorMessage(error));
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);

  const refresh = useCallback(() => { setLoadError(""); setLoading(true); return load(); }, [load]);

  async function mark(id?: string) {
    const key = id ?? "all";
    if (busy.current.has(key) || busy.current.has("all")) return;
    busy.current.add(key); setActionError("");
    if (!id) setMarkingAll(true);
    const markedIds = id ? [id] : (items ?? []).map((item) => item.id);
    try {
      await requestJson("/api/customer/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }), keepalive: true });
      const now = new Date().toISOString();
      markedIds.forEach((markedId) => reads.current.set(markedId, now));
      setItems((current) => current?.map((item) => ({ ...item, readAt: item.readAt ?? reads.current.get(item.id) ?? null })) ?? current);
    } catch (error) { setActionError(requestErrorMessage(error)); }
    finally { busy.current.delete(key); if (!id) setMarkingAll(false); }
  }

  return { items, loading, locked, loadError, actionError, markingAll, load: refresh, mark, unread: items?.filter((item) => !item.readAt).length ?? 0 };
}
