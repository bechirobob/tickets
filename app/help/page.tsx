import BrandLogo from "../brand-logo";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import HelpCentre from "./help-centre";
import PublicNavigation from "../mobile-navigation";

export default function HelpPage() {
  return (
    <main className="help-page">
      <header>
        <Link href="/" aria-label="Back to the Drop"><ArrowLeft size={16} /><span className="support-back-label">Back to the Drop</span></Link>
        <Link href="/" className="night-brand-link"><BrandLogo /></Link>
        <PublicNavigation />
      </header>
      <HelpCentre />
    </main>
  );
}
