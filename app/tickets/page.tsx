import Link from "next/link";
import { ArrowLeft, CalendarDays, MapPin, Ticket } from "lucide-react";

export default function TicketsPage() {
  return <main className="wallet-page"><header><Link href="/"><ArrowLeft size={17} /> Back to the shortlist</Link><span className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></span><span /></header><section><Ticket size={38} /><p className="eyebrow">Your ticket wallet</p><h1>Your plans, minus the group-chat archaeology.</h1><p>Use the email or phone number from checkout. We&apos;ll find the ticket faster than your friend finds the confirmation screenshot.</p><form><input type="email" placeholder="Email address" /><button>Find the evidence</button></form><article><div><small>Next good decision</small><h2>After Dark: Osu</h2><p><CalendarDays size={15} /> Fri, 21 Aug · 10:00 PM</p><p><MapPin size={15} /> The Treehouse, Osu</p></div><b>Demo ticket</b></article></section></main>;
}
