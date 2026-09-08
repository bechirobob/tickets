import { Martini, Utensils } from "lucide-react";

/** Match the perk itself; an unknown perk needs no decorative stand-in. */
export default function EventPerkIcon({ perk }: { perk: string }) {
  if (/\b(?:grills?|braai|barbecue|bbq)\b/iu.test(perk)) return <svg className="braai-grill-and-drink" width="42" height="32" viewBox="0 0 42 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 11c-4-3 2-5 1-9 4 3 6 6 3 9" fill="currentColor" fillOpacity=".2" />
    <path d="M3 15h20c-.5 6-4.2 9-10 9S3.5 21 3 15Z" fill="currentColor" fillOpacity=".1" />
    <path d="M6 12h14M8 24l-3 6m13-6 3 6M7 28h12" />
    <path d="M28 11h9v13a4.5 4.5 0 0 1-9 0V11Z" fill="currentColor" fillOpacity=".14" />
    <path d="M37 14h1a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-1M31 15v8m3-8v8" />
    <path d="M28 11a2.5 2.5 0 0 1 .5-5 3 3 0 0 1 5.5-1 2.5 2.5 0 0 1 3 4v2" />
  </svg>;
  if (!/mimosa/iu.test(perk)) {
    if (/\b(?:drinks?|cocktails?|beers?|wine|tequila)\b/iu.test(perk)) return <Martini size={23} strokeWidth={1.7} aria-hidden="true" />;
    if (/\b(?:food|dining|meals?|brunch|dinner)\b/iu.test(perk)) return <Utensils size={23} strokeWidth={1.7} aria-hidden="true" />;
    return null;
  }
  return <svg className="mimosa-glass" width="25" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7.3 9h8.4l-.8 5.8a3.45 3.45 0 0 1-6.8 0L7.3 9Z" fill="#d99a46" fillOpacity=".65" stroke="none" />
    <path d="M6.5 3.5h10L15 14.7a3.55 3.55 0 0 1-7 0L6.5 3.5ZM11.5 18v6M7.5 24h8" />
    <path d="M15.7 7.5a4.2 4.2 0 0 0 4.2-4.2h-4.2v4.2Z" fill="#f1bd68" stroke="#955716" strokeWidth="1.2" />
    <path d="m15.7 3.3 2.8 2.8" stroke="#955716" strokeWidth="1" />
  </svg>;
}
