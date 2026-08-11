"use client";

import { Loader2, Mail, Send, X } from "lucide-react";
import { useState } from "react";

export default function TicketTransfer({ ticketId, disabled }: { ticketId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [notice, setNotice] = useState("");

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (state !== "idle") return;
    setState("sending"); setNotice("");
    const response = await fetch("/api/customer/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId, recipientEmail: email }) });
    const result = await response.json() as { error?: string; message?: string };
    if (response.ok) { setState("sent"); setNotice(result.message ?? "Transfer sent."); }
    else { setState("idle"); setNotice(result.error ?? "That transfer refused to cooperate."); }
  }

  return <><button type="button" className="ticket-transfer-trigger" disabled={disabled} onClick={() => setOpen(true)}><Send size={13} /> Transfer ticket</button>{open ? <div className="ticket-transfer-modal" role="dialog" aria-modal="true" aria-label="Transfer ticket"><form onSubmit={send}><button type="button" className="ticket-transfer-close" onClick={() => setOpen(false)} aria-label="Close"><X /></button><Mail size={25} /><p className="eyebrow">Send one ticket</p><h3>They get the ticket. You get one fewer person to chase.</h3><p>The recipient accepts from their email. Once accepted, your QR retires and a fresh one appears in their My Nights.</p><label>Recipient email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="friend@example.com" /></label><button disabled={state !== "idle"}>{state === "sending" ? <Loader2 className="spin" size={14} /> : <Send size={14} />}{state === "sent" ? "Transfer waiting" : state === "sending" ? "Sending securely…" : "Send ticket"}</button>{notice ? <small>{notice}</small> : null}</form></div> : null}</>;
}
