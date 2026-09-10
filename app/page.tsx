import { customerEvent } from "../lib/customer-screen";
import HomeScreen from "./home-screen";
import { getPublicEvents } from "./events";
export const dynamic = "force-dynamic";
export default async function Home() {
  return <HomeScreen events={(await getPublicEvents()).map(customerEvent)} />;
}
