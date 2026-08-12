import Link from "next/link";
import { redirect } from "next/navigation";
import BootstrapForm from "./bootstrap-form";

export const dynamic = "force-dynamic";

export default async function BootstrapPage() {
  const { env } = await import("cloudflare:workers");
  const accountCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_accounts").first<{ count: number }>();
  if ((accountCount?.count ?? 0) > 0) redirect("/admin/login");
  return <main className="admin-login admin-bootstrap"><section>
    <Link href="/" className="admin-bootstrap__back">BeCore Tickets <span>Back to events</span></Link>
    <p className="admin-login__eyebrow">One-time owner setup</p>
    <h1>Create the first owner.</h1>
    <p>This page closes as soon as the account is created. The one-time setup key authorises this first step; it is not the password you will use later.</p>
    <BootstrapForm />
  </section></main>;
}
