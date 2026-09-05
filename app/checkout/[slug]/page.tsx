import CheckoutForm from "./checkout-form";
import { notFound, redirect } from "next/navigation";
import { findCuratedEvent } from "../../events";
import { resolveBookingFee } from "../../../lib/booking-fees";

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await findCuratedEvent(slug);
  if (!event) notFound();
  if (!event.ticketTiers.some((tier) => tier.status === "available")) redirect(`/event/${slug}`);
  return <CheckoutForm slug={slug} event={event} feeBasisPoints={await resolveBookingFee(slug)} />;
}
