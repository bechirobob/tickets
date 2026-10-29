import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { allowedWorkspaceReturn, readAdminSession, safeReturnTo } from "../../lib/admin-session";
import AdminLoginPage from "../admin/login/page";
import "../../styles/workspace.css";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function StaffEntryPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[]; source?: string | string[] }> }) {
  const session = await readAdminSession((await headers()).get("cookie"));
  if (session) {
    const { returnTo: requested, source } = await searchParams;
    const destination = session.mustChangePassword ? "/admin/account" : allowedWorkspaceReturn(session.role, safeReturnTo(typeof requested === "string" ? requested : undefined));
    if (source === "staff-pwa") {
      const launch = new URL(destination, "https://tickets.becoreops.com");
      launch.searchParams.set("source", "staff-pwa");
      redirect(launch.pathname + launch.search);
    }
    redirect(destination);
  }
  return <AdminLoginPage />;
}
