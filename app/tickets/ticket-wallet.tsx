"use client";

import Link from "next/link";
import { ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, Download, LogOut, MapPin, MessageCircle, ReceiptText, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import QrPass from "./qr-pass";

type GateTicket = {
  id: string;
  ticketType: string;
  status: "issued" | "checked_in";
  checkedInAt: string | null;
  gateCode: string | null;
  qrPayload: string | null;
};
type Order = {
  orderId: string;
  reference: string;
  eventSlug: string;
  faceAmountMinor: number;
  bookingFeeMinor: number;
  totalAmountMinor: number;
  currency: string;
  quantity: number;
  paidAt: string | null;
  tickets: GateTicket[];
  event: { title: string; date: string; venue: string } | null;
};
type Wallet = { attendee: { displayName: string }; orders: Order[] };

const DETAILS: Record<string, { title: string; date: string; venue: string }> = {
  "after-dark-osu": { title: "After Dark: Osu", date: "Fri, 14 Aug · 10:00 PM", venue: "The Treehouse, Osu" },
  "noir-room-labone": { title: "The Noir Room", date: "Sat, 15 Aug · 9:30 PM", venue: "The Glass House, Labone" },
  "sun-chasers-labadi": { title: "Sun Chasers", date: "Sun, 16 Aug · 3:00 PM", venue: "The Cove, Labadi" },
  "longitude-spintex": { title: "Longitude 05", date: "Fri, 21 Aug · 11:00 PM", venue: "Untamed Empire, Spintex" },
};

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

function paidDate(value: string | null) {
  if (!value) return "Payment confirmed";
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(value));
}

export default function TicketWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmed] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("confirmed") === "1");

  useEffect(() => {
    fetch("/api/customer/tickets", { method: "POST", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return null;
        const data = await response.json() as Wallet & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Your passes could not be prepared.");
        return data;
      })
      .then((data) => { setWallet(data); setLoading(false); })
      .catch((cause) => { setError(cause instanceof Error ? cause.message : "Your passes could not be prepared."); setLoading(false); });
  }, []);

  async function signOut() {
    await fetch("/api/customer/session", { method: "DELETE" });
    setWallet(null);
  }

  return <main className="wallet-page wallet-page--real">
    <header><Link href="/"><ArrowLeft size={17} /> Back to the shortlist</Link><span className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></span>{wallet ? <button onClick={signOut}><LogOut size={14} /> Sign out</button> : <span />}</header>
    <section>
      {confirmed ? <div className="wallet-confirmed"><CheckCircle2 size={21} /><div><b>Payment confirmed</b><span>Your ticket passes and receipt are ready below.</span></div></div> : null}
      <Ticket size={38} /><p className="eyebrow">Your ticket wallet</p><h1>{loading ? "Preparing your entry passes…" : wallet ? `Good to see you, ${wallet.attendee.displayName}.` : "Your verified tickets live here."}</h1>
      {error ? <p className="wallet-error" role="alert">{error}</p> : null}
      {!loading && !wallet && <div className="wallet-locked"><BadgeCheck /><h2>Access starts after a verified checkout.</h2><p>Complete payment in the same browser and we’ll unlock your QR ticket, receipt and event Room automatically. A screenshot or public event link cannot create access.</p><Link href="/#drop">Choose an event</Link></div>}
      {wallet?.orders.map((order) => {
        const detail = order.event ?? DETAILS[order.eventSlug] ?? { title: order.eventSlug.replaceAll("-", " "), date: "Event date confirmed in your order", venue: "See event details" };
        return <article className="wallet-order" key={order.orderId}>
          <header><div><small><BadgeCheck size={12} /> Paid and verified · {order.quantity} {order.quantity === 1 ? "admission" : "admissions"}</small><h2>{detail.title}</h2><p><CalendarDays size={15} /> {detail.date}</p><p><MapPin size={15} /> {detail.venue}</p></div><Link href={`/room/${order.eventSlug}`}><MessageCircle size={16} /> Enter The Room</Link></header>
          <div className="wallet-passes">
            {order.tickets.map((ticketItem, index) => <section className={`wallet-pass wallet-pass--${ticketItem.status}`} key={ticketItem.id}>
              <div><span>Pass {index + 1} of {order.tickets.length}</span><b>{ticketItem.ticketType.replaceAll("-", " ")}</b></div>
              {ticketItem.qrPayload && ticketItem.gateCode ? <><QrPass payload={ticketItem.qrPayload} label={`Entry QR code for pass ${index + 1}`} /><code>{ticketItem.gateCode}</code><p>Present this moving pass at the gate. Opening the wallet again refreshes the code.</p></> : ticketItem.status === "checked_in" ? <div className="wallet-admitted"><CheckCircle2 size={34} /><b>Admitted</b><span>{ticketItem.checkedInAt ? paidDate(ticketItem.checkedInAt) : "Entry recorded"}</span></div> : <p className="wallet-pass-error">This pass could not refresh. Reload before arriving at the gate.</p>}
            </section>)}
          </div>
          <section className="wallet-receipt">
            <header><div><ReceiptText size={18} /><span><b>Payment receipt</b><small>{order.reference}</small></span></div><button type="button" onClick={() => window.print()}><Download size={14} /> Print / save</button></header>
            <dl><div><dt>Ticket subtotal</dt><dd>{money(order.faceAmountMinor, order.currency)}</dd></div><div><dt>Booking fee</dt><dd>{money(order.bookingFeeMinor, order.currency)}</dd></div><div><dt>Total paid</dt><dd>{money(order.totalAmountMinor, order.currency)}</dd></div><div><dt>Confirmed</dt><dd>{paidDate(order.paidAt)}</dd></div></dl>
          </section>
        </article>;
      })}
    </section>
  </main>;
}
