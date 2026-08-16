import Link from "next/link";
import { ArrowLeft, LogIn } from "lucide-react";
import PartySubmissionForm from "./submission-form";

export default function SubmitPartyPage() {
  return (
    <main className="submission-page">
      <header className="submission-header">
        <Link href="/" className="night-brand-link"><span className="night-brand"><b>B</b><span>BeCore<br />Tickets</span></span></Link>
        <nav className="submission-header__actions" aria-label="Organiser access">
          <Link href="/" className="submission-header__back"><ArrowLeft size={14} /> <span>Back to events</span></Link>
          <Link href="/organizer/workspace" className="submission-header__signin"><LogIn size={14} /> <span>Organiser sign in</span></Link>
        </nav>
      </header>
      <section className="submission-intro">
        <p className="night-kicker"><span /> Party submissions</p>
        <h1>Give us a reason<br />to clear the calendar.</h1>
        <p>We curate parties, not every event with a flyer. Tell us what the night feels like, who is behind it and why guests will be glad they left the house. Approved organisers get a verified workspace with live demand, sales, promoter, entry and VIP insight—not just a final ticket count.</p>
        <div><span>01 · Submit</span><span>02 · BeCore review</span><span>03 · Fix anything fuzzy</span><span>04 · Schedule the drop</span></div>
      </section>
      <PartySubmissionForm />
    </main>
  );
}
