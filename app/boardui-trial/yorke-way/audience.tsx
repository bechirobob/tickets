'use client';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { I18nProvider } from 'react-aria-components';
import { Search, X, ArrowLeft, ArrowUpRight } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/boardui/components/base/buttons/button';
import { Input } from '@/components/boardui/components/base/input/input';
import { Pagination } from '@/components/boardui/components/base/pagination/pagination';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/boardui/components/base/table/table';

const consent = 'Email me early-access updates about Kofi Bills’ events through the end of 2026. I can unsubscribe at any time.';
const version = 'yorkeway-year-end-2026-v1';
const names = ['Ama Mensah', 'Kojo Owusu', 'Akua Boateng', 'Kofi Asante', 'Esi Quartey', 'Yaw Osei', 'Abena Addo', 'Kwame Arthur'];
const contacts = Array.from({ length: 600 }, (_, index) => ({
  id: index + 1,
  name: index === 599 ? 'Nana Adwoa Mensah-Bonsu · A long fictional subscriber name' : `${names[index % names.length]} ${String(index + 1).padStart(3, '0')}`,
  email: `yorke${index + 1}@example.test`,
  consentedAt: new Date(Date.UTC(2026, 9, 1, 12) + index * 3600_000).toISOString(),
  consentVersion: version,
}));
type Contact = typeof contacts[number];
const date = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Accra' }).format(new Date(value));

export default function YorkeAudienceTrial() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Contact | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return contacts.filter(c => `${c.name} ${c.email}`.toLowerCase().includes(term)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'en', { numeric: true }) : b.consentedAt.localeCompare(a.consentedAt));
  }, [query, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  function open(contact: Contact, element: HTMLElement) {
    trigger.current = element; setSelected(contact); dialog.current?.showModal();
    requestAnimationFrame(() => closeButton.current?.focus());
  }
  function trap(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <I18nProvider locale="en-GB"><main className="boardui-trial yorke-trial">
    <header className="trial-header"><div className="yorke-trial-brand"><Image src="/hosts/the-yorke-way.svg" alt="" width={48} height={48} unoptimized /><div><b>The Yorke Way</b><small>Sponsored by BeCore Tickets</small></div></div><span>Interface trial · fictional data</span></header>
    <section className="trial-workspace" aria-labelledby="yorke-list-title">
      <nav className="yorke-trial-nav" aria-label="Trial work areas"><a href="/boardui-trial/workspace"><ArrowLeft size={16} aria-hidden />Workspace preview</a><span aria-current="page">Yorke Way</span></nav>
      <div className="trial-heading"><div><p className="trial-eyebrow">Owner workspace / Year-end 2026</p><h1 id="yorke-list-title">Early-access list</h1><p>People who asked to hear about Kofi Bills’ events.</p></div><a className="yorke-preview-link" href="/boardui-trial/yorke-way/signup">Preview signup <ArrowUpRight size={16} aria-hidden /></a></div>
      <dl className="yorke-trial-counts"><div><dt>Subscribed</dt><dd>600</dd></div><div><dt>Withdrawn</dt><dd>18</dd></div></dl>
      <p className="yorke-scope">Early-access updates only. This is not an event guest list. Campaign sending is not enabled.</p>
      <div className="yorke-list-controls"><Input label="Search subscribers" leadingIcon={Search} placeholder="Name or email" value={query} onChange={value => { setQuery(value); setPage(1); }} fieldClassName="trial-input" /><label className="trial-filter"><span id="yorke-sort-label">Sort by</span><select aria-labelledby="yorke-sort-label" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="newest">Newest signup</option><option value="name">Name A–Z</option></select></label></div>
      <div className="trial-summary"><p role="status">{filtered.length} {filtered.length === 1 ? 'subscriber' : 'subscribers'}{filtered.length > 0 ? ` · ${(currentPage - 1) * 10 + 1}–${Math.min(currentPage * 10, filtered.length)}` : ''}</p>{query ? <Button variant="ghost" onClick={() => { setQuery(''); setPage(1); }}>Clear search</Button> : null}</div>
      <Table aria-label="Yorke Way subscribers" size="sm"><TableHeader><TableColumn isRowHeader>Subscriber</TableColumn><TableColumn>Joined</TableColumn><TableColumn><span className="sr-only">Actions</span></TableColumn></TableHeader><TableBody renderEmptyState={() => <div className="trial-empty">No subscribers found. Try another name or email.</div>}>
        {rows.map(contact => <TableRow key={contact.id} id={contact.id}><TableCell><span className="trial-name">{contact.name}</span><span className="trial-email">{contact.email}</span></TableCell><TableCell><time dateTime={contact.consentedAt} className="yorke-date">{date(contact.consentedAt)}</time></TableCell><TableCell><Button variant="ghost" aria-label={`View ${contact.name}`} onClick={e => open(contact, e.currentTarget)}>View</Button></TableCell></TableRow>)}
      </TableBody></Table>
      <div className="trial-pagination"><Pagination page={currentPage} totalPages={totalPages} onChange={setPage} /></div>
      <p className="trial-notice">Fictional subscribers. The existing owner list is read-only; email ownership is not verified.</p>
    </section>
    <dialog className="trial-dialog" ref={dialog} aria-labelledby="subscriber-title" onClose={() => trigger.current?.focus()} onKeyDown={trap}>
      <div className="trial-dialog-heading"><div><p className="trial-eyebrow">Subscriber details</p><h2 id="subscriber-title">{selected?.name}</h2></div><Button ref={closeButton} variant="ghost" iconOnly leadingIcon={X} aria-label="Close subscriber" onClick={() => dialog.current?.close()} /></div>
      {selected && <><dl className="yorke-record"><div><dt>Email</dt><dd>{selected.email}</dd></div><div><dt>Subscribed</dt><dd>{date(selected.consentedAt)} · {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' }).format(new Date(selected.consentedAt))} Accra</dd></div><div><dt>Consent version</dt><dd>{selected.consentVersion}</dd></div></dl><h3 className="yorke-record-heading">What they agreed to</h3><p className="yorke-consent-copy">{consent}</p><p className="yorke-scope">Single opt-in. Email ownership is not verified. Consent does not confirm attendance or guarantee entry.</p></>}
      <div className="trial-form-actions"><Button variant="secondary" onClick={() => dialog.current?.close()}>Done</Button></div>
    </dialog>
  </main></I18nProvider>;
}
