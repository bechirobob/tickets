"use client";
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export default function StaffInstallButton({ appName = "BeCore Staff" }: { appName?: string }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  if (!prompt) return null;
  return <button type="button" className="suite-button" onClick={async () => {
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }}>Install {appName}</button>;
}
