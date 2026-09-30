import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findCuratedEvent } from "../events";
import CheckoutForm from "../checkout/[slug]/checkout-form";
import { CHECKOUT_PREVIEW_EVENT_SLUG, CHECKOUT_PREVIEW_SOURCE_SLUG, checkoutPreviewEvent, checkoutPreviewIsOpen } from "../../lib/checkout-preview";
import "./preview.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "No-charge checkout preview",
  description: "A temporary checkout walkthrough. Demo prices only; no payment, booking or ticket is created.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPreviewPage() {
  if (!checkoutPreviewIsOpen()) notFound();
  const source = await findCuratedEvent(CHECKOUT_PREVIEW_SOURCE_SLUG);
  if (!source) notFound();
  return <CheckoutForm slug={CHECKOUT_PREVIEW_EVENT_SLUG} event={checkoutPreviewEvent(source)} feeBasisPoints={0} paystackEnabled seevEnabled seevCryptoEnabled preview />;
}
