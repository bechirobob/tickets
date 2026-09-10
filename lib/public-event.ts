/** Public catalogue contract shared by the website API and packaged apps. */
export type PublicEvent = {
  slug: string;
  title: string;
  image: string;
  venue: string;
  area: string;
  vibe: string;
  fullDate: string;
  time: string;
  startsAt: string | null;
  scheduleStatus: string;
  isVerified: boolean;
  eventState: string;
  priceFromMinor: number;
  ticketsAvailable: boolean;
  registrationMode?: 'paid' | 'rsvp' | 'interest';
  registrationOpen?: boolean;
  colourScheme: string | null;
  dressCode: string | null;
  guestPerk: string | null;
  awarenessNote: string | null;
  lineup: string;
  ageRestriction: string;
  note: string;
  quip: string;
};

export type PublicCatalogue = { version: 1; events: PublicEvent[]; updatedAt: string; screens?: import("./customer-screen").CustomerEventScreen[] };
