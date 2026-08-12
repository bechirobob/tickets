"use client";

import { FormEvent, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type Passkey = { id: string; label: string; deviceType: string; backedUp: number; createdAt: string; lastUsedAt: string | null };
type Session = { id: string; deviceLabel: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; mfaVerifiedAt: string | null };

export default function AccountSecurity({ mustChangePassword }: { mustChangePassword: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  async function loadSecurity() {
    const response = await fetch("/api/admin/passkeys", { cache: "no-store" });
    const data = await response.json() as { passkeys?: Passkey[]; sessions?: Session[]; currentSessionId?: string; recoveryCodesRemaining?: number };
    if (response.ok) { setPasskeys(data.passkeys ?? []); setSessions(data.sessions ?? []); setCurrentSessionId(data.currentSessionId ?? ""); setRecoveryCodesRemaining(data.recoveryCodesRemaining ?? 0); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void loadSecurity(), 0); return () => window.clearTimeout(timer); }, []);

  async function addPasskey() {
    setBusy(true); setMessage("");
    try {
      const begin = await fetch("/api/admin/passkeys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "begin" }) });
      const challenge = await begin.json() as { options?: RegistrationOptions; exchangeToken?: string; error?: string };
      if (!begin.ok || !challenge.options || !challenge.exchangeToken) throw new Error(challenge.error ?? "Passkey setup could not start.");
      const response = await startRegistration({ optionsJSON: challenge.options });
      const finish = await fetch("/api/admin/passkeys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "finish", exchangeToken: challenge.exchangeToken, response, label: navigator.platform || "Passkey" }) });
      const result = await finish.json() as { recoveryCodes?: string[]; error?: string };
      if (!finish.ok) throw new Error(result.error ?? "Passkey setup could not finish.");
      setRecoveryCodes(result.recoveryCodes ?? []);
      setMessage("Passkey active. Save the recovery codes once, then close them.");
      await loadSecurity();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Passkey setup stopped."); }
    finally { setBusy(false); }
  }

  async function revokeSession(id: string) {
    const response = await fetch("/api/admin/passkeys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: id }) });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "That device is signed out." : result.error ?? "The device could not be signed out.");
    if (response.ok) await loadSecurity();
  }

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

  return <div className="account-security-stack"><section className="passkey-security"><header><div><b>Passkeys & devices</b><small>{passkeys.length ? "Phishing-resistant sign-in is active." : "Add a passkey before the clipboard bandits get ideas."}</small></div><button type="button" onClick={() => void addPasskey()} disabled={busy}>{busy ? "Opening device…" : passkeys.length ? "Add another" : "Add passkey"}</button></header>
    {passkeys.map((passkey) => <article key={passkey.id}><span><b>{passkey.label}</b><small>{passkey.backedUp ? "Synced passkey" : passkey.deviceType.replaceAll("-", " ")} · Added {new Date(passkey.createdAt).toLocaleDateString("en-GH")}</small></span><i>{passkey.lastUsedAt ? `Used ${new Date(passkey.lastUsedAt).toLocaleDateString("en-GH")}` : "New"}</i></article>)}
    <details><summary>Active devices · {sessions.length}</summary>{sessions.map((item) => <article key={item.id}><span><b>{item.id === currentSessionId ? "This device" : item.deviceLabel ?? "Staff device"}</b><small>Seen {new Date(item.lastSeenAt).toLocaleString("en-GH")} · {item.mfaVerifiedAt ? "Passkey verified" : "Password session"}</small></span>{item.id !== currentSessionId ? <button type="button" onClick={() => void revokeSession(item.id)}>Sign out</button> : null}</article>)}</details>
    <p>{recoveryCodesRemaining} unused recovery codes</p>
  </section>
  {recoveryCodes.length ? <section className="recovery-codes"><header><b>Save these once</b><button type="button" onClick={() => setRecoveryCodes([])}>I saved them</button></header><p>Each code works once. Keep them somewhere safer than the group chat.</p><div>{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div></section> : null}
  <form className="account-security" onSubmit={submit}>
    {mustChangePassword ? <p className="ops-message">Change the temporary password before opening your workspace.</p> : null}
    <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
    <small>Use 12 or more characters with upper-case, lower-case and a number.</small>
    <button disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
  </form>{message ? <p className="ops-message" role="status">{message}</p> : null}</div>;
}
