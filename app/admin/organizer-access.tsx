"use client";

import { useEffect, useState } from "react";
import { operationsFetch } from "../../lib/operations-client";

type Access = { state: string; canInvite: boolean; expiresAt?: string; deliveryStatus?: string | null };
const labels: Record<string,string> = { activated:"Activated", invited:"Waiting for password setup", expired:"Invite expired", not_invited:"Not invited yet", blocked:"Account needs owner review", unavailable:"Not available" };
const deliveries: Record<string,string> = { sent:"Email sent", delivered:"Email delivered", queued:"Email queued", failed:"Email waiting for retry or needs attention", delayed:"Email delayed", bounced:"Email bounced—check their address", complained:"Email reported as spam", suppressed:"Email not sent" };

export default function OrganizerAccess({ submissionId,accountId }: { submissionId?: string; accountId?: string }) {
  const [access,setAccess] = useState<Access | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const query = new URLSearchParams(submissionId ? { submissionId } : { accountId:accountId ?? "" }).toString();

  useEffect(() => {
    const controller = new AbortController();
    void operationsFetch(`/api/admin/organizer-invitations?${query}`,{ cache:"no-store",signal:controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Access status could not be loaded."); return response.json() as Promise<Access>; })
      .then(result => { if (!controller.signal.aborted) setAccess(result); })
      .catch(() => { if (!controller.signal.aborted) setError("Access status could not be loaded. Refresh to try again."); });
    return () => controller.abort();
  },[query]);

  async function refresh(resend: boolean) {
    if (busy) return;
    setBusy(true);setError("");setNotice("");
    try {
      const response = await operationsFetch(`/api/admin/organizer-invitations${resend ? "" : `?${query}`}`,resend
        ? { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({submissionId,accountId}),signal:AbortSignal.timeout(30000) }
        : { cache:"no-store",signal:AbortSignal.timeout(15000) });
      const result = await response.json() as Access & { error?:string };
      if (!response.ok) throw new Error(result.error ?? "Access status could not be updated.");
      setAccess(result);
      if (resend) setNotice(result.state === "activated" ? "They already have access. Their password is unchanged." : result.deliveryStatus === "sent" || result.deliveryStatus === "delivered" ? "Invitation sent. Any older setup link has been replaced." : "Invitation saved. Email delivery is pending; check the status below.");
    } catch(cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "We couldn’t confirm delivery. Refresh the status before trying again."); }
    finally { setBusy(false); }
  }

  return <section aria-label="Organiser access" className="organizer-access">
    <h3>Organiser access</h3>
    <p>{access ? labels[access.state] ?? access.state : "Checking access…"}</p>
    {access?.state === "activated" ? <p>They can use their existing email and password.</p> : null}
    {access?.deliveryStatus && access.state !== "activated" ? <p>{deliveries[access.deliveryStatus] ?? "Email status unavailable"}</p> : null}
    {access?.expiresAt && access.state === "invited" ? <p>Link expires {new Date(access.expiresAt).toLocaleString("en-GH",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Accra"})} (Ghana time).</p> : null}
    {access?.state === "blocked" ? <p>Review the account’s role and status in People & permissions. Approval never changes existing staff permissions.</p> : null}
    <div className="curation-actions">
      {access?.canInvite ? <button type="button" disabled={busy} onClick={() => void refresh(true)}>{busy ? "Working…" : access.state === "not_invited" ? "Send invite" : "Resend invite"}</button> : null}
      <button type="button" disabled={busy} onClick={() => void refresh(false)}>Refresh status</button>
    </div>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
