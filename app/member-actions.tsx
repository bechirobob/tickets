"use client";

import { Bell, Check, Loader2, UserRoundPlus } from "lucide-react";
import { useEffect, useState } from "react";

export default function MemberActions({ eventSlug, hostSlug }: { eventSlug?: string; hostSlug?: string }) {
  const [member, setMember] = useState<boolean | null>(null);
  const [keepPosted, setKeepPosted] = useState(false);
  const [followingHost, setFollowingHost] = useState(false);
  const [working, setWorking] = useState<"event" | "host" | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const query = new URLSearchParams();
    if (eventSlug) query.set("event", eventSlug);
    if (hostSlug) query.set("host", hostSlug);
    fetch(`/api/customer/preferences?${query.toString()}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { member?: boolean; keepPosted?: boolean; followingHost?: boolean } }))
      .then(({ response, data }) => {
        setMember(response.ok && Boolean(data.member));
        setKeepPosted(Boolean(data.keepPosted));
        setFollowingHost(Boolean(data.followingHost));
      })
      .catch(() => setMember(false));
  }, [eventSlug, hostSlug]);

  async function update(kind: "event" | "host") {
    setWorking(kind);
    setNotice("");
    const payload = kind === "event" ? { eventSlug, keepPosted: !keepPosted } : { hostSlug, followingHost: !followingHost };
    try {
      const response = await fetch("/api/customer/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string; keepPosted?: boolean; followingHost?: boolean };
      if (!response.ok) throw new Error(data.error ?? "That preference could not be saved.");
      if (kind === "event") setKeepPosted(Boolean(data.keepPosted)); else setFollowingHost(Boolean(data.followingHost));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save. Check your connection and try again.");
    } finally {
      setWorking(null);
    }
  }

  if (member === null) return <div className="member-actions member-actions--loading"><Loader2 className="spin" size={15} /> Checking member access</div>;
  if (!member) return <p className="member-locked-note">Keep me posted and Host follows unlock after your first verified BeCore ticket.</p>;
  return <div className="member-actions">
    {eventSlug ? <button type="button" onClick={() => update("event")} disabled={working !== null}>{working === "event" ? <Loader2 className="spin" size={14} /> : keepPosted ? <Check size={14} /> : <Bell size={14} />}{keepPosted ? "Keeping you posted" : "Keep me posted"}</button> : null}
    {hostSlug ? <button type="button" onClick={() => update("host")} disabled={working !== null}>{working === "host" ? <Loader2 className="spin" size={14} /> : followingHost ? <Check size={14} /> : <UserRoundPlus size={14} />}{followingHost ? "Following Host" : "Follow Host"}</button> : null}
    {notice ? <p role="alert">{notice}</p> : null}
  </div>;
}
