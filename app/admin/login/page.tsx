import Link from "next/link";
import { redirect } from "next/navigation";
import AdminLoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const { env } = await import("cloudflare:workers");
  const accountCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_accounts").first<{ count: number }>();
  if ((accountCount?.count ?? 0) === 0) redirect("/admin/bootstrap");
  return (
    <main className="admin-login">
      <section>
        <Link href="/">BeCore Tickets</Link>
        <p className="admin-login__eyebrow">Private operations</p>
        <h1>Welcome back.</h1>
        <p>
          Sign in to manage your events and team.
        </p>
        <AdminLoginForm />
      </section>
    </main>
  );
}
