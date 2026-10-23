"use client";

/** Root-layout failures bypass app/error.tsx. Keep this independent of the shell,
 * route chunks, session hooks and stylesheets that may have just failed. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const action = { display: "inline-block", minHeight: 44, padding: "12px 16px", color: "#281b2b", background: "#fff", border: "1px solid #707070", borderRadius: 8, font: "inherit" };
  return <html lang="en-GB"><body style={{ margin: 0, background: "#f4f1ea", color: "#281b2b", fontFamily: "system-ui, sans-serif" }}>
    <main style={{ maxWidth: 560, margin: "auto", padding: "max(32px, env(safe-area-inset-top)) 24px" }}>
      <p>BeCore Tickets</p><h1>Let’s get your page back.</h1>
      <p role="alert">This page stopped working. Try again, or reload if it still won’t open.</p>
      <p>Reloading may lose unsent changes. If you just paid, check My Nights before starting another payment.</p>
      <nav aria-label="Recover BeCore Tickets" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" style={action} onClick={reset}>Try again</button>
        <button type="button" style={action} onClick={() => window.location.reload()}>Reload page</button>
        {/* Full navigation deliberately avoids the router that may have failed. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a style={action} href="/my-nights">My Nights</a>
        <a style={action} href="/offline-ticket.html">Saved offline tickets</a>
      </nav>
    </main>
  </body></html>;
}
