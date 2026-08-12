import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import HelpCentre from "./help-centre";
import PublicNavigation from "../mobile-navigation";

export default function HelpPage() {
  return (
    <main className="help-page">
      <header>
        <Link href="/"><ArrowLeft size={16} /> Back to the Drop</Link>
        <span><LifeBuoy size={16} /> BeCore Help</span>
        <PublicNavigation />
      </header>
      <HelpCentre />
    </main>
  );
}
