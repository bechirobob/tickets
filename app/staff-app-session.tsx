"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { isWorkspacePathAllowed, STAFF_ROLES, type StaffRole } from "../lib/staff-roles";

/** Revalidate a restored staff window; this marker never grants authorization. */
export default function StaffAppSession() {
  const pathname = usePathname();
  useLayoutEffect(() => { window.dispatchEvent(new Event("staff-app-route")); }, [pathname]);
  useEffect(() => {
    const scanner = document.documentElement.dataset.scannerApp === "true";
    if ((!scanner && document.documentElement.dataset.staffApp !== "true") || (!scanner && !STAFF_ROLES.some(role => isWorkspacePathAllowed(role, pathname)))) return;
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (document.hidden || checking) return;
      checking = true;
      try {
        const response = await fetch("/api/admin/workspace", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          if (scanner && document.querySelector(".scanner-login")) return;
          window.location.replace(scanner ? "/scan/app?source=scanner-pwa" : "/staff?source=staff-pwa");
          return;
        }
        if (!response.ok) return;
        const data = await response.json() as { role: StaffRole; returnTo: string };
        if (controller.signal.aborted || !STAFF_ROLES.includes(data.role) || !isWorkspacePathAllowed(data.role, data.returnTo)) return;
        if (scanner) {
          if (pathname === "/admin/account" && data.returnTo !== "/admin/account") { window.location.replace("/scan/app?source=scanner-pwa"); return; }
          if (data.returnTo === "/admin/account" && pathname !== "/admin/account") window.location.replace("/admin/account");
          else if (!isWorkspacePathAllowed(data.role, "/scan") && pathname === "/scan/app" && !document.querySelector(".scanner-login")) window.location.reload();
          return;
        }
        if (!isWorkspacePathAllowed(data.role, pathname) || (data.returnTo === "/admin/account" && pathname !== "/admin/account")) window.location.replace(data.returnTo);
      } catch { /* A temporary offline state keeps the existing staff screen. */ }
      finally { checking = false; }
    };
    const resume = () => { void check(); };
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    void check();
    return () => {
      controller.abort();
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [pathname]);
  return null;
}
