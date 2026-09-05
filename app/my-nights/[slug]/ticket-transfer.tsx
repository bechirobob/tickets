"use client";

import { Loader2, Mail, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { requestErrorMessage, requestJson } from "../../../lib/client-request";
import TicketDialog from "../../ticket-dialog";

export default function TicketTransfer({ ticketId, disabled }: { ticketId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [notice, setNotice] = useState("");
  const busy = useRef(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || state !== "idle") return;
    busy.current = true;
    setState("sending"); setNotice("");
    try {
      const result = await requestJson<{ message?: string }>("/api/customer/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId, recipientEmail: email }) });
      setState("sent"); setNotice(result.message ?? "Transfer sent.");
    } catch (cause) {
      setState("idle"); setNotice(requestErrorMessage(cause));
    } finally { busy.current = false; }
  }

  return <><button type="button" className="ticket-transfer-trigger" disabled={disabled} onClick={() => setOpen(true)}><Send size={13} /> Transfer ticket</button>{open ? <TicketDialog label="Transfer ticket" onClose={() => setOpen(false)}><form onSubmit={send}><button type="button" className="ticket-transfer-close" onClick={() => setOpen(false)} aria-label="Close"><X /></button><Mail size={25} /><p className="eyebrow">Send one ticket</p><h3>Pass your ticket to a friend.</h3><p>The recipient accepts from their email. Once accepted, your QR retires and a fresh one appears in their My Nights.</p><label>Recipient email<input type="email" required autoComplete="email" disabled={state !== "idle"} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="friend@example.com" /></label><button disabled={state !== "idle"}>{state === "sending" ? <Loader2 className="spin" size={14} /> : <Send size={14} />}{state === "sent" ? "Transfer waiting" : state === "sending" ? "Sending securely…" : "Send ticket"}</button>{notice ? <small role="status">{notice}</small> : null}</form></TicketDialog> : null}</>;
}
