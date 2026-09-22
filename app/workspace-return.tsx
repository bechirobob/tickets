"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isWorkspacePathAllowed, type StaffRole } from "../lib/staff-roles";

/** Staff and guest sessions are distinct. Public browsing never revokes either. */
export default function WorkspaceReturn() {
  const pathname = usePathname(), [destination, setDestination] = useState<{ path: string; from: string } | null>(null);
  const publicPage = !["/admin", "/organizer/workspace", "/organizer/analytics", "/organizer/assistant", "/organizer/activate", "/organizer/team", "/scan"].some(x => pathname.startsWith(x));
  useEffect(() => {
    if (!publicPage) return;
    const controller = new AbortController();
    void fetch("/api/admin/workspace", { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async r => {
      if (!r.ok) return;
      const data = await r.json() as { role: StaffRole; returnTo: string };
      let from = data.returnTo;
      try {
        const saved = sessionStorage.getItem("bct-workspace-return");
        if (saved?.startsWith("/") && !saved.startsWith("//")) {
          const url = new URL(saved, window.location.origin);
          if (url.origin === window.location.origin && isWorkspacePathAllowed(data.role, url.pathname)) from = url.pathname + url.search;
        }
      } catch {}
      setDestination({ path: pathname, from });
    }).catch(() => { /* Public pages remain usable if the session check fails. */ });
    return () => controller.abort();
  }, [pathname, publicPage]);
  return publicPage && destination?.path === pathname ? <aside className="workspace-return" aria-label="Workspace return"><span>You’re viewing the public site.</span><Link href={destination.from}>Back to workspace →</Link></aside> : null;
}
