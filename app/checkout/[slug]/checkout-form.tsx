"use client";

import Link from "next/link";
import { ArrowLeft, Check, LockKeyhole, Minus, Plus, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CuratedEvent } from "../../events";

export default function CheckoutForm({ slug, event }: { slug: string; event: CuratedEvent }) {
  const [quantity, setQuantity] = useState(1);
  const [network, setNetwork] = useState("mtn");
  const [message, setMessage] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feePercent, setFeePercent] = useState(7.5);
  const ticketTotal = quantity * event.price;
  const fee = useMemo(() => Math.round(ticketTotal * feePercent) / 100, [ticketTotal, feePercent]);
  const total = ticketTotal + fee;

  useEffect(() => {
    fetch("/api/config/booking-fee")
      .then(async (response): Promise<{ percentage?: number } | null> =>
        response.ok ? response.json() as Promise<{ percentage?: number }> : null,
      )
      .then((data) => {
        if (typeof data?.percentage === "number") setFeePercent(data.percentage);
      })
      .catch(() => undefined);
  }, []);

  async function continueToPay() {
    setMessage("Preparing secure payment…");
    try {
      const response = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventSlug: slug, quantity, network, email, phone, fullName }),
      });
      const data = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !data.authorizationUrl) throw new Error(data.error || "Payment could not be started");
      window.location.href = data.authorizationUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment could not be started");
    }
  }

  return (
    <main className="checkout-page">
      <header className="checkout-header">
        <Link href={`/event/${slug}`}><ArrowLeft size={17} /> Back to event</Link>
        <Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link>
        <span><LockKeyhole size={15} /> Secure checkout</span>
      </header>
      <div className="checkout-layout">
        <section className="checkout-main">
          <div className="checkout-step">
            <span>1</span><div><small>Your order</small><h1>{event.title}</h1></div>
          </div>
          <div className="quantity-row">
            <div><strong>General admission</strong><small>GH₵{event.price} each · One ticket, one human, no creative interpretations</small></div>
            <div className="quantity-control">
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Remove ticket"><Minus size={15} /></button>
              <b>{quantity}</b>
              <button type="button" onClick={() => setQuantity((value) => Math.min(10, value + 1))} aria-label="Add ticket"><Plus size={15} /></button>
            </div>
          </div>

          <div className="checkout-step checkout-step--second">
            <span>2</span><div><small>Delivery details</small><h2>Where should the good news find you?</h2></div>
          </div>
          <div className="form-grid">
            <label>Full name<input type="text" placeholder="Your full name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label>Phone number<input type="tel" placeholder="024 000 0000" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label className="full-field">Email address<input type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          </div>

          <div className="checkout-step checkout-step--second">
            <span>3</span><div><small>Payment</small><h2>MoMo. Prompt. Approve. Done.</h2></div>
          </div>
          <div className="network-list">
            {[{ id: "mtn", label: "MTN MoMo", colour: "#ffcc00" }, { id: "telecel", label: "Telecel Cash", colour: "#e60000" }, { id: "at", label: "AT Money", colour: "#1870d5" }].map((item) => (
              <button type="button" key={item.id} className={network === item.id ? "selected" : ""} onClick={() => setNetwork(item.id)}>
                <i style={{ background: item.colour }}><Smartphone size={17} /></i>
                <span>{item.label}<small>Approve the prompt on your phone</small></span>
                {network === item.id && <Check size={18} />}
              </button>
            ))}
          </div>
        </section>

        <aside className="order-summary">
          <p className="eyebrow">Order summary</p>
          <h2>{event.title}</h2>
          <p>{event.shortDate} · {event.time.split(" — ")[0]}<br />{event.venue}, {event.area}</p>
          <div className="summary-lines">
            <span>{quantity} × General admission <b>GH₵{ticketTotal.toFixed(2)}</b></span>
            <span>Booking fee ({feePercent}%) <b>GH₵{fee.toFixed(2)}</b></span>
            <strong>Total <b>GH₵{total.toFixed(2)}</b></strong>
          </div>
          <button type="button" className="pay-button" onClick={continueToPay}>Pay GH₵{total.toFixed(2)} · secure the plan</button>
          {message && <p className="payment-message" role="status">{message}</p>}
          <p className="secure-note"><ShieldCheck size={15} /> Paystack handles the money. We handle the night.</p>
        </aside>
      </div>
    </main>
  );
}
