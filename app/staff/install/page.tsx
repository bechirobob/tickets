import Link from "next/link";
import BrandLogo from "../../brand-logo";
import StaffInstallButton from "./staff-install-button";
import "../../../styles/workspace.css";

export const metadata = { title: "Install staff app", robots: { index: false, follow: false } };

export default function StaffInstallPage() {
  return <main className="admin-login"><section>
    <Link href="/staff" className="night-brand-link"><BrandLogo /></Link>
    <h1>BeCore Staff</h1>
    <p>Open straight into your workspace. If your session expires, you’ll see staff sign-in.</p>
    <StaffInstallButton />
    <p>On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if shown, then tap Add.</p>
    <p>On Android or desktop, use Install BeCore Staff if shown, or choose Install app or Add to Home screen from your browser’s menu.</p>
    <p>If your old icon opens My Nights or the public site, add BeCore Staff from this page and sign in to the new app. Before removing the old icon, reconnect and sync any pending gate scans: removing an installed app can clear its local data. Keep your customer app if you also use it for tickets.</p>
    <p>Only scanning tickets? <Link href="/scan/install">Install BeCore Scanner</Link>.</p>
    <Link href="/staff?source=staff-pwa">Open staff workspace →</Link>
  </section></main>;
}
