import { requireAdminSession } from "../../lib/admin-auth";
import CurationDesk from "./curation-desk";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAdminSession("/admin", "curation.manage");
  return <CurationDesk actor={session.actor} role={session.role} />;
}
