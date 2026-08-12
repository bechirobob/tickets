"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Loader2, Save, ShieldX, UserPlus } from "lucide-react";
import OperationsNav from "../operations-nav";
import { prepareStaffPassword } from "../../../lib/staff-password-client";
import { STAFF_ROLES, STAFF_ROLE_DEFINITIONS, type StaffRole } from "../../../lib/staff-roles";

type StaffAccount = { id: string; email: string; displayName: string; role: StaffRole; status: "active" | "disabled"; mustChangePassword: number; lastLoginAt: string | null; eventSlugs: string[] };
type EventOption = { slug: string; title: string; startsAt: string };

export default function StaffAccounts({ actor, role }: { actor: string; role: StaffRole }) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("new");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draftRole, setDraftRole] = useState<StaffRole>("organizer");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/accounts", { cache: "no-store" });
    const result = await response.json() as { accounts?: StaffAccount[]; events?: EventOption[]; error?: string };
    if (!response.ok) setMessage(result.error ?? "Accounts could not be loaded.");
    else { setAccounts(result.accounts ?? []); setEvents(result.events ?? []); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch("/api/admin/accounts", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as { accounts?: StaffAccount[]; events?: EventOption[]; error?: string } }))
      .then(({ response, result }) => {
        if (!response.ok) setMessage(result.error ?? "Accounts could not be loaded.");
        else { setAccounts(result.accounts ?? []); setEvents(result.events ?? []); }
        setLoading(false);
      })
      .catch(() => { setMessage("Accounts could not be loaded."); setLoading(false); });
  }, []);
  const selected = useMemo(() => accounts.find((account) => account.id === selectedId) ?? null, [accounts, selectedId]);
  const roleDefinition = STAFF_ROLE_DEFINITIONS[draftRole];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      const temporaryPassword = String(form.get("temporaryPassword") ?? "");
      const password = temporaryPassword ? await prepareStaffPassword(temporaryPassword) : {};
      const body = {
        id: selected?.id,
        displayName: form.get("displayName"), email: form.get("email"), role: form.get("role"), status: form.get("status"),
        temporaryPassword, ...password, eventSlugs: form.getAll("eventSlugs"),
      };
      const response = await fetch("/api/admin/accounts", { method: selected ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; id?: string };
      if (!response.ok) setMessage(result.error ?? "The account could not be saved.");
      else { setMessage(selected ? "Account updated." : "Account created. Share the temporary password through a secure channel."); await load(); if (result.id) setSelectedId(result.id); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The account could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="curation-page staff-page">
    <OperationsNav actor={actor} role={role} active="/admin/accounts" />
    <section className="curation-main"><header><div><p>Named access only</p><h1>People & permissions</h1></div><button onClick={() => { setSelectedId("new"); setDraftRole("organizer"); setMessage(""); }}><UserPlus size={15} /> Add person</button></header>
      {loading ? <div className="curation-empty"><Loader2 className="spin" /> Loading accounts…</div> : <div className="staff-workspace">
        <div className="staff-list">{accounts.map((account) => <button key={account.id} className={selectedId === account.id ? "active" : ""} onClick={() => { setSelectedId(account.id); setDraftRole(account.role); setMessage(""); }}><span>{account.displayName.slice(0, 2).toUpperCase()}</span><b>{account.displayName}</b><small>{STAFF_ROLE_DEFINITIONS[account.role].label} · {account.status}</small></button>)}</div>
        <form key={selected?.id ?? "new"} className="staff-editor" onSubmit={save}>
          <p className="night-kicker"><span /> {selected ? "Account controls" : "New named account"}</p><h2>{selected?.displayName ?? "Add someone to operations"}</h2>
          <div className="ops-grid"><label>Name<input name="displayName" defaultValue={selected?.displayName} required /></label><label>Email<input name="email" type="email" defaultValue={selected?.email} required /></label><label>Role<select name="role" value={draftRole} onChange={(event) => setDraftRole(event.target.value as StaffRole)}>{STAFF_ROLES.map((value) => <option key={value} value={value}>{STAFF_ROLE_DEFINITIONS[value].label}</option>)}</select></label><label>Status<select name="status" defaultValue={selected?.status ?? "active"}><option value="active">Active</option><option value="disabled">Disabled</option></select></label><label className="wide"><KeyRound size={14} /> {selected ? "Reset with temporary password (optional)" : "Temporary password"}<input name="temporaryPassword" type="password" minLength={12} required={!selected} /></label></div>
          <section className="role-boundary" aria-live="polite"><header><span>{roleDefinition.workspace}</span><h3>{roleDefinition.label}</h3><p>{roleDefinition.summary}</p></header><div><section><b><Check size={13} /> Can</b>{roleDefinition.can.map((item) => <p key={item}>{item}</p>)}</section><section><b><ShieldX size={13} /> Cannot</b>{roleDefinition.cannot.map((item) => <p key={item}>{item}</p>)}</section></div></section>
          {roleDefinition.eventScoped ? <fieldset className="staff-events"><legend>Assigned events <small>{draftRole === "organizer" ? "A matching verified submission email links its own Nights automatically; use these checks for additional access." : "This account cannot open any other Night."}</small></legend>{events.length ? events.map((item) => <label key={item.slug}><input name="eventSlugs" value={item.slug} type="checkbox" defaultChecked={selected?.eventSlugs.includes(item.slug)} /><span><b>{item.title}</b><small>{new Date(item.startsAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}</small></span></label>) : <p>No approved events yet.</p>}</fieldset> : null}
          {message ? <p className="ops-message" role="status">{message}</p> : null}<button className="ops-save" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />} {busy ? "Saving…" : "Save access"}</button>
        </form>
      </div>}
    </section>
  </main>;
}
