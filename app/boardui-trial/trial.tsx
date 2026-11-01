'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { I18nProvider } from 'react-aria-components';
import { Plus, Search, X } from 'lucide-react';
import BrandLogo from '../brand-logo';
import { Button } from '@/components/boardui/components/base/buttons/button';
import { Input } from '@/components/boardui/components/base/input/input';
import { Pagination } from '@/components/boardui/components/base/pagination/pagination';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/boardui/components/base/table/table';

type Guest = { id: number; name: string; email: string; checkedIn: boolean };
const names = ['Ama Mensah', 'Kojo Owusu', 'Akua Boateng', 'Kofi Asante', 'Esi Quartey', 'Yaw Osei', 'Abena Addo', 'Kwame Arthur'];
const initialGuests: Guest[] = Array.from({ length: 2400 }, (_, i) => ({
  id: i + 1,
  name: i === 7 ? 'Nana Adwoa Mensah-Bonsu · Friends of the late-night listening club' : `${names[i % names.length]} ${String(i + 1).padStart(4, '0')}`,
  email: `guest${i + 1}@example.test`, checkedIn: i % 3 === 0,
}));
const pageSize = 12;

export default function Trial() {
  const [guests, setGuests] = useState(initialGuests);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('ticket');
  const [editing, setEditing] = useState<Guest | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [checkedIn, setCheckedIn] = useState(false);
  const [errors, setErrors] = useState<{name?: string; email?: string}>({});
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const submitting = useRef(false);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('en');
    const matches = guests.filter(g => (!term || `${g.name} ${g.email} T-${g.id}`.toLocaleLowerCase('en').includes(term)) && (filter === 'all' || (filter === 'arrived') === g.checkedIn));
      return sort === 'name' ? [...matches].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })) : matches;
  }, [guests, query, filter, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function open(guest: Guest | null, target: HTMLElement) {
    trigger.current = target; submitting.current = false;
    setEditing(guest); setName(guest?.name ?? ''); setEmail(guest?.email ?? '');
    setCheckedIn(guest?.checkedIn ?? false); setErrors({});
    dialog.current?.showModal();
    requestAnimationFrame(() => nameInput.current?.focus());
  }
  function close() { dialog.current?.close(); }
  function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !dialog.current?.open) return;
    const nextErrors = {
      name: name.trim().length < 2 ? 'Enter a name with at least 2 characters.' : name.trim().length > 120 ? 'Keep the name to 120 characters.' : undefined,
      email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email address.' : email.trim().length > 254 ? 'Keep the email to 254 characters.' : undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.email) { (nextErrors.name ? nameInput : emailInput).current?.focus(); return; }
    submitting.current = true;
    const record: Guest = { id: editing?.id ?? Math.max(...guests.map(g => g.id)) + 1, name: name.trim(), email: email.trim(), checkedIn };
    setGuests(current => editing ? current.map(g => g.id === editing.id ? record : g) : [record, ...current]);
    setMessage(editing ? `Saved ${record.name}.` : `Added ${record.name}.`);
    if (!editing) { setQuery(''); setFilter('all'); setSort('ticket'); setPage(1); }
    close();
  }
  return <I18nProvider locale="en-GB"><main className="boardui-trial">
    <header className="trial-header"><BrandLogo /><span>Interface trial · fictional data</span></header>
    <section className="trial-workspace" aria-labelledby="trial-title">
      <div className="trial-heading"><div><p className="trial-eyebrow">Backstage / Friday after hours</p><h1 id="trial-title">Guest list</h1><p>Accra · 13 November · Doors at 8 pm</p></div><Button className="trial-primary" leadingIcon={Plus} onClick={e => open(null, e.currentTarget)}>Add guest</Button></div>
      <div className="trial-toolbar">
        <Input ref={searchInput} label="Search guests" leadingIcon={Search} placeholder="Name, email or ticket number" value={query} onChange={value => { setQuery(value); setPage(1); }} fieldClassName="trial-input" />
        <label className="trial-filter"><span id="arrival-label">Arrival</span><select aria-labelledby="arrival-label" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="all">All guests</option><option value="waiting">Not arrived</option><option value="arrived">Checked in</option></select></label>
        <label className="trial-filter"><span id="sort-label">Sort by</span><select aria-labelledby="sort-label" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="ticket">List order</option><option value="name">Name A–Z</option></select></label>
      </div>
      <div className="trial-summary"><p role="status">{filtered.length.toLocaleString('en-GB')} {filtered.length === 1 ? 'guest' : 'guests'}{filtered.length > 0 && ` · ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)}`}</p>{query || filter !== 'all' ? <Button variant="ghost" onClick={() => { setQuery(''); setFilter('all'); setPage(1); }}>Clear filters</Button> : null}</div>
      <Table aria-label="Guest list" size="sm" containerClassName="trial-table-wrap">
        <TableHeader><TableColumn isRowHeader>Guest</TableColumn><TableColumn>Arrival</TableColumn><TableColumn><span className="sr-only">Actions</span></TableColumn></TableHeader>
        <TableBody renderEmptyState={() => <div className="trial-empty">No guests found. Try another name or clear your filters.</div>}>
          {rows.map(guest => <TableRow key={guest.id} id={guest.id}><TableCell><span className="trial-name">{guest.name}</span><span className="trial-email">{guest.email} <span aria-hidden="true">·</span> T-{guest.id}</span></TableCell><TableCell><span className="trial-arrival">{guest.checkedIn ? 'Checked in' : 'Not arrived'}</span></TableCell><TableCell><Button variant="ghost" aria-label={`Edit ${guest.name}`} onClick={e => open(guest, e.currentTarget)}>Edit</Button></TableCell></TableRow>)}
        </TableBody>
      </Table>
      <div className="trial-pagination"><Pagination page={safePage} totalPages={totalPages} onChange={setPage} /></div>
      <p className="trial-notice" role="status">{message || 'Changes stay in this preview and reset when you reload.'}</p>
    </section>
    <dialog ref={dialog} className="trial-dialog" aria-labelledby="guest-dialog-title" onClose={() => { (trigger.current?.isConnected ? trigger.current : searchInput.current)?.focus(); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="trial-dialog-heading"><div><p className="trial-eyebrow">Friday after hours</p><h2 id="guest-dialog-title">{editing ? 'Edit guest' : 'Add guest'}</h2></div><Button variant="ghost" iconOnly leadingIcon={X} aria-label="Close" onClick={close} /></div>
      {editing && <p className="trial-ticket-id">Ticket T-{editing.id}</p>}
      <form noValidate onSubmit={save}>
        <Input ref={nameInput} label="Name" value={name} onChange={setName} isRequired validationBehavior="aria" isInvalid={Boolean(errors.name)} hint={errors.name} fieldClassName="trial-input" />
        <Input ref={emailInput} label="Email" type="email" value={email} onChange={setEmail} isRequired validationBehavior="aria" isInvalid={Boolean(errors.email)} hint={errors.email} fieldClassName="trial-input" />
        <label className="trial-checkbox"><input type="checkbox" checked={checkedIn} onChange={e => setCheckedIn(e.target.checked)} />Checked in</label>
        <div className="trial-form-actions"><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" className="trial-primary">{editing ? 'Save changes' : 'Add guest'}</Button></div>
      </form>
    </dialog>
  </main></I18nProvider>;
}
