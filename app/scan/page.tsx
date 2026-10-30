import Scanner from "./scanner";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AdminLoginForm from "../admin/login/login-form";
import ScannerAccount from "./scanner-account";
import Link from "next/link";
import { readAdminSession, hasPermission, requireAdminSession } from "../../lib/admin-auth";
import { getPublicEvents } from "../events";

export const dynamic = "force-dynamic";

export default async function ScanPage({ searchParams, scannerOnly = false }: { searchParams: Promise<{ event?: string; source?: string }>; scannerOnly?: boolean }) {
  const { event: requested, source } = await searchParams;
  if (!scannerOnly && source === "scanner-pwa") redirect(`/scan/app?source=scanner-pwa${typeof requested === "string" && /^[a-z0-9-]{1,80}$/u.test(requested) ? `&event=${encodeURIComponent(requested)}` : ""}`);
  const returnTo = typeof requested === "string" && /^[a-z0-9-]{1,80}$/u.test(requested) ? `/scan?event=${encodeURIComponent(requested)}` : "/scan";
  const currentSession = scannerOnly ? await readAdminSession((await headers()).get("cookie")) : null;
  if (scannerOnly && !currentSession) return <main className="admin-login scanner-login"><section>
    <p className="admin-login__eyebrow">BeCore Scanner</p><h1>Sign in to scan tickets</h1>
    <p>Use your staff account for your assigned events.</p>
    <AdminLoginForm fixedReturnTo={`${returnTo}${returnTo.includes("?") ? "&" : "?"}source=scanner-pwa`} />
    <Link href="/scan/install">Install scanner app</Link>
  </section></main>;
  if (scannerOnly && currentSession && !hasPermission(currentSession, "gate.scan")) return <main className="admin-login scanner-login"><section>
    <h1>Scanner access required</h1><p>This account does not have ticket scanning access. Ask your event organiser to assign gate access.</p>
    <ScannerAccount actor={currentSession.actor} />
  </section></main>;
  if (scannerOnly && currentSession?.mustChangePassword) redirect("/admin/account?source=scanner-pwa");
  const session = await requireAdminSession(returnTo, "gate.scan");
  const allEvents = await getPublicEvents();
  let events = allEvents;
  if (session.role !== "owner") {
    const { env } = await import("cloudflare:workers");
    const assignments = await env.DB.prepare("SELECT event_slug AS eventSlug FROM staff_event_assignments WHERE account_id = ?")
      .bind(session.accountId).all<{ eventSlug: string }>();
    const allowed = new Set(assignments.results.map((item) => item.eventSlug));
    events = allEvents.filter((event) => allowed.has(event.slug));
  }
  return <Scanner scannerOnly={scannerOnly} key={session.sessionId} actor={session.actor} role={session.role} access={{ accountId: session.accountId, sessionId: session.sessionId, expiresAt: session.expiresAt }} initialEvent={events.some(event => event.slug === requested) ? requested : undefined} events={events.map(({ slug, title, fullDate, venue }) => ({ slug, title, fullDate, venue }))} />;
}
