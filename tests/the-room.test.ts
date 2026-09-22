import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const policy = {
  eventSlug: "after-dark-osu",
  eventTitle: "After Dark: Osu",
  startsAt: "2026-08-14T22:00:00.000Z",
  endsAt: "2026-08-15T04:00:00.000Z",
  readOnlyAt: "2026-08-18T04:00:00.000Z",
  readOnly: false,
};

describe("The Room Durable Object", () => {
  it("converges presence after a join burst and the last departure", async () => {
    const room = env.THE_ROOM.getByName(`presence-${crypto.randomUUID()}`);
    const sockets: WebSocket[] = [];
    const counts: number[][] = Array.from({ length: 20 }, () => []);
    const snapshots = new Set<number>();
    const future = new Date(Date.now() + 86400000).toISOString();
    try {
      await Promise.all(counts.map(async (_, i) => {
        const response = await room.fetch(new Request("https://room.internal/socket", { headers: {
          upgrade: "websocket", "x-bct-room-authorized": "1",
          "x-bct-session-id": `presence-session-${i}`, "x-bct-attendee-id": `presence-guest-${i}`,
          "x-bct-display-name": `Guest ${i}`, "x-bct-event-slug": "presence-test",
          "x-bct-event-title": "Presence test", "x-bct-starts-at": new Date().toISOString(),
          "x-bct-ends-at": future, "x-bct-read-only-at": future,
        } }));
        expect(response.status).toBe(101);
        const socket = response.webSocket!;
        sockets[i] = socket;
        socket.addEventListener("message", event => {
          const data = JSON.parse(String(event.data));
          if (data.type === "snapshot") snapshots.add(i);
          if (data.type === "presence") counts[i].push(data.online);
        });
        socket.accept();
      }));
      await expect.poll(() => snapshots.size).toBe(20);
      await expect.poll(() => counts.every(values => values.at(-1) === 20)).toBe(true);
      // Broadcasting on every arrival would produce 210 frames for this burst.
      expect(counts.reduce((total, values) => total + values.length, 0)).toBeLessThan(210);
      sockets[19].close(1000, "Leaving");
      await expect.poll(() => counts.slice(0,19).every(values => values.at(-1) === 19)).toBe(true);
    } finally {
      for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Test complete");
    }
  });

  it("persists an organiser announcement and supports audited removal", async () => {
    const room = env.THE_ROOM.getByName("event-a");
    const announcement = await room.publishAnnouncement("BeCore Admin", "Doors open at 9:30 PM.", true, policy);

    expect(announcement.kind).toBe("announcement");
    expect(announcement.pinned).toBe(true);
    expect(await room.hasMessage(announcement.id)).toBe(true);
    expect(await room.getMessage(announcement.id)).toMatchObject({
      displayName: "BeCore Host",
      content: "Doors open at 9:30 PM.",
      deletedAt: null,
    });

    expect(await room.removeMessage(announcement.id)).toBe(true);
    expect(await room.hasMessage(announcement.id)).toBe(false);
    expect(await room.getMessage(announcement.id)).toMatchObject({
      content: "Doors open at 9:30 PM.",
    });
  });

  it("removes preview messages before the cutoff and keeps the current Room usable",async()=>{
    const room=env.THE_ROOM.getByName("converted-preview-room");
    const old=await room.publishAnnouncement("Host","Preview message",true,policy);
    await room.removePreviewContentBefore("2000-01-01T00:00:00.000Z");
    expect(await room.getMessage(old.id)).toBeTruthy();
    await room.removePreviewContentBefore("2099-01-01T00:00:00.000Z");
    expect(await room.getMessage(old.id)).toBeNull();
    const current=await room.publishAnnouncement("Host","Current event update",true,policy);
    expect(await room.hasMessage(current.id)).toBe(true);
  });

  it("isolates conversations by event", async () => {
    const first = env.THE_ROOM.getByName("event-first");
    const second = env.THE_ROOM.getByName("event-second");
    const message = await first.publishAnnouncement("BeCore Admin", "First room only", false, policy);

    expect(await first.hasMessage(message.id)).toBe(true);
    expect(await second.hasMessage(message.id)).toBe(false);
  });
});


it('opens a linked host announcement even after it leaves the latest 100 messages',async()=>{
  const room=env.THE_ROOM.getByName(`announcement-link-${crypto.randomUUID()}`);
  const first=await room.publishAnnouncement('Host','The original arrival instructions.',false,policy);
  for(let i=0;i<100;i++)await room.publishAnnouncement('Host',`Later notice ${i}`,false,policy);
  const future=new Date(Date.now()+86400000).toISOString();
  const response=await room.fetch(new Request(`https://room.internal/socket?announcement=${first.id}`,{headers:{
    upgrade:'websocket','x-bct-room-authorized':'1','x-bct-session-id':'linked-session','x-bct-attendee-id':'linked-guest',
    'x-bct-display-name':'Guest','x-bct-event-slug':policy.eventSlug,'x-bct-event-title':policy.eventTitle,
    'x-bct-starts-at':new Date().toISOString(),'x-bct-ends-at':future,'x-bct-read-only-at':future,
  }}));
  expect(response.status).toBe(101);const socket=response.webSocket!;
  const snapshot=new Promise<{messages:Array<{id:string;content:string}>}>(resolve=>socket.addEventListener('message',event=>{const data=JSON.parse(String(event.data));if(data.type==='snapshot')resolve(data);}));
  socket.accept();try {const data=await snapshot;expect(data.messages).toHaveLength(101);expect(data.messages[0]).toMatchObject({id:first.id,content:'The original arrival instructions.'});}finally{socket.close(1000,'Test complete');}
});
