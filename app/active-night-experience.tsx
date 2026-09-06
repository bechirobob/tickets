"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  BatteryFull,
  Camera,
  ConciergeBell,
  Gem,
  LockKeyhole,
  Signal,
  Ticket,
  Wifi,
} from "lucide-react";
import type { CSSProperties, FocusEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import EventExplorer from "./event-explorer";
import { eventImageUrl } from "./event-images";
import type { CuratedEvent } from "./events";
import RoomPreviewCarousel from "./room-preview-carousel";
import { FlashMarker, RoomComposeContent, RoomReaction } from "./room-chat-parts";
import { ActionLink } from "./action";
import { discoveryPrice } from "../lib/event-pricing";

const sceneInterval = 4_500;
const fallbackImage = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=88";

const sceneThemes: Record<CuratedEvent["vibe"], { acid: string; signal: string; bone: string; dark: string }> = {
  "Late night": { acid: "#d7f45b", signal: "#bd3f11", bone: "#f1eee6", dark: "#10110f" },
  "Day party": { acid: "#f0d36d", signal: "#a94718", bone: "#f4efe2", dark: "#16130d" },
  "Alté": { acid: "#c8d9f2", signal: "#a74432", bone: "#edf0ef", dark: "#101216" },
  "Amapiano": { acid: "#e2c9eb", signal: "#963d50", bone: "#f2ecee", dark: "#151014" },
};

function HostUpdate({ label, time, dateTime, title, detail, compact = false }: { label: string; time: string; dateTime: string; title: string; detail: string; compact?: boolean }) {
  return <article className={`scene-host${compact ? " scene-host--compact" : ""}`}>
    <span className="scene-host__mark" aria-hidden="true"><BadgeCheck size={14} /></span>
    <div className="scene-host__content">
      <header><small>{label}</small><time dateTime={dateTime}>{time}</time></header>
      <p><strong>{title}</strong> <span>{detail}</span></p>
    </div>
  </article>;
}

function RoomPhone({ event, heroImage, conversation }: { event: CuratedEvent | null; heroImage: string; conversation: "arrival" | "inside" }) {
  const eventTitle = event?.title ?? "After Dark";
  const area = event?.area ?? "Osu";

  return <article className={`room-product-phone room-product-phone--${conversation}`} role="group" aria-roledescription="slide" aria-label={conversation === "arrival" ? "Before arrival, 1 of 2" : "Inside the night, 2 of 2"}>
    <Image className="room-product-phone__render" src="/devices/iphone-black-titanium.png" width={1024} height={1536} alt="" aria-hidden="true" unoptimized />
    <div className="room-product-phone__display">
    <div className="room-product-phone__hardware" aria-hidden="true"><span>{conversation === "arrival" ? "9:24" : "10:48"}</span><i /><b><Signal size={9} /><span>5G</span><Wifi size={10} /><BatteryFull size={13} /></b></div>
    <div className="room-product-phone__screen">
      <header className="room-product-phone__header"><Image src={eventImageUrl(heroImage, 120)} width={24} height={30} alt="" aria-hidden="true" unoptimized /><div><small>The Room</small><b>{eventTitle}</b></div><span>Preview</span></header>
      <div key={event?.slug ?? "waiting"} className="room-product-phone__stream">
        {conversation === "arrival" ? <>
          <article className="scene-message"><span>K</span><div className="scene-message__body"><small className="scene-message__meta">Kofi · 9:18 PM</small><div className="chat-message-anchor"><div className="scene-message__bubble"><p>Who is actually in {area} already?</p></div><div className="chat-tapbacks" aria-label="4 laughing reactions"><RoomReaction emoji="😂" count={4} /></div></div></div></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><small className="scene-message__meta">You · 9:19 PM</small><div className="chat-message-anchor"><div className="scene-message__bubble"><p>“Five minutes away” in the spiritual sense.</p></div><div className="chat-tapbacks" aria-label="2 laughing reactions"><RoomReaction emoji="😂" count={2} /></div></div></div></article>
          <article className="scene-message"><span>A</span><div className="scene-message__body"><small className="scene-message__meta">Ama · 9:20 PM</small><div className="chat-message-anchor"><div className="scene-message__bubble"><p>Send the pin. Abena’s coming too.</p></div></div></div></article>
          <article className="scene-message"><span>Y</span><div className="scene-message__body"><small className="scene-message__meta">Yaw · 9:22 PM</small><div className="chat-message-anchor"><div className="scene-message__bubble"><p>By the entrance. Look for the loud shirt.</p></div><div className="chat-tapbacks" aria-label="3 fire reactions"><RoomReaction emoji="🔥" count={3} /></div></div></div></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><small className="scene-message__meta">You · 9:24 PM</small><div className="chat-message-anchor"><div className="scene-message__bubble"><p>Found the car. Nobody move.</p></div></div></div></article>
        </> : <>
          <article className="scene-message"><span>A</span><div className="scene-message__body"><small className="scene-message__meta">Ama <b className="scene-vip-badge" title="VIP ticket holder"><Gem size={10} aria-hidden="true" /><span className="sr-only">VIP ticket holder</span></b> · 10:42 PM</small><div className="chat-message-anchor"><div className="scene-message__bubble"><p>{event?.vibe ?? "Front left"} is the move tonight.</p></div><div className="chat-tapbacks" aria-label="6 watching reactions"><RoomReaction emoji="👀" count={6} /></div></div></div></article>
          <article className="scene-flash-message"><small>Ama · 10:43 PM</small><FlashMarker /></article>
          <article className="scene-message scene-message--own"><div className="scene-message__body"><small className="scene-message__meta">You · 10:44 PM</small><div className="chat-message-anchor"><div className="scene-message__bubble"><p>Found you. This set is ridiculous.</p></div><div className="chat-tapbacks" aria-label="5 fire reactions"><RoomReaction emoji="🔥" count={5} /></div></div></div></article>
          <HostUpdate label="HOST UPDATE" time="10:47 PM" dateTime="22:47" title="Gate change." detail="Use Gate 2 for last entry." compact />
        </>}
      </div>
      <div className="room-product-phone__composer chat-compose-bar" aria-hidden="true"><RoomComposeContent accessory={<>{conversation === "inside" && <span className="scene-concierge" aria-label="VIP concierge"><ConciergeBell size={15} /></span>}<Camera size={17} /></>} field={<span className="chat-compose-placeholder">Message The Room</span>} send={<span className="chat-send"><ArrowUp size={16} /></span>} /></div>
    </div>
    <span className="room-product-phone__home" aria-hidden="true" />
    </div>
  </article>;
}

export default function ActiveNightExperience({ events }: { events: CuratedEvent[] }) {
  const [observedAt] = useState(() => Date.now());
  const scenes = useMemo(() => events.filter((event) => event.eventState !== "cancelled" && event.eventState !== "postponed" && Date.parse(event.endsAt) > observedAt).slice(0, 4), [events, observedAt]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [manualPause, setManualPause] = useState(false);
  const [interactionPause, setInteractionPause] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [sceneVisible, setSceneVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const roomRef = useRef<HTMLElement>(null);
  const active = scenes[activeIndex] ?? null;
  const previous = previousIndex === null ? null : scenes[previousIndex] ?? null;
  const heroImage = active?.image ?? fallbackImage;
  const theme = sceneThemes[active?.vibe ?? "Late night"];
  const hasScenes = scenes.length > 1;
  const autoplayRunning = hasScenes && !manualPause && !interactionPause && !documentHidden && sceneVisible && !reducedMotion;
  const sceneStyle = {
    "--acid": theme.acid,
    "--signal": theme.signal,
    "--bone": theme.bone,
    "--scene-dark": theme.dark,
  } as CSSProperties;

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motionQuery.matches);
    updateMotion();
    motionQuery.addEventListener("change", updateMotion);
    return () => motionQuery.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setDocumentHidden(document.visibilityState !== "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const surfaces = [heroRef.current, roomRef.current].filter((surface): surface is HTMLElement => surface !== null);
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setSceneVisible(visible.size > 0);
    }, { threshold: 0.05 });
    surfaces.forEach((surface) => observer.observe(surface));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoplayRunning) return;
    const timer = window.setTimeout(() => {
      setPreviousIndex(activeIndex);
      setActiveIndex((activeIndex + 1) % scenes.length);
    }, sceneInterval);
    return () => window.clearTimeout(timer);
  }, [activeIndex, autoplayRunning, scenes.length]);

  useEffect(() => {
    if (previousIndex === null) return;
    const timer = window.setTimeout(() => setPreviousIndex(null), 900);
    return () => window.clearTimeout(timer);
  }, [activeIndex, previousIndex]);

  useEffect(() => {
    if (!hasScenes || reducedMotion) return;
    const next = scenes[(activeIndex + 1) % scenes.length];
    const preload = new window.Image();
    preload.src = eventImageUrl(next.image, 1600, 78);
  }, [activeIndex, hasScenes, reducedMotion, scenes]);

  function toggleAutoplay() {
    if (reducedMotion) return;
    setManualPause((paused) => !paused);
  }

  function leaveFocus(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteractionPause(false);
  }

  return <div className="active-night-experience" style={sceneStyle} data-active-night={active?.slug ?? "waiting"}>
    <section
      ref={heroRef}
      className="compact-hero active-night-hero"
      role="region"
      aria-roledescription={hasScenes ? "carousel" : undefined}
      aria-label="Featured nights"
      onFocusCapture={() => setInteractionPause(true)}
      onBlurCapture={leaveFocus}
    >
      {previous ? <Image key={`previous-${previous.slug}`} className="compact-hero__image compact-hero__image--outgoing" src={eventImageUrl(previous.image, 1600, 78)} width={1600} height={900} sizes="100vw" alt="" aria-hidden="true" unoptimized /> : null}
      <Image key={active?.slug ?? "waiting"} className="compact-hero__image compact-hero__image--active" src={eventImageUrl(heroImage, 1600, 78)} width={1600} height={900} sizes="100vw" alt={active ? `Atmosphere for ${active.title}` : "A crowd under warm stage lights at night"} priority={activeIndex === 0} unoptimized />
      <div key={`shade-${active?.slug ?? "waiting"}`} className="compact-hero__shade" />
      <div key={`copy-${active?.slug ?? "waiting"}`} className="compact-hero__copy" aria-live={autoplayRunning ? "off" : "polite"} aria-atomic="true">
        <p className="night-kicker hero-editor-note"><span /> {active?.quip ?? "Your next good excuse to go out."}{active?.isTestEvent ? <small> / Preview</small> : null}</p>
        <h1>{active?.title ?? "Plans, sorted."}</h1>
        <p>{active ? `${active.vibe} · ${active.day} ${active.shortDate} · ${active.time.split(" — ")[0]}` : "Discover music, people and places worth going out for."}</p>
        {active ? <p className="hero-venue">{active.venue}, {active.area}</p> : null}
        {active ? <div className="hero-actions">{active.ticketTiers.some((tier) => tier.status === "available") ? <ActionLink href={`/checkout/${active.slug}`} icon={<Ticket size={18} />}>Get tickets</ActionLink> : <ActionLink href="/events">Browse events</ActionLink>}<ActionLink href={`/event/${active.slug}`} variant="text">Explore the night</ActionLink></div> : <ActionLink href="/events" className="compact-hero__single">Explore The Drop</ActionLink>}
      </div>
      {active ? <p className="compact-hero__price" aria-label={`Tickets from GH₵${discoveryPrice(active)}`}>From <b>GH₵{discoveryPrice(active)}</b></p> : null}
      {hasScenes ? <button
        type="button"
        className="active-night-autoplay-toggle"
        aria-label={manualPause ? "Resume featured nights" : "Pause featured nights"}
        aria-pressed={manualPause || reducedMotion}
        disabled={reducedMotion}
        onClick={toggleAutoplay}
      >{manualPause ? "Resume featured nights" : "Pause featured nights"}</button> : null}
    </section>

    <section className="night-drop night-drop--compact" id="drop">
      <div className="compact-section-head"><div><p className="night-kicker"><span /> The Drop / Accra</p><h2>Where are we going?</h2></div><Link href="/events">All events <ArrowRight size={15} /></Link></div>
      <EventExplorer events={events} featuredSlug={active?.slug} />
    </section>

    <section ref={roomRef} className="room-product-scene active-night-room" id="the-room" data-scroll-reveal onFocusCapture={() => setInteractionPause(true)} onBlurCapture={leaveFocus}>
      <Image className="room-product-scene__atmosphere" src={eventImageUrl(heroImage, 1200, 75)} width={1200} height={800} sizes="100vw" alt="" aria-hidden="true" unoptimized />
      <div className="room-product-scene__copy"><p className="night-kicker"><span /> You’re already on the inside</p><h2>The night has a Room.</h2><p>Find your people before you find the dance floor. Host updates, a little banter and Flashes you get one look at.</p><span><LockKeyhole size={13} /> Private to verified ticket holders</span></div>
      <RoomPreviewCarousel>
        <RoomPhone event={active} heroImage={heroImage} conversation="arrival" />
        <RoomPhone event={active} heroImage={heroImage} conversation="inside" />
      </RoomPreviewCarousel>
    </section>
  </div>;
}
