import ScanPage from "../page";
export const dynamic = "force-dynamic";
export default function ScannerAppPage({ searchParams }: { searchParams: Promise<{ event?: string; source?: string }> }) {
  return ScanPage({ searchParams, scannerOnly: true });
}
