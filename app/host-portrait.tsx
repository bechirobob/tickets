/* eslint-disable @next/next/no-img-element -- approved host artwork is served without image transformation. */
import './host-portrait.css';

type HostIdentity = { name: string; profileImageUrl?: string | null; brandName?: string | null; brandLogoUrl?: string | null };

/** One public host identity treatment; never use staff or attendee avatars as host associations. */
export default function HostPortrait({ host, variant, className = '' }: { host: HostIdentity; variant: 'profile' | 'directory' | 'event'; className?: string }) {
  const initials = host.name.split(/\s+/u).map(word => word[0]).join('').slice(0, 2);
  return <span className={`host-portrait host-portrait--${variant}${className ? ` ${className}` : ''}`}>
    {host.profileImageUrl ? <img className="host-portrait__image" src={host.profileImageUrl} alt={host.name} width={886} height={1080} loading={variant === 'profile' ? 'eager' : 'lazy'} fetchPriority={variant === 'profile' ? 'high' : 'auto'} />
      : <span className="host-portrait__initials" role="img" aria-label={host.name}>{initials}</span>}
    {host.brandName?.trim() && host.brandLogoUrl ? <span className="host-portrait__seal"><img src={host.brandLogoUrl} alt="" width={52} height={52} /></span> : null}
  </span>;
}
