import { redirect } from "next/navigation";
import { requireAdminSession } from "../../../lib/admin-auth";
import PlatformAudience from "./platform-audience";

export const dynamic = "force-dynamic";
export default async function PlatformAudiencePage() {
  const session = await requireAdminSession("/admin/platform-audience", "accounts.manage");
  if (session.role !== "owner") redirect("/admin/account");
  return <PlatformAudience actor={session.actor} role={session.role} />;
}
