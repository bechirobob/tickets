export const SUPPORT_EMAIL = "tickets@becoreops.com";

/** Keep this public address identical in server HTML and React hydration.
 * Cloudflare's documented per-address opt-out must include the whole anchor:
 * https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/#prevent-cloudflare-from-obfuscating-email
 * All HTML fragments are fixed literals; no caller-provided HTML is accepted.
 */
export default function SupportEmail({ linked = false }: { linked?: boolean }) {
  return <span dangerouslySetInnerHTML={{ __html: linked
    ? '<!--email_off--><a href="mailto:tickets@becoreops.com">tickets@becoreops.com</a><!--/email_off-->'
    : '<!--email_off-->tickets@becoreops.com<!--/email_off-->' }} />;
}

export function PrivacyEmail() {
  return <span dangerouslySetInnerHTML={{ __html: '<!--email_off--><a href="mailto:contact@becoreops.com">contact@becoreops.com</a><!--/email_off-->' }} />;
}
