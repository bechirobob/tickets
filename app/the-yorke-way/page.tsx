import type { Metadata } from 'next';
import Image from 'next/image';
import YorkeBrand from './yorke-brand';
import YorkeSignup from './signup';

export const metadata: Metadata = {
  title: 'The Yorke Way — Early access',
  description: 'End the year with Kofi Bills. Sign up for early access to all his upcoming year-end events. Sponsored by BeCore Tickets.',
  alternates: { canonical: '/the-yorke-way' },
  openGraph: {
    title: 'The Yorke Way — End the year with Kofi Bills',
    description: 'Sign up for early access to all his upcoming year-end events. Sponsored by BeCore Tickets.',
    url: '/the-yorke-way',
    images: [{ url: '/hosts/kofi-bills.webp', width: 886, height: 1080, alt: 'Kofi Bills' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Yorke Way — End the year with Kofi Bills',
    description: 'Sign up for early access to all his upcoming year-end events. Sponsored by BeCore Tickets.',
    images: ['/hosts/kofi-bills.webp'],
  },
};

export default function YorkeWayPage() {
  return <>
    <YorkeBrand />
    <main className="yorke-main" id="main">
      <section className="yorke-intro" aria-labelledby="yorke-title">
        <p className="yorke-eyebrow"><span aria-hidden="true" />Early access · Year-end 2026</p>
        <h1 id="yorke-title">End the year<br />with <span>Kofi Bills.</span></h1>
        <p className="yorke-description">Sign up for early access to all his upcoming year-end events.</p>
      </section>
      <figure className="yorke-portrait">
        <Image src="/hosts/kofi-bills.webp" alt="Kofi Bills, dressed in black, standing against a pale textured wall" width={886} height={1080} sizes="(max-width: 700px) 100vw, 48vw" priority unoptimized />
        <div className="yorke-year" aria-hidden="true"><span>Year-end</span><strong>20<br />26</strong></div>
        <figcaption><span>The Yorke Way</span><strong>Kofi Bills</strong><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 19 19 5M5 5h14v14" /></svg></figcaption>
      </figure>
      <section className="yorke-form-section" aria-label="Early-access signup">
        <YorkeSignup />
        <p className="yorke-fine-print">Early-access updates only. Signing up isn’t a ticket or guarantee of entry. <a href="/privacy">Privacy policy</a></p>
      </section>
    </main>
    <footer className="yorke-footer"><span>The Yorke Way</span><span>Year-end 2026 · Sponsored by BeCore Tickets</span></footer>
  </>;
}
