import { requireAdminSession } from "../../lib/admin-auth";
import CurationDesk from "./curation-desk";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAdminSession("/admin");
  return <CurationDesk actor={session.actor} />;
}
