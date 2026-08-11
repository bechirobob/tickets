import RoomOperations from "./room-operations";
import { requireAdminSession } from "../../../lib/admin-auth";

export default async function RoomOperationsPage() {
  const session = await requireAdminSession("/admin/rooms", "rooms.moderate");
  return <RoomOperations actor={session.actor} role={session.role} />;
}
