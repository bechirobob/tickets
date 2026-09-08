import { Gift } from "lucide-react";

/** A narrow flute, orange juice and a citrus garnish, drawn at the shared icon size. */
export default function EventPerkIcon({ perk }: { perk: string }) {
  if (!/mimosa/iu.test(perk)) return <Gift size={23} strokeWidth={1.7} aria-hidden="true" />;
  return <svg className="mimosa-glass" width="25" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7.3 9h8.4l-.8 5.8a3.45 3.45 0 0 1-6.8 0L7.3 9Z" fill="#d99a46" fillOpacity=".65" stroke="none" />
    <path d="M6.5 3.5h10L15 14.7a3.55 3.55 0 0 1-7 0L6.5 3.5ZM11.5 18v6M7.5 24h8" />
    <path d="M15.7 7.5a4.2 4.2 0 0 0 4.2-4.2h-4.2v4.2Z" fill="#f1bd68" stroke="#955716" strokeWidth="1.2" />
    <path d="m15.7 3.3 2.8 2.8" stroke="#955716" strokeWidth="1" />
  </svg>;
}
