import { customerEmail, emailGreeting, emailParagraph } from './customer-email';

const origin = 'https://tickets.becoreops.com';
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const singleLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();

/** Pure notification content. It never reads a chat body or creates access credentials. */
export function roomHostEmail(input: {
  eventTitle: string;
  hostName?: string | null;
  eventSlug: string;
  messageId: string;
}) {
  if (!/^[a-z0-9-]{1,80}$/u.test(input.eventSlug)) throw new Error('Room email event slug is invalid.');
  if (!input.messageId?.trim() || input.messageId.length > 200 || /[\u0000-\u001f\u007f]/u.test(input.messageId)) throw new Error('Room email message ID is invalid.');
  const eventTitle = singleLine(input.eventTitle);
  if (!eventTitle) throw new Error('Room email event title is required.');
  const hostName = input.hostName ? singleLine(input.hostName) : '';
  const subject = `${eventTitle} · Your host has posted`;
  const title = 'Your host has posted.';
  const announcement = hostName
    ? `${hostName}, your host for ${eventTitle}, has posted in The Room.`
    : `Your host for ${eventTitle} has posted in The Room.`;
  const invitation = 'Open The Room to read the message and join the chat.';
  const reason = 'You’re receiving this because you have a pass for this event.';
  const roomUrl = `${origin}/room/${encodeURIComponent(input.eventSlug)}`;
  const actionUrl = `${roomUrl}?from=host-first-post&message=${encodeURIComponent(input.messageId)}`;
  const preferencesUrl = `${roomUrl}?notifications=settings`;
  return {
    subject,
    html: customerEmail({
      title,
      preheader: announcement,
      body: emailParagraph(`${emailGreeting()} ${escapeHtml(announcement)}`) + emailParagraph(invitation)
        + emailParagraph(`<a href="${escapeHtml(preferencesUrl)}" style="color:#301d2c;text-decoration:underline;">Manage this event’s notifications</a>.`),
      action: { label: 'Open The Room', url: actionUrl },
      note: reason,
    }),
    text: `Hi there,\n\n${announcement}\n\n${invitation}\n${actionUrl}\n\n${reason}\nManage this event’s notifications: ${preferencesUrl}\n\nNeed a hand? tickets@becoreops.com`,
  };
}
