import Link from "next/link";
import type { Metadata } from "next";
import RecoveryForm from "./recovery-form";
import "./recovery.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Restore owner access · BeCore Tickets", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function RecoveryPage() {
  return <main className="admin-login admin-recovery"><section>
    <Link href="/">BeCore Tickets</Link>
    <p className="admin-login__eyebrow">Private owner setup</p>
    <h1>Back on the list.</h1>
    <p>Choose a fresh password for your existing owner account. Your old password and signed-in sessions won’t carry over.</p>
    <RecoveryForm />
  </section></main>;
}
