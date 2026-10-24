import { customerEmail, emailGreeting, emailParagraph } from './customer-email';

const origin = 'https://tickets.becoreops.com';
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

/** The same production template is used for synthetic previews and actual sends. */
export function eventHostPassEmail(input: { eventTitle: string; hostName: string; claimUrl: string }) {
  const url = new URL(input.claimUrl);
  if (url.origin !== origin || url.pathname !== '/my-nights/access' || url.search !== '?kind=host'
    || url.username || url.password || !url.hash.startsWith('#token=')) throw new Error('Invalid Host pass link.');
  const eventTitle = input.eventTitle.trim(), hostName = input.hostName.trim();
  if (!eventTitle || !hostName || /[\u0000-\u001f\u007f]/u.test(eventTitle + hostName)) throw new Error('Invalid Host pass identity.');
  const title = 'Your Room is waiting.';
  const intro = `Your Host pass for ${eventTitle} is ready.`;
  const invitation = `Accept it to enter The Room as ${hostName} · Host, then drop your first message.`;
  const note = 'This private link works once and expires after 24 hours, or when the event ends if sooner. Please don’t forward it.';
  return {
    subject: `${eventTitle} · Your Host pass`,
    html: customerEmail({ title, preheader: intro,
      body: emailParagraph(`${emailGreeting(hostName)} ${escapeHtml(intro)}`) + emailParagraph(escapeHtml(invitation)),
      action: { label: 'Accept pass & enter the Room', url: input.claimUrl }, note }),
    text: `Hi ${hostName},\n\n${intro}\n\n${invitation}\n\nAccept pass & enter the Room:\n${input.claimUrl}\n\n${note}\n\nNeed a hand? tickets@becoreops.com`,
  };
}
