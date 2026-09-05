"use client";

import Link from "next/link";

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="recovery-page"><section role="alert"><p className="eyebrow">BeCore Tickets</p><h1>This page couldn’t load.</h1><p>Try again in a moment. If you just paid, check My Nights before starting another payment.</p><nav aria-label="Recover this page"><button onClick={reset}>Try again</button><Link href="/my-nights">My Nights</Link><Link href="/events">Find a night</Link></nav></section></main>;
}
