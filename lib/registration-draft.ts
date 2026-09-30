export type RegistrationDraft = { guestName: string; email: string; phone: string; partySize: string };
type RegistrationMode = 'rsvp' | 'interest';

/** Per-tab working memory only. Never serialize contact details or consent. */
export function createRegistrationDraftStore() {
  const drafts = new Map<string, RegistrationDraft>();
  const key = (eventSlug: string, mode: RegistrationMode) => `${mode}:${eventSlug}`;
  return {
    read(eventSlug: string, mode: RegistrationMode) {
      const draft = drafts.get(key(eventSlug, mode));
      return draft ? { ...draft } : undefined;
    },
    save(eventSlug: string, mode: RegistrationMode, draft: RegistrationDraft) {
      const id = key(eventSlug, mode);
      drafts.delete(id);
      // Keep only fields needed to resume this form. Consent is never copied.
      drafts.set(id, { guestName: draft.guestName, email: draft.email, phone: draft.phone, partySize: draft.partySize });
      if (drafts.size > 10) drafts.delete(drafts.keys().next().value!);
    },
    clear(eventSlug: string, mode: RegistrationMode) { drafts.delete(key(eventSlug, mode)); },
  };
}

export const registrationDrafts = createRegistrationDraftStore();
