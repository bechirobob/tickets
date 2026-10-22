import { customerEvent } from "../lib/customer-screen";
import HomeScreen from "./home-screen";
import { getPublicEvents } from "./events";
import { isWebsiteListedEvent } from "../lib/website-event-listings";
export const dynamic = "force-dynamic";
export default async function Home() {
  return <HomeScreen events={(await getPublicEvents()).filter(isWebsiteListedEvent).map(customerEvent)} />;
}
