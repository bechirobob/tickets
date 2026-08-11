"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import Turnstile from "../../turnstile";

export default function AdminLoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!turnstileToken) throw new Error("Complete the browser security check first.");
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, turnstileToken, returnTo: searchParams.get("returnTo") ?? "/admin" }),
      });
      const result = (await response.json()) as { error?: string; returnTo?: string };
      if (!response.ok || !result.returnTo) throw new Error(result.error ?? "Access could not be verified.");
      window.location.assign(result.returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access could not be verified.");
      setBusy(false);
    }
  }

  return (
    <form className="admin-login__form" onSubmit={submit}>
      <label htmlFor="staff-email">Work email</label>
      <input id="staff-email" autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <label htmlFor="staff-password">Password</label>
      <input id="staff-password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <Turnstile action="staff_login" onToken={setTurnstileToken} />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy || !turnstileToken} type="submit">{busy ? "Checking…" : "Enter secure workspace"}</button>
    </form>
  );
}
