/** Public explanations follow saved registration settings, never poster dates. */
export function rsvpGuestGuidance({ approvalRequired, schedulePending, roomAccess }: {
  approvalRequired: boolean;
  schedulePending: boolean;
  roomAccess?: boolean;
}) {
  return {
    beforeRequest: approvalRequired
      ? 'The host reviews each request. Your spot is only yours once your RSVP is confirmed.'
      : 'Your spot is confirmed if there’s room. Full house? You join the waitlist.',
    form: approvalRequired
      ? 'Drop your details. The host reviews each request, so your spot isn’t confirmed yet.'
      : 'Drop your details. Your spot is confirmed if there’s room; otherwise, you join the waitlist.',
    schedule: schedulePending
      ? 'The date is still to be announced. Check the event details in My Nights for the latest.'
      : null,
    room: roomAccess === true
      ? 'A confirmed RSVP includes access to The Room when it’s open.'
      : roomAccess === false ? 'The Room isn’t included with this RSVP.' : null,
  };
}
