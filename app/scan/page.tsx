import Scanner from "./scanner";
import { requireAdminSession } from "../../lib/admin-auth";
import { getPublicEvents } from "../events";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  await requireAdminSession("/scan");
  const events = await getPublicEvents();
  return <Scanner events={events.map(({ slug, title, fullDate, venue }) => ({ slug, title, fullDate, venue }))} />;
}
