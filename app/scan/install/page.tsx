import Link from "next/link";
import StaffInstallButton from "../../staff/install/staff-install-button";

export default function ScannerInstallPage() {
  return <main className="admin-login scanner-login"><section>
    <h1>BeCore Scanner</h1><p>Open straight into ticket scanning with your staff account.</p>
    <StaffInstallButton appName="BeCore Scanner" />
    <p>On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if shown.</p>
    <p>On Android, use Install BeCore Scanner or choose Install app from your browser’s menu.</p>
    <p>Sync pending scans in your existing app before switching. Keep the old app until its queue is empty.</p>
    <Link href="/scan/app?source=scanner-pwa">Open scanner</Link>
  </section></main>;
}
