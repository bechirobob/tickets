import type { CSSProperties } from "react";

export const eventColourSchemes = {
  blush: { label: "Blush, white & sage", paper: "#fff9f8", ink: "#39232e", muted: "#71525f", accent: "#983b60", wash: "#f3dce3", secondary: "#536953", dark: "#39232e" },
  sunset: { label: "Champagne & terracotta", paper: "#fcf5eb", ink: "#382c22", muted: "#6f5947", accent: "#984a2f", wash: "#ebd7b7", secondary: "#61705a", dark: "#382c22" },
  midnight: { label: "Charcoal & citrus", paper: "#f2f3e9", ink: "#242c20", muted: "#59604c", accent: "#526421", wash: "#dde4c6", secondary: "#66652d", dark: "#242c20" },
  blue: { label: "Ice blue & ink", paper: "#f3f7fa", ink: "#243447", muted: "#516478", accent: "#365b83", wash: "#dce6ef", secondary: "#5b6861", dark: "#243447" },
  plum: { label: "Lilac & plum", paper: "#fbf5fb", ink: "#3c2944", muted: "#6d5375", accent: "#80448e", wash: "#e9dced", secondary: "#615b77", dark: "#3c2944" },
} as const;

export type EventColourScheme = keyof typeof eventColourSchemes;
type EventPresentation = { vibe: string; colourScheme?: string | null };
const defaultSchemes: Record<string, EventColourScheme> = { "Day party": "sunset", "Late night": "midnight", "Alté": "blue", "Amapiano": "plum" };

export function isEventColourScheme(value: string): value is EventColourScheme {
  return Object.hasOwn(eventColourSchemes, value);
}

export function eventColourScheme(event: EventPresentation): EventColourScheme {
  return event.colourScheme && isEventColourScheme(event.colourScheme) ? event.colourScheme : defaultSchemes[event.vibe] ?? "midnight";
}

export function eventPresentationStyle(event: EventPresentation): CSSProperties {
  const palette = eventColourSchemes[eventColourScheme(event)];
  return {
    "--event-paper": palette.paper, "--event-ink": palette.ink,
    "--event-muted": palette.muted, "--event-accent": palette.accent,
    "--event-wash": palette.wash, "--event-secondary": palette.secondary,
    "--event-dark": palette.dark,
    "--event-field": eventColourScheme(event) === "blush" ? "#e8bdcc" : palette.wash,
  } as CSSProperties;
}

// The mobile dock is outside the event main. Scope its inherited tokens to the
// rendered event so client navigation never carries event colours onto discovery.
export function eventShellStyles(event: EventPresentation): string {
  const scheme = eventColourScheme(event);
  const palette = eventColourSchemes[scheme];
  return `body:has(.poster-event-page[data-colour-scheme="${scheme}"]) { --event-shell-paper: ${palette.paper}; --event-shell-wash: ${palette.wash}; --event-shell-ink: ${palette.ink}; --event-shell-muted: ${palette.muted}; }`;
}
