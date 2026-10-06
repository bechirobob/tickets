/** Shared customer email presentation. Callers escape dynamic body markup. */
const font = "Arial,Helvetica,sans-serif";
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function safeActionUrl(value: string) {
  if (/[\u0000-\u0020\u007f]/u.test(value)) throw new Error('Email action URL is invalid.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Email action URL is invalid.');
  return escapeHtml(url.href);
}

/** Content is trusted HTML; escape customer/event text before calling. */
export function emailParagraph(content: string) {
  return `<p style="margin:0 0 22px;font-family:${font};font-size:16px;line-height:25px;color:#301d2c">${content}</p>`;
}

export function emailGreeting(name?: string | null) {
  const value = name?.trim();
  return value ? `Hi ${escapeHtml(value)},` : 'Hi there,';
}

export function emailFlyer(input: { url?: string | null; title: string; isPublic: boolean; contentType?: string | null }) {
  if (!input.isPublic || !input.url || /[\u0000-\u0020\u007f]/u.test(input.url)) return '';
  try {
    const url = new URL(input.url, 'https://tickets.becoreops.com');
    if (url.origin !== 'https://tickets.becoreops.com' || url.username || url.password || url.search || url.hash) return '';
    if (url.pathname === '/events/on-the-guest-list.webp') url.pathname = '/events/on-the-guest-list-email.jpg';
    const staticFlyer = /^\/events\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)$/u.test(url.pathname);
    const publicUpload = /^\/api\/media\/[a-zA-Z0-9_-]+$/u.test(url.pathname) && ['image/jpeg', 'image/png'].includes(input.contentType ?? '');
    if (!staticFlyer && !publicUpload) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td align="center"><img src="${escapeHtml(url.href)}" alt="${escapeHtml(input.title)} flyer" width="180" style="display:block;width:180px;max-width:100%;height:auto;border:0"></td></tr></table>`;
  } catch { return ''; }
}

export function emailEvent(input: { title: string; when?: string; venue?: string }) {
  return `<div style="margin:22px 0"><h2 style="margin:0 0 10px;font-family:${font};font-size:22px;line-height:1.3;color:#301d2c;overflow-wrap:anywhere">${escapeHtml(input.title)}</h2>${emailParagraph([input.when, input.venue].filter((value): value is string => Boolean(value)).map(escapeHtml).join('<br>'))}</div>`;
}

export function emailDetails(rows: { label: string; value: string }[]) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin:24px 0;font-family:${font};font-size:15px;line-height:1.5;color:#301d2c"><tbody>${rows.map(({ label, value }, index) => `<tr><th scope="row" width="48%" style="padding:10px 12px 10px 0;text-align:left;vertical-align:top;font-weight:${index === rows.length - 1 ? '700' : '400'};border-bottom:1px solid #ded6ce;overflow-wrap:anywhere">${escapeHtml(label)}</th><td style="padding:10px 0;text-align:right;vertical-align:top;font-weight:${index === rows.length - 1 ? '700' : '600'};border-bottom:1px solid #ded6ce;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>`;
}

/**
 * Transactional adaptation of the approved 22 September host-invite shell.
 * Keep its identity; customer service emails have help/privacy copy, not a
 * promotional opt-out that could imply customers can disable ticket receipts.
 */
export function customerEmail(input: {
  title: string;
  preheader: string;
  body: string;
  action: { label: string; url: string };
  note?: string;
}) {
  const url = safeActionUrl(input.action.url);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(input.title)}</title><style>@media(max-width:480px){.email-padding{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:34px!important;line-height:38px!important}}</style></head><body style="margin:0;padding:0;background:#ede9e4;color:#301d2c;"><div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ede9e4" style="width:100%;border-collapse:collapse;background:#ede9e4;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<div style="max-width:600px;margin:0 auto;"><table role="presentation" width="600" cellspacing="0" cellpadding="0" bgcolor="#f8f4ec" style="width:100%;max-width:600px;border-collapse:collapse;table-layout:fixed;background:#f8f4ec;color:#301d2c;font-family:Arial,Helvetica,sans-serif;">
<tr><td class="email-padding" bgcolor="#301d2c" style="padding:32px 36px 35px;background:#301d2c;color:#f8f4ec;">
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td><img src="https://tickets.becoreops.com/brand/becore-ticket.png?v=5" alt="" width="36" height="39" style="display:block;border:0;width:36px;height:39px;"></td><td style="padding-left:12px;font-size:19px;font-weight:bold;color:#f8f4ec;">BeCore Tickets</td></tr></table>

<h1 class="email-title" style="margin:26px 0 0;font-size:40px;line-height:44px;letter-spacing:-1px;color:#f8f4ec;overflow-wrap:anywhere;">${escapeHtml(input.title)}</h1>
</td></tr><tr><td class="email-padding" bgcolor="#f8f4ec" style="padding:34px 36px 12px;font-size:16px;line-height:25px;color:#301d2c;background:#f8f4ec;overflow-wrap:anywhere;">${input.body}
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:7px 0 26px;max-width:100%;"><tr><td bgcolor="#d6f075" style="background:#d6f075;mso-padding-alt:16px 20px;"><a href="${url}" style="display:inline-block;padding:16px 20px;color:#301d2c;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:21px;font-weight:bold;text-decoration:none;">${escapeHtml(input.action.label)}</a></td></tr></table>
${input.note ? emailParagraph(escapeHtml(input.note)) : ''}
</td></tr><tr><td class="email-padding" bgcolor="#eae1d6" style="padding:21px 36px 25px;background:#eae1d6;color:#655d60;font-size:13px;line-height:20px;">Need a hand? <a href="mailto:tickets@becoreops.com" style="color:#301d2c;text-decoration:underline;overflow-wrap:anywhere;">tickets@becoreops.com</a></td></tr>
</table></div><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}
