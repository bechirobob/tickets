"use client";

import { Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

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
  useEffect(() => {
    fetch("/api/customer/returns", { cache: "no-store" })
      .then(async (response) => await response.json() as { returns?: Array<{ ticketId: string }> })
      .then((data) => setRequested(Boolean(data.returns?.some((item) => item.ticketId === ticketId))))
      .catch(() => undefined);
  }, [ticketId]);
  async function update(method: "POST" | "DELETE") {
    setBusy(true);
    setNotice("");
    const response = await fetch("/api/customer/returns", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId }),
    });
    const result = (await response.json()) as {
      error?: string;
      message?: string;
    };
    if (response.ok) {
      setRequested(method === "POST");
      setNotice(
        method === "POST"
          ? (result.message ?? "Return requested.")
          : "Return cancelled. The ticket is yours as usual.",
      );
    } else setNotice(result.error ?? "That request refused to cooperate.");
    setBusy(false);
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
        <div
          className="ticket-transfer-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Return ticket"
        >
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
            <h3>No random resale. No disappearing QR.</h3>
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
              onClick={() => void update(requested ? "DELETE" : "POST")}
            >
              {busy ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <RotateCcw size={14} />
              )}
              {requested ? "Cancel return request" : "Join return queue"}
            </button>
            {notice ? <small>{notice}</small> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
