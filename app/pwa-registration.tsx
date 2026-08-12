"use client";

import { Download, Share, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { trackProductMetric } from "../lib/client-analytics";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

declare global {
  interface Navigator { standalone?: boolean }
}

const DISMISS_KEY = "bct:pwa-install-dismissed-at";

function recentlyDismissed() {
  const value = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
  return Number.isFinite(value) && Date.now() - value < 14 * 24 * 60 * 60 * 1000;
}

export default function PwaRegistration() {
  const pathname = usePathname();
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosGuide, setIosGuide] = useState(false);
  const [eligibleAttendee, setEligibleAttendee] = useState(false);
  const installed = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/iu.test(navigator.userAgent);
  const usefulPath = pathname === "/my-nights" || pathname === "/tickets";

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, []);

  useEffect(() => {
    if (!usefulPath || installed) return;
    void fetch("/api/customer/session", { cache: "no-store", credentials: "same-origin" })
      .then((response) => setEligibleAttendee(response.ok))
      .catch(() => setEligibleAttendee(false));
  }, [installed, usefulPath]);

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const completed = () => {
      setVisible(false);
      trackProductMetric("pwa_installed");
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", completed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", completed);
    };
  }, []);

  useEffect(() => {
    if (!usefulPath || installed || !eligibleAttendee || recentlyDismissed() || (!promptEvent && !isIos)) return;
    const timer = window.setTimeout(() => {
      setVisible(true);
      trackProductMetric("pwa_prompt_shown");
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [eligibleAttendee, installed, isIos, pathname, promptEvent, usefulPath]);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
    setIosGuide(false);
  }

  async function install() {
    if (isIos) {
      setIosGuide(true);
      trackProductMetric("pwa_ios_guide_opened");
      return;
    }
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") {
      trackProductMetric("pwa_install_accepted");
      setVisible(false);
    }
    setPromptEvent(null);
  }

  if (!visible || installed) return null;

  return <aside className="pwa-install" aria-label="Install BeCore Tickets">
    <button className="pwa-install__close" type="button" aria-label="Dismiss installation suggestion" onClick={dismiss}><X size={15} /></button>
    <span className="pwa-install__mark" aria-hidden="true">B</span>
    <div><b>Keep My Nights close.</b><p>{iosGuide ? <>Tap <Share size={13} /> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</> : "Install BeCore Tickets for faster tickets, Rooms and event updates."}</p></div>
    {iosGuide ? <button type="button" onClick={dismiss}>Got it</button> : <button type="button" onClick={() => void install()}><Download size={14} /> Install</button>}
  </aside>;
}
