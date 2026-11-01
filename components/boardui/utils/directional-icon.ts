// Adapted from BoardUI, MIT. See components/boardui/LICENSE and PROVENANCE.json.
import {
  ArrowLeft,
  ChevronLeft,
  ArrowRight,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

/** Navigation glyphs mirror; logos, media controls and trend arrows do not. */
const directionalIcons: ReadonlySet<unknown> = new Set([
  ArrowLeft, ChevronLeft, ArrowRight, ChevronRight,
  PanelLeftClose, PanelLeftOpen,
]);

export function directionalIconClass(icon: unknown): string | undefined {
  return directionalIcons.has(icon) ? "rtl:rotate-180" : undefined;
}
