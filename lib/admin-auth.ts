import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  defaultWorkspace,
  hasPermission,
  readAdminSession,
  safeReturnTo,
  type AdminSession,
  type StaffPermission,
} from "./admin-session";

export * from "./admin-session";

export async function requireAdminSession(returnTo: string, permission?: StaffPermission): Promise<AdminSession> {
  const requestHeaders = await headers();
  const session = await readAdminSession(requestHeaders.get("cookie"));
  if (session?.mustChangePassword && returnTo !== "/admin/account") redirect("/admin/account");
  if (session && (!permission || hasPermission(session, permission))) return session;
  if (session) redirect(defaultWorkspace(session.role));
  redirect(`/admin/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
}
