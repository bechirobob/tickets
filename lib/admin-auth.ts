import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  readAdminSession,
  safeReturnTo,
  type AdminSession,
} from "./admin-session";

export * from "./admin-session";

export async function requireAdminSession(returnTo: string): Promise<AdminSession> {
  const requestHeaders = await headers();
  const session = await readAdminSession(requestHeaders.get("cookie"));
  if (session) return session;
  redirect(`/admin/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
}
