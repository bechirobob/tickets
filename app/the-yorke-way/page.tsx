import type { Metadata } from 'next';
import Image from 'next/image';
import YorkeBrand from './yorke-brand';
import YorkeSignup from './signup';

export const metadata: Metadata = {
  title: 'The Yorke Way — Early access',
  description: 'Your year-end plans called. They said Kofi Bills. Get early access to The Yorke Way’s year-end events. Sponsored by BeCore Tickets.',
  alternates: { canonical: '/the-yorke-way' },
  openGraph: {
    title: 'The Yorke Way — Your year-end plans called',
    description: 'Get early access to Kofi Bills’ year-end events. Give the group chat something to work with. Sponsored by BeCore Tickets.',
    url: '/the-yorke-way',
    images: [{ url: '/hosts/the-yorke-way-email.png', width: 384, height: 384, alt: 'The Yorke Way metallic logo' }],
  },
  twitter: {
    card: 'summary',
    title: 'The Yorke Way — Your year-end plans called',
    description: 'Get early access to Kofi Bills’ year-end events. Give the group chat something to work with. Sponsored by BeCore Tickets.',
    images: ['/hosts/the-yorke-way-email.png'],
  },
};

export default function YorkeWayPage() {
  return <>
    <YorkeBrand />
    <main className="yorke-main" id="main">
      <section className="yorke-intro" aria-labelledby="yorke-title">
        <p className="yorke-eyebrow"><span aria-hidden="true" />Early access · Year-end 2026</p>
        <h1 id="yorke-title">Your year-end<br />plans called.<br /><span>They said <strong>Kofi Bills.</strong></span></h1>
        <p className="yorke-description">Get early access to Kofi Bills’ year-end events. Give the group chat something to work with.</p>
      </section>
      <figure className="yorke-logo-stage">
        <div className="yorke-logo-stage__top"><span>The Yorke Way</span><span>Year-end 2026</span></div>
        <div className="yorke-logo-stage__art"><Image src="/hosts/the-yorke-way.svg" alt="The Yorke Way metallic logo" width={771} height={771} sizes="(max-width: 700px) 72vw, 40vw" priority unoptimized /></div>
        <figcaption><span>The year’s not over.<br /><strong>Act accordingly.</strong></span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 19 19 5M5 5h14v14" /></svg></figcaption>
      </figure>
      <section className="yorke-form-section" aria-label="Early-access signup">
        <YorkeSignup />
        <p className="yorke-fine-print">Early-access updates only. Signing up isn’t a ticket or guarantee of entry. <a href="/privacy">Privacy policy</a></p>
      </section>
    </main>
    <footer className="yorke-footer"><span>The Yorke Way</span><span>Year-end 2026 · Sponsored by BeCore Tickets</span></footer>
  </>;
}
