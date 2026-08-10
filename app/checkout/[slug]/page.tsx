import CheckoutForm from "./checkout-form";
import { getCuratedEvent } from "../../events";

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getCuratedEvent(slug);
  return <CheckoutForm slug={slug} event={event} />;
}
