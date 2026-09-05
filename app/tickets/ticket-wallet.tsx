"use client";

import BrandLogo from "../brand-logo";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, Download, Loader2, LogOut, Mail, MapPin, MessageCircle, ReceiptText, Ticket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QrPass from "./qr-pass";
import PublicNavigation from "../mobile-navigation";
import LoadingSkeleton from "../loading-skeleton";
import { clearOfflineTickets, reconcileOfflineTickets } from "../../lib/offline-tickets";
import { requestErrorMessage, requestJson } from "../../lib/client-request";

type GateTicket = {
  id: string;
  ticketType: string;
  status: "issued" | "checked_in" | "unavailable" | "voided";
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
  bookedFor: string | null;
  tickets: GateTicket[];
  event: { title: string; date: string; venue: string; state: string } | null;
};
type Wallet = { attendee: { attendeeId: string; displayName: string; emailVerified: boolean }; orders: Order[] };

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
  const [recovered] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("recovered") === "1");
  const [recoveryInvalid] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("recovery") === "invalid");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryState, setRecoveryState] = useState<"idle" | "sending" | "sent">("idle");
  const recoveryBusy = useRef(false);

  useEffect(() => {
    fetch("/api/customer/tickets", { method: "POST", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) { clearOfflineTickets(); return null; }
        const data = await response.json() as Wallet & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Your passes could not be prepared.");
        reconcileOfflineTickets(data.attendee.attendeeId, data.orders.flatMap((order) => order.tickets.filter((ticket) => ticket.status === "issued" && ticket.qrPayload).map((ticket) => ticket.id)));
        return data;
      })
      .then((data) => { setWallet(data); setLoading(false); })
      .catch((cause) => { setError(cause instanceof Error ? cause.message : "Your passes could not be prepared."); setLoading(false); });
  }, []);

  async function signOut() {
    clearOfflineTickets();
    try {
      const response = await fetch("/api/customer/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Sign-out did not complete. Please try again.");
      setWallet(null);
    } catch {
      setError("Offline copies removed. Reconnect and try again to finish signing out.");
    }
  }

  async function requestRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryBusy.current) return;
    recoveryBusy.current = true;
    setRecoveryState("sending"); setError("");
    try {
      await requestJson("/api/customer/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: recoveryEmail }) });
      setRecoveryState("sent");
    } catch (cause) { setRecoveryState("idle"); setError(requestErrorMessage(cause)); }
    finally { recoveryBusy.current = false; }
  }

  if (loading) return <LoadingSkeleton kind="wallet" label="Preparing your entry passes" />;

  return <main className="wallet-page wallet-page--real">
    <header><Link href="/"><ArrowLeft size={17} /> Back to the shortlist</Link><span className="brand-mark"><BrandLogo /></span><span className="public-header-actions">{wallet ? <button onClick={signOut}><LogOut size={14} /> Sign out</button> : null}<PublicNavigation /></span></header>
    <section>
      {confirmed ? <div className="wallet-confirmed"><CheckCircle2 size={21} /><div><b>Payment confirmed</b><span>Your night survived the group chat. Passes and receipt are below.</span></div></div> : null}
      {recovered ? <div className="wallet-confirmed"><CheckCircle2 size={21} /><div><b>Wallet recovered</b><span>Fresh QR passes, because screenshots deserve trust issues.</span></div></div> : null}
      {wallet && !wallet.attendee.emailVerified ? <div className="wallet-confirmed wallet-confirmed--verify"><Mail size={21} /><div><b>This checkout is isolated for your security</b><span>Use the one-time link sent to your email to join earlier purchases into this wallet.</span></div></div> : null}
      <Ticket size={38} /><p className="eyebrow">Your ticket wallet</p><h1>{loading ? "Preparing your entry passes…" : wallet ? `Good to see you, ${wallet.attendee.displayName}.` : "Your verified tickets live here."}</h1>
      {error ? <p className="wallet-error" role="alert">{error}</p> : null}
      {!loading && !wallet && <div className="wallet-locked"><BadgeCheck /><h2>{recoveryInvalid ? "That link already did its one job—or took too long getting dressed." : "Your wallet is waiting for a paid ticket."}</h2><p>Complete payment in this browser, or recover existing paid tickets securely by email. We never put reusable ticket secrets in the message. We enjoy sleeping at night.</p><form className="wallet-recovery" onSubmit={requestRecovery}><label>Email used at checkout<input type="email" required autoComplete="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="you@example.com" /></label><button disabled={recoveryState !== "idle"}>{recoveryState === "sending" ? <Loader2 className="spin" size={15} /> : <Mail size={15} />} {recoveryState === "sent" ? "Check your email" : recoveryState === "sending" ? "Sending…" : "Email secure access link"}</button></form>{recoveryState === "sent" ? <small>If that address has active paid tickets, the one-time link will arrive shortly. Inbox ownership gets the final say.</small> : null}<Link href="/#drop">Choose a night</Link></div>}
      {wallet?.orders.map((order) => {
        const detail = order.event ?? { title: order.eventSlug.replaceAll("-", " "), date: "Event date confirmed in your order", venue: "See event details", state: "unavailable" };
        return <article className="wallet-order" key={order.orderId}>
          <header><div><small><BadgeCheck size={12} /> Paid and verified · {order.quantity} {order.quantity === 1 ? "admission" : "admissions"}</small><h2>{detail.title}</h2>{order.bookedFor ? <p>Booked for {order.bookedFor}</p> : null}<p><CalendarDays size={15} /> {detail.date}</p><p><MapPin size={15} /> {detail.venue}</p></div><Link href={`/room/${order.eventSlug}`}><MessageCircle size={16} /> Enter The Room</Link></header>
          <div className="wallet-passes">
            {order.tickets.map((ticketItem, index) => <section className={`wallet-pass wallet-pass--${ticketItem.status}`} key={ticketItem.id}>
              <div><span>Pass {index + 1} of {order.tickets.length}</span><b>{ticketItem.ticketType.replaceAll("-", " ")}</b></div>
              {ticketItem.qrPayload && ticketItem.gateCode ? <><QrPass payload={ticketItem.qrPayload} label={`Entry QR code for pass ${index + 1}`} /><code>{ticketItem.gateCode}</code><p>Brightness up. Screenshot confidence down. Opening the wallet refreshes this moving pass.</p></> : ticketItem.status === "checked_in" ? <div className="wallet-admitted"><CheckCircle2 size={34} /><b>You&apos;re in</b><span>{ticketItem.checkedInAt ? paidDate(ticketItem.checkedInAt) : "Entry recorded. Go enjoy yourself."}</span></div> : ticketItem.status === "unavailable" ? <p className="wallet-pass-error">This pass is paused because the event is {detail.state}. Watch your email; the Host owes you the next move.</p> : <p className="wallet-pass-error">This pass is being dramatic. Reload before arriving at the gate.</p>}
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
