import Link from "next/link";
import type { Metadata } from "next";
import BrandLogo from "../../brand-logo";
import ActivationForm from "./activation-form";
import "../../admin/recover/recovery.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your host dashboard · BeCore Tickets", robots: { index:false, follow:false }, referrer:"no-referrer" };
export default function ActivationPage() {
  return <main className="admin-login admin-recovery"><section>
    <Link href="/" className="night-brand-link"><BrandLogo /></Link>
    <p className="admin-login__eyebrow">Your host dashboard</p>
    <h1>You’re on the list.</h1>
    <p>One password, your own space. Let’s get you in.</p>
    <ActivationForm />
  </section></main>;
}
