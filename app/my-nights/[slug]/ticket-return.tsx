"use client";

import { Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestErrorMessage, requestJson } from "../../../lib/client-request";
import TicketDialog from "../../ticket-dialog";

export default function TicketReturn({
  ticketId,
  disabled,
}: {
  ticketId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(() => requestJson<{ returns: Array<{ ticketId: string }> }>("/api/customer/returns").then((data) => {
      if (!Array.isArray(data.returns)) throw new Error("Your return status could not be loaded.");
      setRequested(data.returns.some((item) => item.ticketId === ticketId));
      setReady(true); setNotice("");
    }).catch((cause) => setNotice(requestErrorMessage(cause))), [ticketId]);
  useEffect(() => { void load(); }, [load]);
  async function update(method: "POST" | "DELETE") {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await requestJson<{ message?: string }>("/api/customer/returns", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      setRequested(method === "POST");
      setNotice(
        method === "POST"
          ? (result.message ?? "Return requested.")
          : "Return cancelled. The ticket is yours as usual.",
      );
    } catch (cause) { setNotice(requestErrorMessage(cause)); setReady(false); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return (
    <>
      <button
        type="button"
        className="ticket-return-trigger"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <RotateCcw size={13} />{" "}
        {requested ? "Return requested" : "Return ticket"}
      </button>
      {open ? (
        <TicketDialog label="Return ticket" onClose={() => setOpen(false)}>
          <section className="ticket-return-card">
            <button
              type="button"
              className="ticket-transfer-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X />
            </button>
            <RotateCcw size={25} />
            <p className="eyebrow">Official return queue</p>
            <h3>Can’t make it?</h3>
            <p>
              We first look for a verified buyer at the same ticket value. Your
              ticket remains valid—and entirely yours—until the replacement
              payment and your refund are confirmed.
            </p>
            <small>
              Requests close 24 hours before the Night. Joining the queue does
              not guarantee a match.
            </small>
            <button
              type="button"
              disabled={busy}
              onClick={() => ready ? void update(requested ? "DELETE" : "POST") : void load()}
            >
              {busy ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <RotateCcw size={14} />
              )}
              {!ready ? "Check return status" : requested ? "Cancel return request" : "Join return queue"}
            </button>
            {notice ? <small role="status">{notice}</small> : null}
          </section>
        </TicketDialog>
      ) : null}
    </>
  );
}
