"use client";

import { FormEvent, useState } from "react";

export default function AccountSecurity({ mustChangePassword }: { mustChangePassword: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/session", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }),
    });
    const result = await response.json() as { error?: string; returnTo?: string };
    if (!response.ok || !result.returnTo) {
      setMessage(result.error ?? "The password could not be changed.");
      setBusy(false);
      return;
    }
    window.location.assign(result.returnTo);
  }

  return <form className="account-security" onSubmit={submit}>
    {mustChangePassword ? <p className="ops-message">Change the temporary password before opening your workspace.</p> : null}
    <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
    <small>Use 12 or more characters with upper-case, lower-case and a number.</small>
    {message ? <p role="alert">{message}</p> : null}
    <button disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
  </form>;
}
