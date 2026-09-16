"use client";
/* eslint-disable @next/next/no-img-element -- event artwork is already governed by the platform image source */

import Link from "next/link";
import BrandLogo from "../../brand-logo";
import PublicNavigation from "../../mobile-navigation";
import NotificationBell from "../../notification-bell";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  Crown,
  Download,
  ExternalLink,
  Loader2,
  LockKeyhole,
  MapPin,
  MessageCircle,
  QrCode,
  Save,
  Sparkles,
  Ticket,
  Users,
  WalletCards,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestJson, requestErrorMessage, RequestError } from "../../../lib/client-request";
import { useCurrentTime } from "../../use-current-time";
import QrPass from "../../tickets/qr-pass";
import OfflineTicketSaver from "../../offline-ticket-saver";
import { clearOfflineTickets, reconcileOfflineTickets } from "../../../lib/offline-tickets";
import TicketTransfer from "./ticket-transfer";
import TicketReturn from "./ticket-return";
import SupportCentre from "./support-centre";

type EventSummary = {
  slug: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  fullDate: string;
  time: string;
  venue: string;
  area: string;
  image: string;
  venueMapUrl: string | null;
  lineup: string;
  ageRestriction: string;
  eventState: string;
};
type Question = {
  id: string;
  prompt: string;
  kind: "text" | "choice";
  options: string[];
  required: boolean;
  answer: string;
};
type Update = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  publishedBy: string;
};
type Experience = {
  attendee: { displayName: string };
  preference: { attendeeVisible: boolean; keepPosted: boolean };
  questions: Question[];
  updates: Update[];
  memories: Array<{
    id: string;
    title: string;
    body: string;
    imageUrl: string | null;
    publishedAt: string;
    publishedBy: string;
  }>;
  visibleAttendees: number;
};
type GateTicket = {
  id: string;
  ticketType: string;
  status: string;
  checkedInAt: string | null;
  gateCode: string | null;
  qrPayload: string | null;
};
type TicketOrder = {
  roomAccess?: boolean;
  orderId: string;
  reference: string;
  eventSlug: string;
  faceAmountMinor: number;
  bookingFeeMinor: number;
  totalAmountMinor: number;
  currency: string;
  paidAt: string | null;
  bookedFor: string | null;
  canViewPurchase: boolean;
  tierName: string | null;
  tierDescription: string | null;
  roomBadge: "VIP" | null;
  tickets: GateTicket[];
};
type View = "passes" | "details";

// Preserve links in receipts, notifications and already-installed apps.
function resolveView(requested: string | null): View {
  return requested === "details" || requested === "overview" || requested === "tonight"
    ? "details" : "passes";
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function humanTicket(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export default function NightHub({ event }: { event: EventSummary }) {
  const params = useSearchParams();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [wallet, setWallet] = useState({ apple: false, google: false });
  const [view, setView] = useState<View>(() => resolveView(params.get("view")));
  const [bookingOpen, setBookingOpen] = useState(() => params.get("view") === "purchase");
  const [perksOpen, setPerksOpen] = useState(() => params.get("view") === "perks");
  const requestedView = params.get("view");
  const [previousRequestedView, setPreviousRequestedView] = useState(requestedView);
  if (requestedView !== previousRequestedView) {
    setPreviousRequestedView(requestedView);
    setView(resolveView(requestedView));
    setBookingOpen(requestedView === "purchase");
    setPerksOpen(requestedView === "perks");
  }
  function chooseView(next: View) {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(() =>
    params.get("welcome") === "1"
      ? "You’re going. Tell the group chat."
      : "",
  );
  const [locked, setLocked] = useState(false);
  const [offlineOwnerId, setOfflineOwnerId] = useState("");
  const now = useCurrentTime();
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const saveBusy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const options = { cache: "no-store" as const, signal: controller.signal };
    Promise.all([
      requestJson<Experience>(`/api/customer/experience/${encodeURIComponent(event.slug)}`, options),
      requestJson<{ orders: TicketOrder[]; attendee: { attendeeId: string } }>("/api/customer/tickets", { ...options, method: "POST" }),
      // An optional Wallet provider outage must not hide the guest's entry pass.
      requestJson<{ apple: boolean; google: boolean }>("/api/customer/wallet/config", options)
        .catch(() => ({ apple: false, google: false })),
    ]).then(([experienceData, ticketsData, walletData]) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(experienceData.questions) || !Array.isArray(experienceData.updates) || !Array.isArray(ticketsData.orders) || !ticketsData.attendee?.attendeeId) {
        throw new Error("We couldn't load your night. Try again.");
      }
      reconcileOfflineTickets(ticketsData.attendee.attendeeId, ticketsData.orders.flatMap((order) => order.tickets.filter((ticket) => ticket.status === "issued" && ticket.qrPayload).map((ticket) => ticket.id)));
      setOfflineOwnerId(ticketsData.attendee.attendeeId);
      setExperience(experienceData);
      setAnswers(Object.fromEntries(experienceData.questions.map((question) => [question.id, question.answer])));
      setOrders(ticketsData.orders.filter((order) => order.eventSlug === event.slug));
      setWallet(walletData);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof RequestError && [401, 403].includes(error.status ?? 0)) {
        if (error.status === 401) clearOfflineTickets();
        setLocked(true);
      } else setLoadError("We couldn't load your night. Check your connection and try again.");
    });
    return () => controller.abort();
  }, [event.slug, retry]);

  const tickets = useMemo(
    () => orders.flatMap((order) => order.tickets),
    [orders],
  );
  const hoursUntil = Math.ceil(
    ((event.startsAt ? Date.parse(event.startsAt) : Infinity) - now) / (60 * 60 * 1000),
  );
  const compactDate = (value: string) =>
    new Date(value).toISOString().replace(/[-:]|\.\d{3}/gu, "");
  const googleCalendarUrl = event.startsAt && event.endsAt ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${compactDate(event.startsAt)}/${compactDate(event.endsAt)}&location=${encodeURIComponent(`${event.venue}, ${event.area}`)}&details=${encodeURIComponent(`Open My Nights for your ticket and live Host updates: https://tickets.becoreops.com/my-nights/${event.slug}`)}` : null;

  async function save(input: {
    attendeeVisible?: boolean;
    keepPosted?: boolean;
    includeAnswers?: boolean;
  }) {
    if (!experience || saveBusy.current) return;
    saveBusy.current = true;
    setSaving(true);
    setNotice("");
    const body = {
      attendeeVisible:
        input.attendeeVisible ?? experience.preference.attendeeVisible,
      keepPosted: input.keepPosted ?? experience.preference.keepPosted,
      answers: input.includeAnswers
        ? experience.questions.map((question) => ({
            questionId: question.id,
            answer: answers[question.id] ?? "",
          }))
        : [],
    };
    try {
      const data = await requestJson<{ preference?: Experience["preference"] }>(
        `/api/customer/experience/${encodeURIComponent(event.slug)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      setExperience((current) => {
        if (!current) return current;
        const preference = data.preference ?? current.preference;
        const visibilityChange = Number(preference.attendeeVisible) - Number(current.preference.attendeeVisible);
        return { ...current, preference, visibleAttendees: Math.max(0, current.visibleAttendees + visibilityChange) };
      });
      setNotice(input.includeAnswers ? "Saved. The Host can stop guessing now." : "Preference saved.");
    } catch (error) {
      setNotice(requestErrorMessage(error));
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  }

  if (loadError) return <main className="night-hub night-hub--locked"><section>
    <h1>Your night is taking a moment.</h1><p role="alert">{loadError}</p>
    <button className="night-hub__retry" type="button" onClick={() => { setLoadError(""); setRetry((value) => value + 1); }}>Try again</button>
    <Link href="/my-nights">Back to My Nights</Link>
  </section></main>;

  if (locked)
    return (
      <main className="night-hub night-hub--locked">
        <section>
          <LockKeyhole size={30} />
          <h1>This night needs its ticket.</h1>
          <p>
            Use your booking or registration email in My Nights to recover access.
          </p>
          <Link href="/my-nights">Bring back My Nights</Link>
        </section>
      </main>
    );
  if (!experience)
    return (
      <main className="night-hub night-hub--loading">
        <Loader2 className="spin" />
        <span>Getting your night together</span>
      </main>
    );

  return (
    <main className="night-hub night-hub--member">
      <OfflineTicketSaver
        ownerId={offlineOwnerId}
        event={{
          slug: event.slug,
          title: event.title,
          fullDate: event.fullDate,
          time: event.time,
          venue: event.venue,
          area: event.area,
          endsAt: event.endsAt,
        }}
        tickets={tickets}
      />
      <header className="night-hub__header">
        <Link href="/my-nights">
          <ArrowLeft size={16} /> My Nights
        </Link>
        <Link href="/" className="brand-mark"><BrandLogo /></Link>
        <span className="night-hub__header-actions">
          <PublicNavigation />
          <NotificationBell />
        </span>
      </header>
      <section className="night-hub__hero">
        <img src={event.image} alt={`Atmosphere for ${event.title}`} />
        <div>
          <p className="eyebrow">You’re on the list</p>
          <h1>{event.title}</h1>
          <span>
            {event.venue} · {event.area}
          </span>
        </div>
        <p className="night-hub__countdown">
          {["cancelled", "postponed"].includes(event.eventState) ? (event.eventState === "cancelled" ? "Event cancelled" : "New date coming") : event.endsAt && Date.parse(event.endsAt) <= now ? "That was a night." : !event.startsAt ? "Coming soon" : hoursUntil > 24
            ? `${Math.ceil(hoursUntil / 24)} days to go`
            : hoursUntil > 0
              ? `${hoursUntil} hours to go`
              : "The night is happening"}
        </p>
      </section>
      <nav className="night-hub__tabs" aria-label="Night views">
        <button type="button" aria-current={view === "passes" ? "page" : undefined} onClick={() => chooseView("passes")}><QrCode size={17} /> Ticket <span>{tickets.length}</span></button>
        <button type="button" aria-current={view === "details" ? "page" : undefined} onClick={() => chooseView("details")}><CalendarDays size={17} /> The Night</button>
        {orders.some((order) => order.roomAccess !== false) ? <Link href={`/room/${event.slug}`}><MessageCircle size={17} /> Room</Link> : null}
      </nav>
      <section className="night-hub__view">
        {notice ? (
          <button
            className="night-hub__notice"
            type="button"
            onClick={() => setNotice("")}
          >
            {notice}
            <span>Tap to dismiss</span>
          </button>
        ) : null}

        {view === "passes" ? (
          <div className="night-passes">
            <header>
              <div><p className="eyebrow">Skip the rummaging</p><h2>You’re good to go.</h2></div>
              <Link
                className="night-passes__offline"
                href="/offline-ticket.html"
              >
                <WalletCards size={15} /> Open offline door pass
              </Link>
            </header>
            <div className="night-passes__tickets">
              {!tickets.length ? <p className="night-passes__empty">No entry passes here yet. Your booking details are below.</p> : null}
              {tickets.map((ticket, index) => (
                <article key={ticket.id}>
                  <span>Ticket {index + 1}</span>
                  <b>{humanTicket(ticket.ticketType)}</b>
                  {ticket.qrPayload && ticket.gateCode ? (
                    <>
                      <QrPass
                        payload={ticket.qrPayload}
                        label={`Entry QR code for ticket ${index + 1}`}
                      />
                      <code>{ticket.gateCode}</code>
                      {wallet.apple || wallet.google ? (
                        <div className="ticket-wallet-actions">
                          {wallet.apple ? (
                            <a
                              href={`/api/customer/wallet/${encodeURIComponent(ticket.id)}?platform=apple`}
                            >
                              <WalletCards size={13} /> Add to Apple Wallet
                            </a>
                          ) : null}
                          {wallet.google ? (
                            <a
                              href={`/api/customer/wallet/${encodeURIComponent(ticket.id)}?platform=google`}
                            >
                              <WalletCards size={13} /> Add to Google Wallet
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                      {ticket.ticketType !== "RSVP" ? <>
                      <TicketTransfer
                        ticketId={ticket.id}
                        disabled={ticket.status !== "issued"}
                      />
                      <TicketReturn
                        ticketId={ticket.id}
                        disabled={ticket.status !== "issued"}
                      />
                      </> : <Link href="/my-nights">Manage RSVP</Link>}
                    </>
                  ) : (
                    <p>
                      {ticket.status === "checked_in"
                        ? "Already inside. Excellent."
                        : "This ticket is taking a moment."}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {view === "passes" ? (
          <details className="night-perks night-hub__disclosure" open={perksOpen} onToggle={(event) => setPerksOpen(event.currentTarget.open)}>
            <summary><Crown size={18} /> What comes with it</summary>
            <div className="night-perks__tiers">
              {orders.map((order) => (
                <article key={order.orderId}>
                  <Crown size={20} />
                  <span>
                    {order.tickets.length}{" "}
                    {order.tickets.length === 1 ? "admission" : "admissions"}
                  </span>
                  <h3>
                    {order.tierName ??
                      humanTicket(order.tickets[0]?.ticketType ?? "Admission")}
                  </h3>
                  <p>
                    {order.tierDescription ??
                      "Entry to the event and every ticket-holder feature inside My Nights."}
                  </p>
                  <small>
                    <Sparkles size={12} />{" "}
                    {order.roomBadge === "VIP"
                      ? "Your VIP badge and a private line to the host when concierge is open."
                      : order.roomAccess === false ? "Your RSVP gets you through the door." : "The Room, host updates and Flashes are yours."}
                  </small>
                </article>
              ))}
            </div>
          </details>
        ) : null}

        {view === "details" ? (
          <div className="night-details">
            <header>
              <p className="eyebrow">Make an entrance</p>
              <h2>The plan.</h2>
              {event.startsAt ? <div className="night-calendar-actions">
                <a href={`/api/calendar/${encodeURIComponent(event.slug)}`}>
                  <CalendarDays size={14} /> Apple / Outlook calendar
                </a>
                {googleCalendarUrl ? <a href={googleCalendarUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Google Calendar
                </a> : null}
              </div> : null}
            </header>
            <dl>
              <div>
                <dt>
                  <CalendarDays /> Date
                </dt>
                <dd>{event.fullDate}</dd>
              </div>
              <div>
                <dt>
                  <Clock3 /> Time
                </dt>
                <dd>{event.time}</dd>
              </div>
              <div>
                <dt>
                  <MapPin /> Venue
                </dt>
                <dd>
                  {event.venue}, {event.area}
                  {event.venueMapUrl ? (
                    <Link
                      href={event.venueMapUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open directions <ExternalLink size={12} />
                    </Link>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>
                  <Ticket /> Entry
                </dt>
                <dd>
                  {event.ageRestriction} · Valid government-issued ID · One scan
                  per admission
                </dd>
              </div>
              <div>
                <dt>
                  <Sparkles /> Line-up
                </dt>
                <dd>{event.lineup}</dd>
              </div>
            </dl>
            <section className="night-attendance">
              <div><h3>Count me in</h3><p>Add yourself to the crowd count. Your name stays private.</p></div>
              <button type="button" role="switch" aria-label="Count me in" aria-checked={experience.preference.attendeeVisible} disabled={saving} onClick={() => void save({ attendeeVisible: !experience.preference.attendeeVisible })}>
                {experience.preference.attendeeVisible ? <Check size={16} /> : <Users size={16} />}
                {experience.preference.attendeeVisible ? "I’m in" : "Join the count"}
              </button>
              <span>{experience.visibleAttendees} {experience.visibleAttendees === 1 ? "person" : "people"} going</span>
            </section>
            {experience.questions.length ? (
            <form
              className="before-night"
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void save({ includeAnswers: true });
              }}
            >
              <header>
                <p className="eyebrow">Before the Night</p>
                <h2>Help the event team prepare.</h2>
                <p>
                  Only the host’s event team can see these
                  answers for this Night.
                </p>
              </header>
              {experience.questions.length ? (
                experience.questions.map((question) => (
                  <label key={question.id}>
                    <span>
                      {question.prompt}
                      {question.required ? " *" : ""}
                    </span>
                    {question.kind === "choice" ? (
                      <select
                        required={question.required}
                        value={answers[question.id] ?? ""}
                        onChange={(changeEvent) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: changeEvent.target.value,
                          }))
                        }
                      >
                        <option value="">Choose one</option>
                        {question.options.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <textarea
                        maxLength={500}
                        required={question.required}
                        value={answers[question.id] ?? ""}
                        onChange={(changeEvent) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: changeEvent.target.value,
                          }))
                        }
                      />
                    )}
                  </label>
                ))
              ) : (
                <p>
                  No questions from the Host yet. Suspiciously low-maintenance.
                </p>
              )}
              <button
                type="submit"
                disabled={saving || !experience.questions.length}
              >
                {saving ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <Save size={15} />
                )}{" "}
                Save answers
              </button>
            </form>
            ) : null}
            <section className="night-updates">
              <header>
                <div>
                  <h2>From the host</h2>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    save({ keepPosted: !experience.preference.keepPosted })
                  }
                >
                  {experience.preference.keepPosted ? (
                    <Check size={14} />
                  ) : (
                    <Bell size={14} />
                  )}
                  {experience.preference.keepPosted
                    ? "Keeping you posted"
                    : "Keep me posted"}
                </button>
              </header>
              {experience.updates.length ? (
                experience.updates.map((update) => (
                  <article key={update.id}>
                    <div>
                      <span>{update.pinned ? "Pinned" : "Update"}</span>
                      <time>
                        {new Intl.DateTimeFormat("en-GH", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Africa/Accra",
                        }).format(new Date(update.publishedAt))}
                      </time>
                    </div>
                    <h3>{update.title}</h3>
                    <p>{update.body}</p>
                    <small>{update.publishedBy}</small>
                  </article>
                ))
              ) : (
                <p className="night-updates__empty">
                  No update from the Host yet. Silence, but the calm kind.
                </p>
              )}
            </section>
            {experience.memories.length ? (
              <section className="night-memories">
                <header>
                  <p className="eyebrow">Official memories</p>
                  <h2>The Host kept the good bits.</h2>
                </header>
                {experience.memories.map((memory) => (
                  <article key={memory.id}>
                    {memory.imageUrl ? (
                      <img src={memory.imageUrl} alt="" />
                    ) : null}
                    <div>
                      <h3>{memory.title}</h3>
                      <p>{memory.body}</p>
                      <small>{memory.publishedBy}</small>
                    </div>
                  </article>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}

        {view === "passes" ? (
          <details className="night-purchase night-hub__disclosure" open={bookingOpen} onToggle={(event) => setBookingOpen(event.currentTarget.open)}>
            <summary><CircleDollarSign size={18} /> Booking &amp; help</summary>
            {orders.some((order) => order.canViewPurchase) ? (
              orders
                .filter((order) => order.canViewPurchase)
                .map((order) => (
                  <article key={order.orderId}>
                    <header>
                      <div>
                        <CircleDollarSign />
                        <span>
                          <b>
                            {order.tierName ??
                              humanTicket(
                                order.tickets[0]?.ticketType ?? "Admission",
                              )}
                          </b>
                          <small>{order.reference}</small>
                        </span>
                      </div>
                      <button type="button" onClick={() => window.print()}>
                        <Download size={14} /> Print / save
                      </button>
                    </header>
                    <dl>
                      <div>
                        <dt>Ticket subtotal</dt>
                        <dd>{money(order.faceAmountMinor, order.currency)}</dd>
                      </div>
                      <div>
                        <dt>Booking fee</dt>
                        <dd>{money(order.bookingFeeMinor, order.currency)}</dd>
                      </div>
                      <div>
                        <dt>Total paid</dt>
                        <dd>{money(order.totalAmountMinor, order.currency)}</dd>
                      </div>
                      <div>
                        <dt>Confirmed</dt>
                        <dd>
                          {order.paidAt
                            ? new Intl.DateTimeFormat("en-GH", {
                                dateStyle: "medium",
                                timeStyle: "short",
                                timeZone: "Africa/Accra",
                              }).format(new Date(order.paidAt))
                            : "Payment confirmed"}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))
            ) : (
              <p className="night-purchase__transferred">
                This ticket was transferred to you. Admission, The Room and
                ticket-linked perks came along; the purchaser’s receipt stayed
                private.
              </p>
            )}
            <SupportCentre slug={event.slug} />
          </details>
        ) : null}
      </section>

    </main>
  );
}
