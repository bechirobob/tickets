import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { policies, type PolicyKey } from "../../lib/policies";
import PublicNavigation from "../mobile-navigation";

const order: PolicyKey[] = ["purchase", "refund", "privacy", "community", "organizer"];

export default function TermsPage() {
  return <main className="policy-page">
    <header><Link href="/"><ArrowLeft size={15} /> Back home</Link><span><ShieldCheck size={15} /> Clear terms, no fog machine</span><PublicNavigation /></header>
    <section className="policy-page__intro"><p className="eyebrow">The practical agreement</p><h1>Tickets, people and money.<br />Here is how they behave.</h1><p>Compact enough to read. Exact enough to operate. The version accepted at checkout stays attached to the order.</p></section>
    <div className="policy-page__sections">{order.map((key) => { const policy = policies[key]; return <section id={key} key={key}><header><span>{policy.version}</span><h2>{policy.title}</h2><p>{policy.summary}</p></header><ul>{policy.points.map((point) => <li key={point}>{point}</li>)}</ul></section>; })}</div>
    <footer><Link href="/privacy">Full privacy notice</Link><a href="mailto:tickets@becoreops.com">tickets@becoreops.com</a></footer>
  </main>;
}
