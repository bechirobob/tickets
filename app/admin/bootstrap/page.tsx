import Link from "next/link";
import { redirect } from "next/navigation";
import BootstrapForm from "./bootstrap-form";

export const dynamic = "force-dynamic";

export default async function BootstrapPage() {
  const { env } = await import("cloudflare:workers");
  const accountCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_accounts").first<{ count: number }>();
  if ((accountCount?.count ?? 0) > 0) redirect("/admin/login");
  return <main className="admin-login"><section>
    <Link href="/">BeCore Tickets</Link>
    <p className="admin-login__eyebrow">One-time owner setup</p>
    <h1>Replace the shared key.</h1>
    <p>Use the current access key once to create the first named owner. This setup closes permanently after the account is written.</p>
    <BootstrapForm />
  </section></main>;
}
