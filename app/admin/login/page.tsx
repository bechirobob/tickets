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
        <h1>The guest list for the guest list.</h1>
        <p>
          Your account opens only the work assigned to you. Organiser reviews,
          event operations, finance, gate access and moderation stay separated.
        </p>
        <AdminLoginForm />
      </section>
    </main>
  );
}
