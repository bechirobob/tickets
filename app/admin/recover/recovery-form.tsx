"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { prepareStaffPassword } from "../../../lib/staff-password-client";
import { RECOVERY_ERROR, isRecoveryToken } from "../../../lib/staff-password-recovery-client";

export default function RecoveryForm() {
  const token = useRef("");
  const [email, setEmail] = useState("");
  const [requiresEmail, setRequiresEmail] = useState(false);
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Strip the bearer token from browser history before any request. It is kept
    // only in this component's memory, not cookies or browser storage.
    if (!token.current) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      token.current = params.get("token") ?? "";
      setEmail(params.get("email") ?? "");
    }
    window.history.replaceState(null, "", window.location.pathname);
    if (!isRecoveryToken(token.current)) { setState("invalid"); setError(RECOVERY_ERROR); return; }
    const controller = new AbortController();
    void fetch("/api/admin/recovery", {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ action: "inspect", token: token.current }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    }).then(async (response) => {
      const result = await response.json() as { valid?: boolean; error?: string; requiresEmail?: boolean };
      if (!response.ok || !result.valid) throw new Error(result.error ?? RECOVERY_ERROR);
      if (!controller.signal.aborted) { setRequiresEmail(Boolean(result.requiresEmail)); setState("ready"); }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setState("invalid"); setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "The connection timed out. Open your setup link again to retry.");
    });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirmPassword")) { setError("Those passwords don’t match yet."); return; }
    setBusy(true); setError("");
    try {
      const payload = await prepareStaffPassword(password);
      const response = await fetch("/api/admin/recovery", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ action: "claim", token: token.current, email: data.get("email") ?? "", ...payload }), signal: AbortSignal.timeout(20000),
      });
      const result = await response.json() as { changed?: boolean; error?: string };
      if (!response.ok || !result.changed) throw new Error(result.error ?? "The password could not be changed.");
      token.current = ""; form.reset(); setState("done");
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "We couldn’t confirm the change. Try signing in with your new password before retrying.");
    } finally { setBusy(false); }
  }

  if (state === "checking") return <p role="status">Checking your private link…</p>;
  if (state === "invalid") return <><p role="alert">{error}</p><Link href="/admin/login">Back to sign in</Link></>;
  if (state === "done") return <><p role="status">Your new password is saved. Sign in with your work email and new password. Any existing second-factor check still applies.</p><Link href="/admin/login">Sign in to your workspace</Link></>;
  return <form className="admin-login__form" onSubmit={submit} aria-busy={busy}>
    {requiresEmail ? <><label htmlFor="setup-email">Work email</label><input id="setup-email" name="email" type="email" autoComplete="username" defaultValue={email} required maxLength={254} disabled={busy} /></> : null}
    <label htmlFor="recovery-password">New password</label>
    <input id="recovery-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} aria-describedby="password-help" disabled={busy} />
    <small id="password-help">12 or more characters, with upper-case, lower-case and a number.</small>
    <label htmlFor="recovery-confirm">Confirm new password</label>
    <input id="recovery-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={busy} />
    {error ? <p role="alert">{error}</p> : null}
    <button type="submit" disabled={busy}>{busy ? "Saving your password…" : "Save new password"}</button>
  </form>;
}
