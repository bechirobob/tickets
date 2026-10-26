import type { Metadata } from 'next';
import YorkeBrand from '../yorke-brand';
import YorkeTokenAction from '../token-action';

export const metadata: Metadata = { title: 'Confirm your email — The Yorke Way', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function YorkeConfirmPage() {
  return <><YorkeBrand /><main className="yorke-token"><YorkeTokenAction action="confirm" /></main></>;
}
