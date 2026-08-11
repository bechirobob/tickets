"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function AdminLoginForm() {
  const searchParams = useSearchParams();
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessKey,
          returnTo: searchParams.get("returnTo") ?? "/admin",
        }),
      });
      const result = (await response.json()) as { error?: string; returnTo?: string };
      if (!response.ok || !result.returnTo) {
        throw new Error(result.error ?? "Access could not be verified.");
      }
      window.location.assign(result.returnTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access could not be verified.");
      setBusy(false);
    }
  }

  return (
    <form className="admin-login__form" onSubmit={submit}>
      <label htmlFor="access-key">BeCore access key</label>
      <input
        id="access-key"
        autoComplete="current-password"
        type="password"
        value={accessKey}
        onChange={(event) => setAccessKey(event.target.value)}
        required
      />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy} type="submit">
        {busy ? "Checking…" : "Enter secure workspace"}
      </button>
    </form>
  );
}
