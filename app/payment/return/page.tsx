"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function PaymentReturn() {
  const params = useSearchParams();
  const reference = params.get("reference") ?? "";
  const claim = params.get("claim") ?? "";
  const resumeCheckout = params.get("pending") === "1";
  const [state, setState] = useState<"checking" | "ready" | "failed">("checking");
  const [eventSlug, setEventSlug] = useState("");
  const [message, setMessage] = useState(() => params.get("pending") === "1"
    ? "Your payment hasn’t given us an answer yet. We’re checking it. Don’t pay again."
    : params.get("prompt") === "1"
    ? "Keep your phone close. Approve the MoMo prompt and we’ll handle the rest."
    : "Checking your payment. Nearly time to tell the group chat.");

  useEffect(() => {
    // Keep the one-time claim in the URL until verification completes. Clearing
    // it updates useSearchParams, aborts this effect and loses the return context.
    // The final location.replace removes it from history; Referrer-Policy is
    // no-referrer. A refresh while checking can therefore safely resume.
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const check = async () => {
      attempt += 1;
      try {
        const response = await fetch(!reference || !claim ? "/api/customer/session?paymentReturn=1" : "/api/customer/session", !reference || !claim ? {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
          cache: "no-store",
        } : {
          method: "POST",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reference, claim, resumeCheckout }),
        });
        const result = await response.json() as { pending?: boolean; authorizationUrl?: string; signedIn?: boolean; eventSlug?: string; error?: string };
        if (cancelled) return;
        if (response.status === 202 && result.authorizationUrl) {
          const url = new URL(result.authorizationUrl);
          if (url.origin === "https://pay.seevplus.com" && !url.username && !url.password) {
            window.location.replace(url.href);
            return;
          }
        }
        if (response.ok && result.signedIn) {
          const purchasedEvent = result.eventSlug ?? "";
          try { sessionStorage.removeItem(`bct:payment-attempt:${purchasedEvent}`); } catch { /* Storage is optional. */ }
          setEventSlug(purchasedEvent);
          setState("ready");
          setMessage("You’re in. Your ticket is ready in My Nights.");
          timer = setTimeout(() => window.location.replace(purchasedEvent ? `/my-nights/${encodeURIComponent(purchasedEvent)}?welcome=1` : "/my-nights?welcome=1"), 700);
          return;
        }
        if (response.status === 202 && attempt < 72) {
          timer = setTimeout(check, 2500);
          return;
        }
        setState("failed");
        setMessage(result.error ?? "We’re still checking your payment. Your ticket lands once it clears.");
      } catch {
        if (cancelled) return;
        if (attempt < 72) timer = setTimeout(check, 2500);
        else {
          setState("failed");
          setMessage("This payment’s taking its time. Your order is saved. Don’t pay again.");
        }
      }
    };
    void check();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [reference, claim, resumeCheckout]);

  return (
    <main className="payment-return"><div>
      {state === "ready" ? <CheckCircle2 size={45} /> : <Clock3 size={45} />}
      <p className="eyebrow">{state === "ready" ? "Payment confirmed" : "Checking your payment"}</p>
      <h1>{state === "ready" ? "You’re going out." : state === "failed" ? "A small hold-up." : "One last money check."}</h1>
      <p>{message}</p>
      {state === "ready" && eventSlug ? <Link href={`/my-nights/${eventSlug}?welcome=1`}>Open My Night</Link> : <Link href="/my-nights">Open My Nights</Link>}
      <span><ShieldCheck size={15} /> Once payment clears, your ticket is right here.</span>
    </div></main>
  );
}
