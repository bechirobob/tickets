import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { allowedWorkspaceReturn, readAdminSession, safeReturnTo } from "../../lib/admin-session";
import AdminLoginPage from "../admin/login/page";
import "../../styles/workspace.css";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function StaffEntryPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const session = await readAdminSession((await headers()).get("cookie"));
  if (session) {
    const requested = (await searchParams).returnTo;
    redirect(session.mustChangePassword ? "/admin/account" : allowedWorkspaceReturn(session.role, safeReturnTo(typeof requested === "string" ? requested : undefined)));
  }
  return <AdminLoginPage />;
}
