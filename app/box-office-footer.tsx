import Link from "next/link";
import BrandLogo from "./brand-logo";
import PaymentFooter from "./payment-footer";

export default function BoxOfficeFooter() {
  return <footer className="night-footer compact-footer box-office-footer">
      <PaymentFooter />
      <BrandLogo prominent />
      <p>Accra, we’re going out. Tell the group chat.</p>
      <div><Link href="/staff">Event staff</Link><Link href="/organizer/submit">Organisers</Link><Link href="/about">About us</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
    </footer>;
}
