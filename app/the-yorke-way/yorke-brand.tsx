import Image from 'next/image';
import Link from 'next/link';
import BrandLogo from '../brand-logo';

export default function YorkeBrand() {
  return <header className="yorke-header">
    <Link prefetch={false} className="yorke-identity" href="/the-yorke-way" aria-label="The Yorke Way home">
      <Image src="/hosts/the-yorke-way.svg" alt="" width={771} height={771} priority unoptimized />
      <span>The Yorke Way</span>
    </Link>
    <div className="yorke-sponsor"><span>Sponsored by</span><Link prefetch={false} href="/" aria-label="BeCore Tickets home"><BrandLogo /></Link></div>
  </header>;
}
