"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Check, CreditCard, Gem, LockKeyhole, Minus, Plus, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CuratedEvent } from "../../events";
import { formatGhanaCedis } from "../../../lib/ticket-tiers";
import { trackProductMetric } from "../../../lib/client-analytics";

const paymentNetworks = [
  { id: "mtn", label: "MTN MoMo", icon: "/payment-providers/mtn-momo.svg" },
  { id: "telecel", label: "Telecel Cash", icon: "/payment-providers/telecel-cash.svg" },
  { id: "at", label: "AT Money", icon: "/payment-providers/at-money.svg" },
] as const;

export default function CheckoutForm({ slug, event }: { slug: string; event: CuratedEvent }) {
  const params = useSearchParams();
  const [quantity, setQuantity] = useState(1);
  const [selectedTierId, setSelectedTierId] = useState(() => {
    const requested = params.get("tier");
    return event.ticketTiers.find((tier) => tier.status === "available" && (!requested || tier.id === requested))?.id ?? event.ticketTiers.find((tier) => tier.status === "available")?.id ?? event.ticketTiers[0].id;
  });
  const [network, setNetwork] = useState("mtn");
  const [paymentMethod, setPaymentMethod] = useState<"mobile_money" | "card">("mobile_money");
  const [message, setMessage] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [feePercent, setFeePercent] = useState(7.5);
  const [isPaying, setIsPaying] = useState(false);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const selectedTier = event.ticketTiers.find((tier) => tier.id === selectedTierId) ?? event.ticketTiers[0];
  const ticketTotalMinor = quantity * selectedTier.priceMinor;
  const feeMinor = useMemo(() => Math.round(ticketTotalMinor * feePercent / 100), [ticketTotalMinor, feePercent]);
  const totalMinor = ticketTotalMinor + feeMinor;
  const admissionCount = quantity * selectedTier.admissionsPerUnit;
  const maxPurchasableUnits = Math.max(1, Math.min(selectedTier.maxUnitsPerOrder, Math.floor(selectedTier.remainingAdmissions / selectedTier.admissionsPerUnit)));

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
    if (isPaying) return;
    if (!fullName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim()) || phone.trim().length < 7) {
      setMessage("We need the boring three before the fun one: your name, a valid email and a reachable phone number.");
      return;
    }
    if (!acceptedPolicies) {
      setMessage("One tiny grown-up moment: accept the ticket and refund terms before payment.");
      return;
    }
    setIsPaying(true);
    trackProductMetric("checkout_started", slug);
    setMessage(paymentMethod === "mobile_money" ? "Sending the MoMo prompt to your phone…" : "Opening Paystack's secure card checkout…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventSlug: slug, ticketTierId: selectedTier.id, quantity, paymentMethod, network: paymentMethod === "mobile_money" ? network : undefined, email, phone, fullName, acceptedPolicies, offer: params.get("offer"), promoterCode: params.get("ref") }),
        signal: controller.signal,
      });
      const data = await response.json() as { authorizationUrl?: string; nextUrl?: string; error?: string };
      const paymentUrl = data.authorizationUrl ?? data.nextUrl;
      if (!response.ok || !paymentUrl) throw new Error(data.error || "Payment refused to leave the house. Try again.");
      window.location.href = paymentUrl;
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === "AbortError"
        ? "Paystack took too long to answer. Nothing was charged—give it another go."
        : error instanceof Error ? error.message : "Payment refused to leave the house. Try again.");
      setIsPaying(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  function chooseTier(tierId: typeof selectedTierId) {
    setSelectedTierId(tierId);
    setQuantity(1);
    setMessage("");
  }

  return (
    <main className="checkout-page">
      <header className="checkout-header">
        <Link href={`/event/${slug}`}><ArrowLeft size={17} /> Back to event</Link>
        <Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link>
        <span><LockKeyhole size={15} /> Secure, not dramatic</span>
      </header>
      <div className="checkout-layout">
        <section className="checkout-main">
          {event.isTestEvent ? <div className="preview-checkout-note"><strong>Test checkout</strong><span>No real event is taking place and no real money should be used. Paystack test mode accepts MTN number <b>055 123 498 7</b> without a PIN or OTP.</span></div> : null}
          <div className="checkout-step">
            <span>1</span><div><small>Your order</small><h1>{event.title}</h1></div>
          </div>
          <div className="ticket-tier-list" role="radiogroup" aria-label="Choose ticket tier">
            {event.ticketTiers.filter((tier) => tier.status !== "hidden").map((tier) => {
              const selected = tier.id === selectedTier.id;
              const soldOut = tier.status !== "available";
              return (
                <div className={`checkout-tier${selected ? " selected" : ""}${soldOut ? " sold-out" : ""}`} key={tier.id}>
                  <button
                    type="button"
                    className="checkout-tier__choice"
                    role="radio"
                    aria-checked={selected}
                    disabled={soldOut}
                    onClick={() => chooseTier(tier.id)}
                  >
                    <i aria-hidden="true" />
                    <span><strong>{tier.name}</strong><small>{tier.description}{tier.admissionsPerUnit > 1 ? ` · Admits ${tier.admissionsPerUnit}` : ""}</small>{tier.roomBadge === "VIP" ? <em className="checkout-tier__vip"><Gem size={11} /> VIP Room identity + private Host concierge when enabled</em> : null}</span>
                    <b>{tier.status === "sold_out" ? "Sold out" : tier.status === "upcoming" ? "Sales soon" : tier.status === "closed" ? "Sales closed" : formatGhanaCedis(tier.priceMinor)}</b>
                  </button>
                  {selected && !soldOut && (
                    <div className="quantity-control" aria-label={`${tier.name} quantity`}>
                      <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label={`Remove ${tier.name}`}><Minus size={15} /></button>
                      <b>{quantity}</b>
                      <button type="button" onClick={() => setQuantity((value) => Math.min(maxPurchasableUnits, value + 1))} disabled={quantity >= maxPurchasableUnits} aria-label={`Add ${tier.name}`}><Plus size={15} /></button>
                    </div>
                  )}
                  {selected && !soldOut ? <small className="tier-availability">{tier.remainingAdmissions} admissions currently available</small> : null}
                </div>
              );
            })}
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
            <span>3</span><div><small>Payment</small><h2>Choose how you want to pay.</h2></div>
          </div>
          <div className="payment-methods" role="radiogroup" aria-label="Choose payment method">
            <button type="button" role="radio" aria-checked={paymentMethod === "mobile_money"} className={paymentMethod === "mobile_money" ? "selected" : ""} onClick={() => { setPaymentMethod("mobile_money"); setMessage(""); }}>
              <Smartphone size={19} /><span>Mobile money<small>MTN, Telecel or AT Money</small></span>{paymentMethod === "mobile_money" && <Check size={18} />}
            </button>
            <button type="button" role="radio" aria-checked={paymentMethod === "card"} className={paymentMethod === "card" ? "selected" : ""} onClick={() => { setPaymentMethod("card"); setMessage(""); }}>
              <CreditCard size={19} /><span>Card<small>Visa or Mastercard</small></span>{paymentMethod === "card" && <Check size={18} />}
            </button>
          </div>
          <div className="payment-method-detail">
            {paymentMethod === "mobile_money" ? <div className="network-list" role="radiogroup" aria-label="Choose mobile money service">
              {paymentNetworks.map((item) => (
                <button type="button" role="radio" aria-checked={network === item.id} key={item.id} className={network === item.id ? "selected" : ""} onClick={() => setNetwork(item.id)}>
                  <span className="network-logo" aria-hidden="true"><Image src={item.icon} alt="" width={38} height={38} /></span>
                  <span className="network-copy">{item.label}<small>Your phone gets the final say</small></span>
                  {network === item.id && <Check size={18} />}
                </button>
              ))}
            </div> : <div className="card-payment-detail">
              <CreditCard size={24} aria-hidden="true" />
              <div><strong>Visa or Mastercard</strong><p>Continue to Paystack to enter your card details securely. BeCore never receives or stores your card number.</p><span className="accepted-card-brands" aria-label="Accepted cards: Visa and Mastercard"><Image src="/payment-providers/visa.svg" alt="" width={56} height={32} /><Image src="/payment-providers/mastercard.svg" alt="" width={48} height={32} /></span></div>
            </div>}
          </div>
          <label className="checkout-consent"><input type="checkbox" checked={acceptedPolicies} onChange={(event) => setAcceptedPolicies(event.target.checked)} /><span>I accept the <Link href="/terms#purchase" target="_blank">ticket terms</Link>, <Link href="/terms#refund" target="_blank">refund rules</Link> and <Link href="/privacy" target="_blank">privacy notice</Link>. The accepted versions stay attached to this order.</span></label>
        </section>

        <aside className="order-summary">
          <p className="eyebrow">Order summary</p>
          <h2>{event.title}</h2>
          <p>{event.shortDate} · {event.time.split(" — ")[0]}<br />{event.venue}, {event.area}</p>
          <div className="summary-lines">
            <span>{quantity} × {selectedTier.name} <b>{formatGhanaCedis(ticketTotalMinor)}</b></span>
            {selectedTier.admissionsPerUnit > 1 && <span>Admissions included <b>{admissionCount}</b></span>}
            <span>Booking fee ({feePercent}%) <b>{formatGhanaCedis(feeMinor)}</b></span>
            <strong>Total <b>{formatGhanaCedis(totalMinor)}</b></strong>
          </div>
          <button type="button" className="pay-button" onClick={continueToPay} disabled={isPaying || !acceptedPolicies}>{isPaying ? "Making it official…" : paymentMethod === "card" ? `Continue to card payment · ${formatGhanaCedis(totalMinor)}` : `Pay with MoMo · ${formatGhanaCedis(totalMinor)}`}</button>
          {message && <p className="payment-message" role="status">{message}</p>}
          <p className="secure-note"><ShieldCheck size={15} /> Paystack handles the money. We handle the night.</p>
        </aside>
      </div>
    </main>
  );
}
