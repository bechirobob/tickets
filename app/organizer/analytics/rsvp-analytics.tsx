'use client';

import { useState } from 'react';
import type { RsvpAnalytics } from '../../../lib/rsvp-analytics';

const statusLabels: Record<string, string> = { requested: 'Waiting for approval', confirmed: 'Confirmed', waitlisted: 'Waitlisted', cancelled: 'Cancelled', declined: 'Declined', unverified: 'Unverified' };
const statuses = ['requested', 'confirmed', 'waitlisted', 'cancelled', 'declined', 'unverified'];

export default function RsvpReport({ data, eventSlug }: { data: RsvpAnalytics; eventSlug: string }) {
  const [source, setSource] = useState('becore');
  const [notice, setNotice] = useState('');
  const options = [
    { value: 'becore', label: 'BeCore Tickets' }, { value: 'instagram', label: 'Instagram' }, { value: 'kofi-bills', label: 'Kofi Bills' },
    ...data.promoterLinks.filter(row => row.eventSlug === eventSlug).map(row => ({ value: `promoter:${row.code}`, label: `Promoter · ${row.label}` })),
  ];
  const selected = options.some(option => option.value === source) ? source : 'becore';
  const link = eventSlug === 'all' ? '' : `https://tickets.becoreops.com/rsvp/${encodeURIComponent(eventSlug)}?${selected.startsWith('promoter:') ? 'ref=' + encodeURIComponent(selected.slice(9)) : 'source=' + encodeURIComponent(selected)}`;
  async function copy() {
    try { await navigator.clipboard.writeText(link); setNotice('Link copied. Ready for the group chat.'); }
    catch { setNotice('Copy didn’t work. Select the link below and copy it.'); }
  }
  return <section className="rsvp-report" aria-labelledby="rsvp-report-title">
    <header><div><p className="night-kicker">Guest list</p><h2 id="rsvp-report-title">Who’s coming through?</h2></div><span>{data.totals.requests} requests · {data.totals.guests} guests</span></header>
    <p>Requests submitted in your selected period, with their current status and arrivals so far. One request can include several guests.</p>
    <dl className="rsvp-report__totals">
      <div><dt>Confirmed guests</dt><dd>{data.totals.confirmedGuests}</dd></div>
      <div><dt>Checked in</dt><dd>{data.totals.checkedIn}</dd></div>
      <div><dt>Not checked in</dt><dd>{data.totals.awaitingArrival}</dd></div>
      <div><dt>Turnout so far</dt><dd>{data.totals.turnoutPercent === null ? '—' : `${data.totals.turnoutPercent}%`}</dd></div>
    </dl>
    {!data.totals.requests ? <p className="analytics-empty">No RSVP requests in this period. Your guest list will show up here as people sign up.</p> : null}
    <div className="rsvp-report__columns">
      <article><h3>The guest-list picture</h3><dl className="analytics-facts">{statuses.map(status => {
        const row = data.statuses.find(item => item.status === status);
        return <div key={status}><dt>{statusLabels[status]}</dt><dd>{row?.requests ?? 0}<small> · {row?.guests ?? 0} guests</small></dd></div>;
      })}</dl><p>Checked-in guests are already included in confirmed totals. Not checked in doesn’t mean a no-show while the event is still ahead or underway.</p></article>
      <article><h3>Where the crowd found you</h3>{data.sources.length ? <ul className="rsvp-report__sources">{data.sources.map(row => <li key={row.source}><div><b>{row.label}</b><span>{row.requests} requests · {row.guests} guests</span></div><progress max={data.totals.requests || 1} value={row.requests} aria-label={`${row.label}: ${row.requests} of ${data.totals.requests} requests`} /><small>{row.confirmedGuests} confirmed guests · {row.checkedIn} checked in</small></li>)}</ul> : <p>No sources recorded yet.</p>}<p>Sources come from the signup link. Older requests and untagged links stay untracked; forwarded links keep their original label.</p></article>
    </div>
    <details className="rsvp-report__links"><summary>Share a link. See what it brings.</summary>{eventSlug === 'all' ? <p>Choose a Night above to get its tracked RSVP links.</p> : <div><label>Where you’ll share it<select aria-label="Where you’ll share it" value={selected} onChange={event => { setSource(event.target.value); setNotice(''); }}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>RSVP link<input aria-label="RSVP link" readOnly value={link} onFocus={event => event.target.select()} /></label><button type="button" onClick={() => void copy()}>Copy link</button><p role="status">{notice}</p></div>}</details>
  </section>;
}
