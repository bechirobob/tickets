import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readAdminSession } from "../../lib/admin-session";
import BrandLogo from "../brand-logo";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import HelpCentre from "./help-centre";
import PublicNavigation from "../mobile-navigation";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const session = await readAdminSession((await headers()).get("cookie"));
  if (session) redirect(session.role === "organizer" ? "/organizer/workspace?area=help" : "/admin/help");
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
