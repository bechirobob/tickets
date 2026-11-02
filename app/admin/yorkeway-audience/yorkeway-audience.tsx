"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StaffRole } from "../../../lib/staff-roles";
import { operationsFetch } from "../../../lib/operations-client";
import OperationsNav from "../operations-nav";
import { Button } from '@/components/boardui/components/base/buttons/button';
import { Input } from '@/components/boardui/components/base/input/input';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/boardui/components/base/table/table';
import { RecordDialog } from '@/components/workspace/record-dialog';
import './yorkeway-audience.css';

type Contact = { email: string; consentedAt: string; consentVersion: string; name: string };
type Audience = { contacts: Contact[]; summary: { subscribed: number; withdrawn: number }; matching: number; nextCursor: string | null; deliveryEnabled: false };
const joined = (value: string) => new Date(value).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone: 'Africa/Accra' });
export default function YorkewayAudience({ actor, role }: { actor: string; role: StaffRole }) {
  const [data, setData] = useState<Audience | null>(null);
  const [cursors, setCursors] = useState<string[]>(['']);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const cursor = cursors[cursors.length - 1];
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const response = await operationsFetch(`/api/admin/yorkeway-audience?${new URLSearchParams({ after: cursor, q: query })}`, { signal: controller.signal });
      const result = await response.json() as Audience & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Subscribers could not load.');
      if (!controller.signal.aborted) setData(result);
    } catch (cause) {
      if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : 'Subscribers could not load.'); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, [cursor, query]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [load]);
  function search(value: string) { request.current?.abort(); setBusy(true); setQuery(value); setCursors(['']); }
  function paginate(next: string[]) { request.current?.abort(); setBusy(true); setCursors(next); }
  return <main className="ops-page workspace-boardui"><OperationsNav actor={actor} role={role} active="/admin/yorkeway-audience" /><section className="ops-main yorkeway-workspace">
    <header><div><p>Owner workspace</p><h1>Yorke Way early access</h1><p>People who asked to hear about Kofi Bills’ year-end 2026 events.</p></div><Button variant="secondary" disabled={busy} onClick={() => void load()}>Refresh</Button></header>
    <p className="yorkeway-scope">Early-access updates only. This is not an event guest list. Campaign sending is not enabled.</p>
    {data ? <div className="yorkeway-counts"><div><span>Subscribed</span><b>{data.summary.subscribed}</b></div><div><span>Withdrawn</span><b>{data.summary.withdrawn}</b></div></div> : null}
    <div className="workspace-list-controls"><Input label="Search subscribers" type="search" value={query} onChange={search} placeholder="Name or email" fieldClassName="workspace-input" /><span>Sorted by email</span></div>
    {busy ? <p role="status">Loading subscribers…</p> : null}
    {error ? <div role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Try again</Button></div> : null}
    {data && !busy && !error ? <><p role="status">{data.matching} matching subscribers · Page {cursors.length}</p>
      <Table aria-label="Yorke Way subscribers" size="sm"><TableHeader><TableColumn isRowHeader>Subscriber</TableColumn><TableColumn>Joined</TableColumn><TableColumn><span className="sr-only">Actions</span></TableColumn></TableHeader><TableBody renderEmptyState={() => <p className="workspace-empty">No subscribers match this view.</p>}>{data.contacts.map(contact => <TableRow id={contact.email} key={contact.email}><TableCell><span className="workspace-record-name">{contact.name}</span><span className="workspace-record-meta">{contact.email}</span></TableCell><TableCell>{joined(contact.consentedAt)}</TableCell><TableCell><Button variant="ghost" aria-label={`View ${contact.name || contact.email}`} onClick={() => setSelected(contact)}>View</Button></TableCell></TableRow>)}</TableBody></Table>
      <nav className="audience-pagination" aria-label="Subscriber pages"><Button variant="secondary" disabled={cursors.length === 1} onClick={() => paginate(cursors.slice(0, -1))}>Previous</Button><span>Page {cursors.length}</span><Button variant="secondary" disabled={!data.nextCursor} onClick={() => { if (data.nextCursor) paginate([...cursors, data.nextCursor]); }}>Next</Button></nav>
    </> : null}
    {selected ? <RecordDialog label="Subscriber details" onClose={() => setSelected(null)}><header><h2>{selected.name || selected.email}</h2><Button variant="secondary" onClick={() => setSelected(null)}>Close subscriber</Button></header><dl><div><dt>Email</dt><dd>{selected.email}</dd></div><div><dt>Subscribed</dt><dd>{joined(selected.consentedAt)}</dd></div><div><dt>Consent version</dt><dd>{selected.consentVersion}</dd></div></dl><p>Single opt-in. Email ownership is not verified. Consent does not confirm attendance or guarantee entry.</p><p>The owner list is read-only. Campaign sending and provider contact sync are not enabled.</p></RecordDialog> : null}
  </section></main>;
}
