import type { ReactNode } from "react";

/** Shared by the live conversation and the scaled homepage phones. */
export function RoomComposeContent({ accessory, field, send, detail }: { accessory: ReactNode; field: ReactNode; send: ReactNode; detail?: ReactNode }) {
  return <><span className="chat-compose-accessory">{accessory}</span><div className="chat-compose-field">{field}{detail}{send}</div></>;
}

export function RoomReaction({ emoji, count }: { emoji: string; count: number }) {
  return <span className="chat-reaction"><i aria-hidden="true">{emoji}</i>{count > 1 && <b>{count}</b>}</span>;
}
