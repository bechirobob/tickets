import Image from "next/image";

/** One identity, with live type so the wordmark stays sharp at every size. */
export default function BrandLogo({ prominent = false, section }: { prominent?: boolean; section?: string }) {
  return <span className={`brand-logo${prominent ? " brand-logo--prominent" : ""}`} role="img" aria-label={`BeCore Tickets${section ? ` · ${section}` : ""}`}>
    <Image className="brand-logo__emblem" src="/brand/becore-ticket.webp" width={239} height={256} alt="" aria-hidden="true" unoptimized />
    <span className="brand-logo__type" aria-hidden="true"><b>BeCore</b><small>{section ?? "Tickets"}</small></span>
  </span>;
}
