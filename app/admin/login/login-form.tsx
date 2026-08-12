"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { deriveStaffPasswordProof } from "../../../lib/staff-password-client";

type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export default function AdminLoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<{ options: AuthenticationOptions; exchangeToken: string } | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");

  async function finishMfa(payload: { mode: "passkey" | "recovery"; response?: Awaited<ReturnType<typeof startAuthentication>>; recoveryCode?: string }, context = mfa) {
    if (!context) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/session", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, exchangeToken: context.exchangeToken }) });
      const result = await response.json() as { error?: string; returnTo?: string };
      if (!response.ok || !result.returnTo) throw new Error(result.error ?? "Secure access could not be verified.");
      window.location.assign(result.returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Secure access could not be verified.");
      setBusy(false);
    }
  }

  async function authenticateWithPasskey(next = mfa) {
    if (!next) return;
    try {
      const response = await startAuthentication({ optionsJSON: next.options });
      await finishMfa({ mode: "passkey", response }, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The passkey prompt was closed.");
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const parametersResponse = await fetch(`/api/admin/session?email=${encodeURIComponent(email)}`, { cache: "no-store" });
      const parameters = await parametersResponse.json() as { passwordSalt?: string; passwordIterations?: number; error?: string };
      if (!parametersResponse.ok || !parameters.passwordSalt || !parameters.passwordIterations) {
        throw new Error(parameters.error ?? "Secure access could not start.");
      }
      const passwordProof = await deriveStaffPasswordProof(password, parameters.passwordSalt, parameters.passwordIterations);
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, passwordProof, returnTo: searchParams.get("returnTo") ?? "/admin" }),
      });
      const result = (await response.json()) as { error?: string; returnTo?: string; mfaRequired?: boolean; options?: AuthenticationOptions; exchangeToken?: string };
      if (response.status === 202 && result.mfaRequired && result.options && result.exchangeToken) {
        const next = { options: result.options, exchangeToken: result.exchangeToken };
        setMfa(next); setBusy(false);
        window.setTimeout(() => void authenticateWithPasskey(next), 0);
        return;
      }
      if (!response.ok || !result.returnTo) throw new Error(result.error ?? "Access could not be verified.");
      window.location.assign(result.returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access could not be verified.");
      setBusy(false);
    }
  }

  if (mfa) return <section className="admin-mfa">
    <p className="admin-login__eyebrow">Second check</p><h2>Your device gets the final say.</h2><p>Use the passkey saved to this staff account. Face ID, fingerprint, Windows Hello or a security key all count.</p>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={busy} onClick={() => void authenticateWithPasskey()}>{busy ? "Checking…" : "Use passkey"}</button>
    <details><summary>Use a recovery code</summary><label>One-time recovery code<input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())} placeholder="ABCDE-12345" autoComplete="one-time-code" /></label><button type="button" disabled={busy || recoveryCode.trim().length < 10} onClick={() => void finishMfa({ mode: "recovery", recoveryCode })}>Use code</button></details>
    <button type="button" className="admin-mfa__back" onClick={() => { setMfa(null); setPassword(""); setError(""); }}>Start again</button>
  </section>;

  return (
    <form className="admin-login__form" onSubmit={submit}>
      <label htmlFor="staff-email">Work email</label>
      <input id="staff-email" autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <label htmlFor="staff-password">Password</label>
      <input id="staff-password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy} type="submit">{busy ? "Checking…" : "Enter secure workspace"}</button>
    </form>
  );
}
