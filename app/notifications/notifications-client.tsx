"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BrandLogo from "../brand-logo";
import AccountNavigation from "../account-navigation";
import PublicNavigation from "../mobile-navigation";
import NotificationFeed from "./notification-feed";
import { useNotifications } from "./use-notifications";
import { requestJson, requestErrorMessage } from "../../lib/client-request";

export default function NotificationsClient() {
  const params = useSearchParams();
  const feed = useNotifications();
  const [notice, setNotice] = useState("");
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => {
    const slug = params.get("mute");
    if (!slug || !/^[a-z0-9-]{1,80}$/u.test(slug)) return;
    const controller = new AbortController();
    void requestJson(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mute: "tonight" }), signal: controller.signal,
    }).then(() => setNotice("That Room is quiet for tonight. Your lock screen may rest."))
      .catch((error) => { if (!controller.signal.aborted) setPreferenceError(requestErrorMessage(error)); });
    return () => controller.abort();
  }, [params]);

  return <main className="buzz-page">
    <header className="directory-header"><span className="account-header-label">Account</span><Link href="/" className="brand-mark"><BrandLogo /></Link><PublicNavigation /></header>
    <AccountNavigation />
    <section className="buzz-shell"><header className="buzz-intro"><div><h1>The Buzz</h1><p>Only the useful noise.</p></div>{feed.items && <span role="status">{feed.unread ? `${feed.unread} unread` : "All caught up"}</span>}</header>
      {notice && <p className="buzz-feedback" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={16} aria-hidden="true" /></button></p>}
      {preferenceError && <p className="buzz-error" role="alert">{preferenceError}</p>}
      <NotificationFeed feed={feed} />
    </section>
  </main>;
}
