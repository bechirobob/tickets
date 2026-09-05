"use client";

import QRCode from "qrcode";
import { useEffect } from "react";
import { saveOfflineNight } from "../lib/offline-tickets";

type OfflineTicket = { id: string; ticketType: string; status: string; gateCode: string | null; qrPayload: string | null };
type OfflineEvent = { slug: string; title: string; fullDate: string; time: string; venue: string; area: string; endsAt: string };

export default function OfflineTicketSaver({ event, tickets, ownerId }: { event: OfflineEvent; tickets: OfflineTicket[]; ownerId: string }) {
  useEffect(() => {
    const active = tickets.filter((ticket) => ticket.status === "issued" && ticket.qrPayload && ticket.gateCode);
    let cancelled = false;
    void Promise.all(active.map(async (ticket) => ({
      id: ticket.id,
      ticketType: ticket.ticketType,
      gateCode: ticket.gateCode!,
      qrImage: await QRCode.toDataURL(ticket.qrPayload!, {
        width: 460,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#181914", light: "#fffdf8" },
      }),
    }))).then((prepared) => {
      if (cancelled) return;
      saveOfflineNight(ownerId, { ...event, savedAt: new Date().toISOString(), expiresAt: new Date(Math.min(Date.parse(event.endsAt) + 86_400_000, Date.now() + 7 * 86_400_000)).toISOString(), tickets: prepared });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [event, tickets, ownerId]);
  return null;
}
