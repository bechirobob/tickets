import type { Metadata } from 'next';
import YorkeBrand from '../yorke-brand';
import YorkeTokenAction from '../token-action';

export const metadata: Metadata = { title: 'Unsubscribe — The Yorke Way', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function YorkeUnsubscribePage() {
  return <><YorkeBrand /><main className="yorke-token"><YorkeTokenAction action="withdraw" /></main></>;
}
