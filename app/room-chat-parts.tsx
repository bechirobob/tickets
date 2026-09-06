import { Aperture, Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** Shared by the live conversation and the scaled homepage phones. */
export function RoomComposeContent({ accessory, field, send, detail }: { accessory: ReactNode; field: ReactNode; send: ReactNode; detail?: ReactNode }) {
  return <><span className="chat-compose-accessory">{accessory}</span><div className="chat-compose-field">{field}{detail}{send}</div></>;
}

export function RoomReaction({ emoji, count }: { emoji: string; count: number }) {
  return <span className="chat-reaction"><i aria-hidden="true">{emoji}</i>{count > 1 && <b>{count}</b>}</span>;
}

/** Unopened media is a small invitation; the photograph belongs in the viewer. */
export function FlashMarker({ opened = false, mine = false }: { opened?: boolean; mine?: boolean }) {
  return <span className={`flash-mark${opened && !mine ? " is-opened" : ""}`}>
    <span className="flash-mark__glyph" aria-hidden="true">{opened && !mine ? <Check size={18} /> : <Aperture size={22} />}</span>
    <span><b>Flash</b><small>{mine ? "Sent · preview" : opened ? "Opened" : "Tap to open · once"}</small></span>
    {!opened || mine ? <ChevronRight size={13} aria-hidden="true" /> : null}
  </span>;
}
