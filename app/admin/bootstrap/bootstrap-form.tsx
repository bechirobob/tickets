"use client";

import { FormEvent, useState } from "react";
import Turnstile from "../../turnstile";

export default function BootstrapForm() {
  const [turnstileToken, setTurnstileToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessKey: form.get("accessKey"), displayName: form.get("displayName"),
          email: form.get("email"), password: form.get("password"), turnstileToken,
        }),
      });
      const result = await response.json() as { error?: string; returnTo?: string };
      if (!response.ok || !result.returnTo) throw new Error(result.error ?? "Owner setup failed.");
      window.location.assign(result.returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Owner setup failed.");
      setBusy(false);
    }
  }

  return <form className="admin-login__form" onSubmit={submit}>
    <label>Current BeCore access key<input name="accessKey" type="password" autoComplete="off" required /></label>
    <label>Your name<input name="displayName" autoComplete="name" required minLength={2} maxLength={100} /></label>
    <label>Owner email<input name="email" type="email" autoComplete="username" required /></label>
    <label>New owner password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
    <Turnstile action="owner_bootstrap" onToken={setTurnstileToken} />
    {error ? <p role="alert">{error}</p> : null}
    <button disabled={busy || !turnstileToken}>{busy ? "Creating owner…" : "Create owner account"}</button>
  </form>;
}
