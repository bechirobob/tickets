import Link from "next/link";
import BrandLogo from "./brand-logo";
import PublicNavigation from "./mobile-navigation";

export default function BoxOfficeHeader() {
  return <header className="night-header box-office-header">
    <Link href="/" className="night-brand-link"><BrandLogo prominent /></Link>
    <div className="night-header__actions">
      <nav className="night-desktop-links" aria-label="Explore"><Link href="/events">The Drop</Link><Link href="/hosts">Hosts</Link><Link href="/my-nights">My Nights</Link></nav>
      <span className="night-city">Accra, GH</span>
      <PublicNavigation primaryVisible />
    </div>
  </header>;
}
