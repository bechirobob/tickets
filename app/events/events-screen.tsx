"use client";

import BoxOfficeHeader from "../box-office-header";
import BoxOfficeFooter from "../box-office-footer";
import EventExplorer from "../event-explorer";
import type { CustomerEvent } from "../../lib/customer-screen";

export default function EventsScreen({ events }: { events: CustomerEvent[] }) {
  return <main className="directory-page discovery-directory">
    <BoxOfficeHeader />
    <section className="directory-intro"><p className="eyebrow">BeCore Tickets / Accra</p><h1>The Drop</h1></section>
    <section className="directory-results"><EventExplorer events={events} full /></section>
    <BoxOfficeFooter />
  </main>;
}
