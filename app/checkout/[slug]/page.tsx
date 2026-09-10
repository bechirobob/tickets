import { paystackAvailable } from "../../../lib/paystack-environment";
import { registrationSettings, registrationsOpen } from "../../../lib/registrations";
import { seevAvailable } from "../../../lib/seevplus";
import CheckoutForm from "./checkout-form";
import { notFound, redirect } from "next/navigation";
import { findCuratedEvent } from "../../events";
import { resolveBookingFee } from "../../../lib/booking-fees";

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await findCuratedEvent(slug);
  if (!event) notFound();
  const { env: registrationEnv } = await import("cloudflare:workers");
  const registration=await registrationSettings(registrationEnv.DB,slug);
  if (!registration || registration.mode !== "paid" || !registrationsOpen(registration)) redirect(`/event/${slug}`);
  if (!event.ticketTiers.some((tier) => tier.status === "available")) redirect(`/event/${slug}`);
  const { env } = await import("cloudflare:workers");
  return <CheckoutForm paystackEnabled={paystackAvailable(env,event.isTestEvent)} seevEnabled={seevAvailable(env, event.isTestEvent)} slug={slug} event={event} feeBasisPoints={await resolveBookingFee(slug)} />;
}
