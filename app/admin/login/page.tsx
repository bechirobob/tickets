import Link from "next/link";
import AdminLoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  return (
    <main className="admin-login">
      <section>
        <Link href="/">BeCore Tickets</Link>
        <p className="admin-login__eyebrow">Private operations</p>
        <h1>The guest list for the guest list.</h1>
        <p>
          Organiser reviews, publishing and fee controls live here. If you are
          meant to be here, you already know what opens the door.
        </p>
        <AdminLoginForm />
      </section>
    </main>
  );
}
