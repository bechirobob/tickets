import { customerEvent } from "../../lib/customer-screen";
import EventsScreen from "./events-screen";
import { getPublicEvents } from "../events";
import { isWebsiteListedEvent } from "../../lib/website-event-listings";
export const dynamic = "force-dynamic";
export default async function EventsPage() {
  return <EventsScreen events={(await getPublicEvents()).filter(isWebsiteListedEvent).map(customerEvent)} />;
}
