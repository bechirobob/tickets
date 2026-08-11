"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function PaymentReturn() {
  const params = useSearchParams();
  const [state, setState] = useState<"checking" | "ready" | "failed">("checking");
  const [eventSlug, setEventSlug] = useState("");
  const [message, setMessage] = useState("Paystack is confirming the payment. This normally takes a few seconds.");

  useEffect(() => {
    const reference = params.get("reference") ?? "";
    const claim = params.get("claim") ?? "";
    if (!reference || !claim) {
      const timer = window.setTimeout(() => {
        setState("failed");
        setMessage("This payment return link is incomplete. Open your original checkout tab or contact support.");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    window.history.replaceState({}, "", "/payment/return");
    let cancelled = false;
    let attempt = 0;
    const check = async () => {
      attempt += 1;
      try {
        const response = await fetch("/api/customer/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reference, claim }),
        });
        const result = await response.json() as { pending?: boolean; signedIn?: boolean; eventSlug?: string; error?: string };
        if (cancelled) return;
        if (response.ok && result.signedIn) {
          setEventSlug(result.eventSlug ?? "");
          setState("ready");
          setMessage("Your QR ticket, payment receipt and Room access are ready.");
          window.setTimeout(() => window.location.replace("/tickets?confirmed=1"), 700);
          return;
        }
        if (response.status === 202 && attempt < 20) {
          window.setTimeout(check, 2500);
          return;
        }
        setState("failed");
        setMessage(result.error ?? "We could not confirm this payment yet. Your money is not treated as a ticket until Paystack confirms it.");
      } catch {
        if (attempt < 20) window.setTimeout(check, 2500);
        else {
          setState("failed");
          setMessage("The confirmation service is temporarily unavailable. Your order is still recorded safely.");
        }
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [params]);

  return (
    <main className="payment-return"><div>
      {state === "ready" ? <CheckCircle2 size={45} /> : <Clock3 size={45} />}
      <p className="eyebrow">{state === "ready" ? "Payment confirmed" : "Secure confirmation"}</p>
      <h1>{state === "ready" ? "Ticket verified. Your pass is ready." : "We’re making sure the money really arrived."}</h1>
      <p>{message}</p>
      {state === "ready" && eventSlug ? <Link href="/tickets?confirmed=1">Open ticket &amp; receipt</Link> : <Link href="/tickets">Open ticket wallet</Link>}
      <span><ShieldCheck size={15} /> Room access only follows a valid paid ticket.</span>
    </div></main>
  );
}
