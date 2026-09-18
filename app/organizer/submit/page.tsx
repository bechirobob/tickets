import BrandLogo from "../../brand-logo";
import Link from "next/link";
import PublicNavigation from "../../mobile-navigation";
import { LogIn, Ticket, UsersRound, BarChart3, ArrowUpRight } from "lucide-react";
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
        <div className="submission-intro__copy">
          <p className="night-kicker">For the people behind the party</p>
          <h1>Your crowd.<br />Your night.<br /><em>Make it happen.</em></h1>
          <p>Bring the plan. We’ll help with the guest list, tickets and getting everyone through the door.</p>
          <a className="submission-start" href="#submit-your-night">Let’s plan your night <ArrowUpRight size={18} /></a>
        </div>
        <aside className="submission-benefits" aria-label="For organisers">
          <p>From the first invite to the last guest.</p>
          <div><Ticket size={22} /><span><b>Tickets & RSVP</b><small>A link to share. A guest list to keep up with.</small></span></div>
          <div><UsersRound size={22} /><span><b>Your crowd, together</b><small>Guest updates, The Room and entry tools.</small></span></div>
          <div><BarChart3 size={22} /><span><b>Know what worked</b><small>Sales, promoter results and arrivals in one place.</small></span></div>
          <Link href="/organizer/workspace">Already hosting with us? Sign in <ArrowUpRight size={16} /></Link>
        </aside>
      </section>
      <div className="submission-body" id="submit-your-night">
        <aside className="submission-guide">
          <p className="night-kicker">Bring us your night</p>
          <h2>A good plan<br />gets things moving.</h2>
          <p>Have your venue, dates, line-up and flyer ready. We’ll review the details before anything goes live.</p>
          <ol><li><b>Send the plan</b><span>Tell us who’s behind it and what’s happening.</span></li><li><b>We’ll take a look</b><span>We’ll get in touch if anything needs clearing up.</span></li><li><b>Get ready for the drop</b><span>Approved events get a private organiser workspace.</span></li></ol>
          <Link href="/help">Need a hand? Visit help <ArrowUpRight size={15} /></Link>
        </aside>
        <PartySubmissionForm />
      </div>
    </main>
  );
}
