import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CalendarPlus, ChevronDown, CircleDollarSign, MoreHorizontal, ScanLine, TicketCheck, Users } from "lucide-react";

const rows = [
  ["After Dark: Osu", "21 Aug 2026", "426 / 600", "GH₵59,480", "On sale"],
  ["Sunset Social", "23 Aug 2026", "188 / 350", "GH₵28,200", "On sale"],
  ["Warehouse Sessions 004", "28 Aug 2026", "92 / 450", "GH₵9,200", "Draft"],
];

export default function OrganizerPage() {
  return (
    <main className="ops-shell">
      <aside className="ops-sidebar">
        <Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link>
        <nav><b>Workspace</b><Link className="active" href="/organizer">Overview</Link><Link href="/organizer/events">Events</Link><Link href="/organizer/orders">Orders</Link><Link href="/organizer/attendees">Attendees</Link><b>Business</b><Link href="/organizer/payouts">Payouts</Link><Link href="/organizer/promoters">Promoters</Link><Link href="/organizer/settings">Settings</Link></nav>
        <div className="ops-profile"><span>NL</span><div><strong>Nightlife Accra</strong><small>Verified organiser</small></div><ChevronDown size={15} /></div>
      </aside>
      <section className="ops-main">
        <header className="ops-topbar"><div><p>Monday, 10 August</p><h1>Good afternoon, Nana.</h1></div><Link href="/organizer/submit" className="ops-primary"><CalendarPlus size={17} /> Submit a party</Link></header>
        <div className="ops-stats">
          <article><span><TicketCheck size={18} /> Ticket sales</span><strong>706</strong><small className="up"><ArrowUpRight size={14} /> 18.4% this week</small></article>
          <article><span><CircleDollarSign size={18} /> Gross sales</span><strong>GH₵96,880</strong><small className="up"><ArrowUpRight size={14} /> 12.8% this week</small></article>
          <article><span><Users size={18} /> Page visitors</span><strong>8,492</strong><small className="down"><ArrowDownRight size={14} /> 2.1% this week</small></article>
          <article><span><ScanLine size={18} /> Check-ins</span><strong>—</strong><small>Next event in 11 days</small></article>
        </div>
        <section className="ops-panel sales-panel">
          <div className="ops-panel__head"><div><h2>Sales performance</h2><p>Net ticket sales across all live events</p></div><button>Last 30 days <ChevronDown size={15} /></button></div>
          <div className="chart-shell"><div className="chart-labels"><span>GH₵12k</span><span>GH₵8k</span><span>GH₵4k</span><span>GH₵0</span></div><div className="chart-bars">{[24,38,31,48,42,55,49,63,58,72,67,81,76,91].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>
        </section>
        <section className="ops-panel">
          <div className="ops-panel__head"><div><h2>Your events</h2><p>Live performance and capacity</p></div><Link href="/organizer/events">View all <ArrowUpRight size={15} /></Link></div>
          <div className="ops-table"><div className="ops-tr ops-th"><span>Event</span><span>Date</span><span>Tickets sold</span><span>Gross sales</span><span>Status</span><span /></div>{rows.map((row) => <div className="ops-tr" key={row[0]}>{row.map((cell, index) => <span key={cell} className={index === 4 ? `status ${cell === "Draft" ? "draft" : ""}` : ""}>{cell}</span>)}<button aria-label={`Actions for ${row[0]}`}><MoreHorizontal size={17} /></button></div>)}</div>
        </section>
      </section>
    </main>
  );
}
