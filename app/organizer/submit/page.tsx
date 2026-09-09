import BrandLogo from "../../brand-logo";
import Link from "next/link";
import PublicNavigation from "../../mobile-navigation";
import { LogIn } from "lucide-react";
import PartySubmissionForm from "./submission-form";

export default function SubmitPartyPage() {
  return (
    <main className="submission-page">
      <header className="submission-header">
        <Link href="/" className="night-brand-link"><BrandLogo /></Link>
        <nav className="submission-header__actions" aria-label="Organiser access">
          <Link href="/organizer/workspace" className="submission-header__signin"><LogIn size={14} /> <span>Organiser sign in</span></Link>
          <PublicNavigation />
        </nav>
      </header>
      <section className="submission-intro">
        <p className="night-kicker"><span /> Party submissions</p>
        <h1>Give us a reason<br />to clear the calendar.</h1>
        <p>Tell us what the night feels like, who’s behind it and why guests will be glad they left the house. Approved organisers get a private workspace for tickets, guest updates, entry and sales. A good flyer helps. A good plan helps more.</p>
        <div><span>01 · Submit</span><span>02 · BeCore review</span><span>03 · Fix anything fuzzy</span><span>04 · Schedule the drop</span></div>
      </section>
      <PartySubmissionForm />
    </main>
  );
}
