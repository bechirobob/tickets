import Link from "next/link";
import { ArrowLeft, LifeBuoy, ScanLine, Ticket, WalletCards } from "lucide-react";

const help = [
  { icon: Ticket, title: "Find a ticket", text: "Open My Nights with the email used at checkout. Every confirmed purchase comes back together.", href: "/my-nights", label: "Recover My Nights" },
  { icon: ScanLine, title: "At the door", text: "Turn up the ticket brightness, keep the saved offline pass ready, and let staff search the verified purchase if the QR refuses to cooperate.", href: "/terms#purchase", label: "Entry rules" },
  { icon: WalletCards, title: "Refund or new date", text: "Open the purchased Night. Its Purchase tab carries the event state, eligibility and order-linked support conversation.", href: "/terms#refund", label: "Refund terms" },
];

export default function HelpPage() {
  return <main className="help-page"><header><Link href="/"><ArrowLeft size={15} /> Home</Link><span><LifeBuoy size={15} /> Ticket help</span></header><section><p className="eyebrow">Useful before panic</p><h1>Let’s get the night<br />back on track.</h1><div>{help.map(({ icon: Icon, ...item }) => <article key={item.title}><Icon /><h2>{item.title}</h2><p>{item.text}</p><Link href={item.href}>{item.label}</Link></article>)}</div><p className="help-page__contact">Still stuck? Email <a href="mailto:tickets@becoreops.com">tickets@becoreops.com</a> with the purchase email and order reference. Never send a QR screenshot.</p></section></main>;
}
