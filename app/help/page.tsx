import BrandLogo from "../brand-logo";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import HelpCentre from "./help-centre";
import PublicNavigation from "../mobile-navigation";

export default function HelpPage() {
  return (
    <main className="help-page">
      <header>
        <Link href="/"><ArrowLeft size={16} /> Back to the Drop</Link>
        <Link href="/" className="night-brand-link"><BrandLogo /></Link>
        <PublicNavigation />
      </header>
      <HelpCentre />
    </main>
  );
}
