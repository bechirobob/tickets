import { requireAdminSession } from "../../../lib/admin-auth";
import OrganizerWorkspace from "./organizer-suite";

export const dynamic = "force-dynamic";

export default async function OrganizerWorkspacePage() {
  const session = await requireAdminSession("/organizer/workspace", "organizer.workspace");
  return <OrganizerWorkspace actor={session.actor} role={session.role} />;
}
