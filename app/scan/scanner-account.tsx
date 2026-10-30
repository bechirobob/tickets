"use client";

import { useState } from "react";
import { clearGateManifests } from "../../lib/scanner-manifest";
import { operationsFetch } from "../../lib/operations-client";

export default function ScannerAccount({ actor }: { actor: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await operationsFetch("/api/admin/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Sign out could not be confirmed. Try again.");
      try { clearGateManifests(window.localStorage); } catch { /* Preserve queued scans; server logout still wins. */ }
      // Hard navigation discards the authenticated scanner component after logout.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/scan/app?source=scanner-pwa");
    } catch { setBusy(false); setError("Sign out could not be confirmed. Try again."); }
  }
  return <div className="scanner-account"><span>{actor}</span><button type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
