"use client";

import QRCode from "qrcode";
import { useEffect } from "react";

type OfflineTicket = { id: string; ticketType: string; status: string; gateCode: string | null; qrPayload: string | null };
type OfflineEvent = { slug: string; title: string; fullDate: string; time: string; venue: string; area: string };

export default function OfflineTicketSaver({ event, tickets }: { event: OfflineEvent; tickets: OfflineTicket[] }) {
  useEffect(() => {
    const active = tickets.filter((ticket) => ticket.status === "issued" && ticket.qrPayload && ticket.gateCode);
    if (!active.length) return;
    let cancelled = false;
    void Promise.all(active.map(async (ticket) => ({
      id: ticket.id,
      ticketType: ticket.ticketType,
      gateCode: ticket.gateCode,
      qrImage: await QRCode.toDataURL(ticket.qrPayload!, {
        width: 460,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#181914", light: "#fffdf8" },
      }),
    }))).then((prepared) => {
      if (cancelled) return;
      const key = "bct:offline-tickets:v1";
      let saved: Array<Record<string, unknown>> = [];
      try { saved = JSON.parse(window.localStorage.getItem(key) ?? "[]") as Array<Record<string, unknown>>; } catch { saved = []; }
      const next = [{ ...event, savedAt: new Date().toISOString(), tickets: prepared }, ...saved.filter((item) => item.slug !== event.slug)].slice(0, 20);
      window.localStorage.setItem(key, JSON.stringify(next));
    });
    return () => { cancelled = true; };
  }, [event, tickets]);
  return null;
}
