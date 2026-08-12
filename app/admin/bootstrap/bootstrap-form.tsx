"use client";

import { FormEvent, useState } from "react";
import { prepareStaffPassword } from "../../../lib/staff-password-client";

export default function BootstrapForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const password = await prepareStaffPassword(String(form.get("password") ?? ""));
      const response = await fetch("/api/admin/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessKey: form.get("accessKey"), displayName: form.get("displayName"),
          email: form.get("email"), ...password,
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

  return <form className="admin-login__form admin-bootstrap__form" onSubmit={submit}>
    <div className="admin-form-field admin-form-field--wide">
      <label htmlFor="owner-setup-key">One-time setup key</label>
      <input id="owner-setup-key" name="accessKey" type="password" autoComplete="off" required />
      <small>This is the hidden Cloudflare secret named <code>ADMIN_ACCESS_KEY</code>, not an account password.</small>
      <details className="admin-bootstrap__key-help">
        <summary>Where do I get this?</summary>
        <p>In Cloudflare, open <b>Workers &amp; Pages → becore-tickets → Settings → Variables and Secrets</b>. Secrets cannot be viewed again; if nobody saved this one, replace <code>ADMIN_ACCESS_KEY</code> with a fresh private value and enter that value here.</p>
      </details>
    </div>
    <div className="admin-form-field">
      <label htmlFor="owner-name">Your name</label>
      <input id="owner-name" name="displayName" autoComplete="name" required minLength={2} maxLength={100} />
    </div>
    <div className="admin-form-field">
      <label htmlFor="owner-email">Owner email</label>
      <input id="owner-email" name="email" type="email" autoComplete="username" required />
    </div>
    <div className="admin-form-field admin-form-field--wide">
      <label htmlFor="owner-password">New owner password</label>
      <input id="owner-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} />
      <small>Use 12 or more characters with upper-case, lower-case and a number.</small>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <button disabled={busy}>{busy ? "Creating owner…" : "Create owner account"}</button>
  </form>;
}
