import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readAdminSession } from "../../../lib/admin-session";
import BrandLogo from "../../brand-logo";
import Link from "next/link";
import PublicNavigation from "../../mobile-navigation";
import { LogIn, Ticket, UsersRound, BarChart3 } from "lucide-react";
import PartySubmissionForm from "./submission-form";
import "./submit-box-office.css";

export const dynamic = "force-dynamic";

export default async function SubmitPartyPage() {
  const session = await readAdminSession((await headers()).get("cookie"));
  if (session && ["owner", "organizer"].includes(session.role)) redirect("/organizer/workspace?area=submit");
  return (
    <main className="submission-page submission-page--box-office">
      <header className="submission-header">
        <Link href="/" className="night-brand-link"><BrandLogo /></Link>
        <nav className="submission-header__actions" aria-label="Organiser access">
          <Link href="/organizer/workspace" className="submission-header__signin"><LogIn size={14} aria-hidden="true" /> <span>Organiser sign in</span></Link>
          <PublicNavigation />
        </nav>
      </header>
      <div className="submission-box-office">
        <section className="submission-box-office__intro" aria-labelledby="list-your-event-title">
          <p className="night-kicker">For organisers</p>
          <h1 id="list-your-event-title">List your event</h1>
          <p>Bring the plan. We’ll help with tickets, the guest list and getting everyone through the door.</p>
        </section>
        <div className="submission-body" id="submit-your-night">
          <PartySubmissionForm />
          <aside className="submission-guide" aria-labelledby="submission-guide-title">
            <p className="night-kicker">From the first invite to the last guest</p>
            <h2 id="submission-guide-title">What happens next</h2>
            <ol>
              <li><b>Send the plan</b><span>Have your venue, dates, line-up and flyer ready.</span></li>
              <li><b>We’ll take a look</b><span>We’ll review the details before anything goes live.</span></li>
              <li><b>Get ready for The Drop</b><span>Approved events get a private organiser workspace.</span></li>
            </ol>
            <details>
              <summary>What you get as an organiser</summary>
              <ul className="submission-guide__features">
                <li><Ticket size={17} aria-hidden="true" /><span>Tickets and RSVPs with one link to share.</span></li>
                <li><UsersRound size={17} aria-hidden="true" /><span>Guest updates, The Room and entry tools.</span></li>
                <li><BarChart3 size={17} aria-hidden="true" /><span>Sales, promoter results and arrivals in one place.</span></li>
              </ul>
            </details>
            <Link href="/help">Need a hand? Visit help</Link>
          </aside>
        </div>
      </div>
    </main>
  );
}
