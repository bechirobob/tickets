'use client';
import { useRef, useState, type FormEvent } from 'react';
import { I18nProvider } from 'react-aria-components';
import { ArrowLeft, ArrowRight, Search, X } from 'lucide-react';
import BrandLogo from '../../brand-logo';
import { Button } from '@/components/boardui/components/base/buttons/button';
import { Input } from '@/components/boardui/components/base/input/input';
import { Pagination } from '@/components/boardui/components/base/pagination/pagination';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/boardui/components/base/table/table';
const events = [
  { id: 'friday', title: 'Friday after hours', date: '13 Nov 2026 · 8 pm', venue: 'The Courtyard, Accra', status: 'Published', assigned: true, lineup: 'Ama & friends', map: 'https://example.test/courtyard', records: 120 },
  { id: 'listening', title: 'The listening room', date: '20 Nov 2026 · 7 pm', venue: 'Studio Eight, Accra', status: 'Published', assigned: true, lineup: 'Kojo and the selectors', map: 'https://example.test/studio-eight', records: 48 },
  { id: 'saturday', title: 'Saturday sessions', date: '21 Nov 2026 · 9 pm', venue: 'The Terrace, Accra', status: 'Published', assigned: false, lineup: 'Esi live', map: 'https://example.test/terrace', records: 64 },
];
const names = ['Ama Mensah', 'Kojo Owusu', 'Akua Boateng', 'Kofi Asante', 'Esi Quartey', 'Yaw Osei'];
function recordsFor(eventId: string, count: number) { return Array.from({ length: count }, (_, i) => ({ id: `${eventId}-${i + 1}`, name: `${names[i % names.length]} ${String(i + 1).padStart(3, '0')}`, email: `${eventId}${i + 1}@example.test`, kind: i % 3 === 0 ? 'RSVP' : 'Paid ticket', status: i % 3 === 0 ? 'Confirmed' : 'Paid', arrivals: i % 4 === 0 ? 1 : 0, admissions: 1, amount: i % 3 === 0 ? 0 : 150 })); }
type Guest = ReturnType<typeof recordsFor>[number];
type View = 'overview' | 'details' | 'guests' | 'team';
function EventDetails({ event, onSaved }: { event: typeof events[number]; onSaved: (fields: { venue: string; map: string; lineup: string }) => void }) {
  const [venue, setVenue] = useState(event.venue), [map, setMap] = useState(event.map), [lineup, setLineup] = useState(event.lineup);
  const [errors, setErrors] = useState<{ venue?: string; map?: string; lineup?: string }>({});
  const [message, setMessage] = useState('');
  const venueRef = useRef<HTMLInputElement>(null), mapRef = useRef<HTMLInputElement>(null), lineupRef = useRef<HTMLInputElement>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    let validMap = false; try { validMap = ['https:', 'http:'].includes(new URL(map).protocol); } catch { /* Invalid URL stays invalid. */ }
    const next = { venue: !venue.trim() ? 'Enter the venue.' : undefined, map: !validMap ? 'Enter a complete http or https map link.' : undefined, lineup: !lineup.trim() ? 'Enter the line-up.' : undefined };
    setErrors(next); if (next.venue || next.map || next.lineup) { (next.venue ? venueRef : next.map ? mapRef : lineupRef).current?.focus(); return; }
    onSaved({ venue: venue.trim(), map, lineup: lineup.trim() }); setMessage('Event details saved in this preview.');
  }
  function discard() { setVenue(event.venue); setMap(event.map); setLineup(event.lineup); setErrors({}); setMessage('Unsaved changes discarded.'); venueRef.current?.focus(); }
  return <section aria-labelledby="details-title"><h2 id="details-title">Venue & line-up</h2><p className="workspace-subtitle">The existing host controls, grouped into one short form.</p><form className="workspace-details-form" noValidate onSubmit={save}>
    <Input ref={venueRef} label="Venue" value={venue} onChange={setVenue} isRequired validationBehavior="aria" isInvalid={Boolean(errors.venue)} hint={errors.venue} fieldClassName="trial-input" />
    <Input ref={mapRef} label="Map link" type="url" value={map} onChange={setMap} isRequired validationBehavior="aria" isInvalid={Boolean(errors.map)} hint={errors.map} fieldClassName="trial-input" />
    <Input ref={lineupRef} label="Line-up" value={lineup} onChange={setLineup} isRequired validationBehavior="aria" isInvalid={Boolean(errors.lineup)} hint={errors.lineup} fieldClassName="trial-input" />
    <div className="trial-form-actions"><Button variant="secondary" onClick={discard}>Discard changes</Button><Button type="submit" className="trial-primary">Save event details</Button></div><p role="status" className="trial-notice">{message || 'Fictional event. Changes reset when you reload.'}</p>
  </form></section>;
}
export default function WorkspaceTrial() {
  const [role, setRole] = useState('owner'), [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<View>('overview');
  const [details, setDetails] = useState<Record<string, { venue: string; map: string; lineup: string }>>({});
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [page, setPage] = useState(1);
  const [guest, setGuest] = useState<Guest | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null), trigger = useRef<HTMLElement | null>(null);
  const visibleEvents = events.filter(e => role === 'owner' || e.assigned);
  const selected = visibleEvents.find(e => e.id === selectedId);
  const event = selected ? { ...selected, ...details[selected.id] } : null;
  const allRecords = selected ? recordsFor(selected.id, selected.records) : [];
  const filtered = allRecords.filter(g => `${g.name} ${g.email} ${g.id}`.toLowerCase().includes(query.trim().toLowerCase()) && (kind === 'all' || g.kind === kind));
  const rows = filtered.slice((page - 1) * 10, page * 10);
  function openEvent(id: string) { setSelectedId(id); setView('overview'); setQuery(''); setKind('all'); setPage(1); }
  function openGuest(record: Guest, button: HTMLElement) { trigger.current = button; setGuest(record); dialog.current?.showModal(); requestAnimationFrame(() => close.current?.focus()); }
  return <I18nProvider locale="en-GB"><main className="boardui-trial workspace-trial yorke-trial">
    <header className="trial-header"><BrandLogo /><span>Workspace trial · fictional data</span></header>
    <div className="workspace-shell"><aside className="workspace-sidebar"><label className="trial-filter">Preview role<select aria-label="Preview role" value={role} onChange={e => { setRole(e.target.value); setSelectedId(''); setView('overview'); setQuery(''); setPage(1); }}><option value="owner">Owner</option><option value="organizer">Organiser</option></select></label><nav aria-label="Workspace areas"><Button variant="ghost" onClick={() => setSelectedId('')} aria-current={!event ? 'page' : undefined}>Events</Button>{role === 'owner' ? <a href="/boardui-trial/yorke-way">Yorke Way early access <ArrowRight size={15} aria-hidden /></a> : null}</nav><p>Role examples only. This preview does not grant or change access.</p></aside>
    <section className="workspace-content" aria-label="Event workspace">
      {!event ? <><div className="trial-heading"><div><p className="trial-eyebrow">{role === 'owner' ? 'Owner workspace' : 'Your workspace'}</p><h1>{role === 'owner' ? 'Events at a glance' : 'Your events'}</h1><p>{role === 'owner' ? 'Move from the event to the work that needs doing.' : 'Only events assigned to this fictional organiser.'}</p></div></div>
      <div className="workspace-event-list">{visibleEvents.map(e => <article key={e.id}><div><p className="trial-eyebrow">{e.status} · {e.date}</p><h2>{e.title}</h2><p>{details[e.id]?.venue ?? e.venue}</p><small>{e.records} booking & guest records</small></div><Button variant="secondary" trailingIcon={ArrowRight} onClick={() => openEvent(e.id)} aria-label={`Manage ${e.title}`}>Manage event</Button></article>)}</div><p className="trial-notice">Representative workspace flows. Money, Promote, Room & VIP, account security and platform approvals remain in the broader evaluation plan.</p></> : <>
      <Button variant="ghost" leadingIcon={ArrowLeft} onClick={() => setSelectedId('')}>All events</Button><div className="trial-heading workspace-event-heading"><div><p className="trial-eyebrow">{event.status} · {event.date}</p><h1>{event.title}</h1><p>{event.venue}</p></div></div>
      <nav className="workspace-event-tabs" aria-label="Event tools">{(['overview', 'details', 'guests', 'team'] as const).map(id => <Button key={id} variant="ghost" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{({ overview: 'Overview', details: 'Details', guests: 'Guests & orders', team: 'Team invitations' })[id]}</Button>)}</nav>
      {view === 'overview' ? <><h2>Before doors open</h2><div className="workspace-tasks"><article><div><h3>Guest desk</h3><p>{event.records} booking & guest records. Paid tickets and RSVPs stay distinct.</p></div><Button variant="secondary" onClick={() => setView('guests')}>Open guest desk</Button></article><article><div><h3>Venue & line-up</h3><p>{event.lineup}</p></div><Button variant="secondary" onClick={() => setView('details')}>Review details</Button></article><article><div><h3>People behind the night</h3><p>Check invitation acceptance separately from email delivery.</p></div><Button variant="secondary" onClick={() => setView('team')}>Review team</Button></article></div></> : null}
      {view === 'details' ? <EventDetails key={event.id} event={event} onSaved={fields => setDetails(current => ({ ...current, [event.id]: fields }))} /> : null}
      {view === 'guests' ? <><h2>Guest desk</h2><div className="yorke-list-controls workspace-guest-controls"><Input label="Find a booking or guest" leadingIcon={Search} placeholder="Name, email or reference" value={query} onChange={value => { setQuery(value); setPage(1); }} fieldClassName="trial-input" /><label className="trial-filter"><span id="record-type-label">Record type</span><select aria-labelledby="record-type-label" value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="all">All records</option><option value="Paid ticket">Paid tickets</option><option value="RSVP">RSVPs</option></select></label></div><div className="trial-summary"><p role="status">{filtered.length} {filtered.length === 1 ? 'record' : 'records'}{filtered.length ? ` · ${(page - 1) * 10 + 1}–${Math.min(page * 10, filtered.length)}` : ''}</p></div><Table aria-label="Booking and guest records" size="sm"><TableHeader><TableColumn isRowHeader>Guest</TableColumn><TableColumn>Booking</TableColumn><TableColumn><span className="sr-only">Actions</span></TableColumn></TableHeader><TableBody renderEmptyState={() => <div className="trial-empty">No matching records.</div>}>{rows.map(g => <TableRow key={g.id} id={g.id}><TableCell><span className="trial-name">{g.name}</span><span className="trial-email">{g.email}</span></TableCell><TableCell><span className="trial-name workspace-record-kind">{g.kind}</span><span className="trial-email">{g.status}</span></TableCell><TableCell><Button variant="ghost" aria-label={`Open ${g.name}`} onClick={e => openGuest(g, e.currentTarget)}>Open</Button></TableCell></TableRow>)}</TableBody></Table><div className="trial-pagination"><Pagination page={page} totalPages={Math.max(1, Math.ceil(filtered.length / 10))} onChange={setPage} /></div></> : null}
      {view === 'team' ? <><h2>Team invitations</h2><p className="workspace-subtitle">A co-host invite is not a guest invitation or an early-access subscription.</p><div className="workspace-team-list"><article><div><h3>Ama · Co-host</h3><p>cohost@example.test</p></div><div><b>Accepted</b><small>Event, guests and reports</small></div></article><article><div><h3>Kojo · Door staff</h3><p>door@example.test</p></div><div><b>Delivered · awaiting acceptance</b><small>Expires 3 Nov 2026 · 12:00 Accra</small></div></article><article><div><h3>Esi · Door staff</h3><p>entry@example.test</p></div><div><b>Email needs attention</b><small>Not accepted</small></div></article></div><p className="trial-notice">Read-only examples. In the existing flow, only the lead host can manage the team. Sending, resending, withdrawing invitations and changing access are outside this preview.</p></> : null}
      </>}
    </section></div>
    <dialog ref={dialog} className="trial-dialog" aria-labelledby="booking-title" onClose={() => trigger.current?.focus()} onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); close.current?.focus(); } }}>
      <div className="trial-dialog-heading"><div><p className="trial-eyebrow">{guest?.kind} · {event?.title}</p><h2 id="booking-title">{guest?.name}</h2></div><Button ref={close} variant="ghost" iconOnly leadingIcon={X} aria-label="Close record" onClick={() => dialog.current?.close()} /></div>
      {guest ? <><dl className="yorke-record"><div><dt>Email</dt><dd>{guest.email}</dd></div><div><dt>Reference</dt><dd>{guest.id}</dd></div><div><dt>Booking state</dt><dd>{guest.status}</dd></div><div><dt>Arrival</dt><dd>{guest.arrivals} / {guest.admissions} checked in</dd></div><div><dt>Ticket value</dt><dd>GHS {guest.amount.toFixed(2)}</dd></div></dl><p className="yorke-scope">Fictional record, read-only. Resending access and refund-review requests are not connected in this preview.</p></> : null}
    </dialog>
  </main></I18nProvider>;
}
