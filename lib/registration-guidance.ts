/** Public explanations follow saved registration settings, never poster dates. */
export function registrationOpeningMessage(opensAt?: string | null, now = Date.now()) {
  if (!opensAt || !Number.isFinite(Date.parse(opensAt)) || Date.parse(opensAt) <= now) return null;
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'GMT' }).format(new Date(opensAt));
  const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'GMT' }).format(new Date(opensAt)).replace(':00', '').toUpperCase();
  return `RSVP opens ${date}, ${time} GMT. See you here.`;
}

export function rsvpGuestGuidance({ approvalRequired, schedulePending, roomAccess }: {
  approvalRequired: boolean;
  schedulePending: boolean;
  roomAccess?: boolean;
}) {
  return {
    beforeRequest: approvalRequired
      ? 'Your spot’s yours once the host confirms.'
      : 'Room for you? You’re in. Full house? You join the waitlist.',
    form: approvalRequired
      ? 'Drop your details. Your spot’s yours once the host confirms.'
      : 'Drop your details. Full house? You join the waitlist.',
    schedule: schedulePending
      ? 'Date still to be announced. Keep an eye on My Nights.'
      : null,
    room: roomAccess === true
      ? 'Your confirmed RSVP gets you into The Room when it’s open.'
      : roomAccess === false ? 'The Room isn’t included with this RSVP.' : null,
  };
}
