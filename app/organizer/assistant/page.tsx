import { requireAdminSession } from "../../../lib/admin-auth";
import OrganizerAssistant from "./organizer-assistant";

export const dynamic = "force-dynamic";

export default async function OrganizerAssistantPage() {
  const session = await requireAdminSession("/organizer/assistant", "organizer.workspace");
  return <OrganizerAssistant actor={session.actor} role={session.role} />;
}
