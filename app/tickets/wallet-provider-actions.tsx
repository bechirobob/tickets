"use client";

import { WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./wallet-provider-actions.module.css";

type WalletAvailability = {
  apple: boolean;
  google: boolean;
};

let availabilityRequest: Promise<WalletAvailability> | null = null;

function readAvailability() {
  availabilityRequest ??= fetch("/api/customer/wallet/config", {
    cache: "no-store",
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok) throw new Error("Wallet availability could not be checked.");
    const data = await response.json() as Partial<WalletAvailability>;
    return { apple: data.apple === true, google: data.google === true };
  }).catch((error) => {
    availabilityRequest = null;
    throw error;
  });
  return availabilityRequest;
}

export default function WalletProviderActions({ ticketId }: { ticketId: string }) {
  const [availability, setAvailability] = useState<WalletAvailability | null>(null);

  useEffect(() => {
    let active = true;
    void readAvailability()
      .then((result) => { if (active) setAvailability(result); })
      .catch(() => { if (active) setAvailability({ apple: false, google: false }); });
    return () => { active = false; };
  }, []);

  if (!availability?.apple && !availability?.google) return null;
  const route = `/api/customer/wallet/${encodeURIComponent(ticketId)}`;

  return <div className={styles.actions} aria-label="Save this pass">
    {availability.apple ? <a className={styles.apple} href={`${route}?platform=apple`}>
      <WalletCards aria-hidden="true" size={16} />
      <span>Add to Apple Wallet</span>
    </a> : null}
    {availability.google ? <a className={styles.google} href={`${route}?platform=google`}>
      <WalletCards aria-hidden="true" size={16} />
      <span>Add to Google Wallet</span>
    </a> : null}
  </div>;
}
