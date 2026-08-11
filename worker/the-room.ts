import { DurableObject } from "cloudflare:workers";
import { purgeExpiredFlashes, type FlashRecord } from "../lib/flashes";

type RoomRole = "attendee" | "organizer" | "moderator";

type ConnectionState = {
  attendeeId: string;
  displayName: string;
  role: RoomRole;
  blockedAttendeeIds: string[];
  readOnly: boolean;
  readOnlyAt: string;
  rateWindowStartedAt: number;
  rateCount: number;
};

type RoomMessage = {
  id: string;
  sequence: number;
  attendeeId: string;
  displayName: string;
  role: RoomRole;
  kind: "message" | "announcement";
  content: string;
  parentId: string | null;
  pinned: boolean;
  createdAt: string;
  deletedAt: string | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
};

type RoomPolicyInput = {
  eventSlug: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  readOnlyAt: string;
  readOnly: boolean;
};

const REACTIONS = new Set(["🔥", "❤️", "😂", "👏", "👀"]);
const MAX_MESSAGE_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export class TheRoom extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          event_slug TEXT NOT NULL,
          event_title TEXT NOT NULL,
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          read_only_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          attendee_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          content TEXT NOT NULL,
          parent_id TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at);
        CREATE INDEX IF NOT EXISTS messages_pinned_idx ON messages(pinned, created_at);
        CREATE TABLE IF NOT EXISTS reactions (
          message_id TEXT NOT NULL,
          attendee_id TEXT NOT NULL,
          emoji TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (message_id, attendee_id, emoji)
        );
        CREATE INDEX IF NOT EXISTS reactions_message_idx ON reactions(message_id);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }
    if (request.headers.get("x-bct-room-authorized") !== "1") {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const attendeeId = requiredHeader(request, "x-bct-attendee-id");
      const displayName = decodeURIComponent(requiredHeader(request, "x-bct-display-name"));
      const blocked = request.headers.get("x-bct-blocked-attendees")?.split(",").filter(Boolean) ?? [];
      const policy: RoomPolicyInput = {
        eventSlug: requiredHeader(request, "x-bct-event-slug"),
        eventTitle: decodeURIComponent(requiredHeader(request, "x-bct-event-title")),
        startsAt: requiredHeader(request, "x-bct-starts-at"),
        endsAt: requiredHeader(request, "x-bct-ends-at"),
        readOnlyAt: requiredHeader(request, "x-bct-read-only-at"),
        readOnly: request.headers.get("x-bct-read-only") === "1",
      };
      this.configure(policy);
      await this.scheduleFlashExpiry(policy);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const attachment: ConnectionState = {
        attendeeId,
        displayName: displayName.slice(0, 50),
        role: "attendee",
        blockedAttendeeIds: blocked,
        readOnly: policy.readOnly,
        readOnlyAt: policy.readOnlyAt,
        rateWindowStartedAt: Date.now(),
        rateCount: 0,
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({
        type: "snapshot",
        room: policy,
        messages: this.readMessages(attachment),
        online: this.ctx.getWebSockets().length,
      }));
      this.broadcast({ type: "presence", online: this.ctx.getWebSockets().length });
      return new Response(null, { status: 101, webSocket: client });
    } catch (error) {
      console.error(JSON.stringify({ message: "room websocket rejected", error: error instanceof Error ? error.message : String(error) }));
      return new Response("Invalid room connection", { status: 400 });
    }
  }

  async webSocketMessage(socket: WebSocket, payload: string | ArrayBuffer): Promise<void> {
    const state = socket.deserializeAttachment() as ConnectionState | null;
    if (!state || typeof payload !== "string" || payload.length > 4000) {
      socket.send(JSON.stringify({ type: "error", error: "Invalid Room message." }));
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(payload);
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "Invalid Room message." }));
      return;
    }
    if (!isRecord(input) || typeof input.type !== "string") return;

    const readOnly = state.readOnly || Date.now() >= Date.parse(state.readOnlyAt);

    if (input.type === "ping") {
      socket.send(JSON.stringify({ type: "pong", sentAt: new Date().toISOString() }));
      return;
    }

    if (input.type === "message") {
      if (readOnly) {
        socket.send(JSON.stringify({ type: "error", error: "This Room is now read-only." }));
        return;
      }
      const now = Date.now();
      if (now - state.rateWindowStartedAt >= 10_000) {
        state.rateWindowStartedAt = now;
        state.rateCount = 0;
      }
      state.rateCount += 1;
      socket.serializeAttachment(state);
      if (state.rateCount > 5) {
        socket.send(JSON.stringify({ type: "error", error: "Slow down for a moment before posting again." }));
        return;
      }
      const content = typeof input.content === "string" ? input.content.trim() : "";
      const parentId = typeof input.parentId === "string" ? input.parentId : null;
      if (!content || content.length > MAX_MESSAGE_LENGTH) {
        socket.send(JSON.stringify({ type: "error", error: `Messages must be 1–${MAX_MESSAGE_LENGTH} characters.` }));
        return;
      }
      if (parentId && !this.messageExists(parentId)) {
        socket.send(JSON.stringify({ type: "error", error: "That reply target is no longer available." }));
        return;
      }
      const message = this.insertMessage({
        attendeeId: state.attendeeId,
        displayName: state.displayName,
        role: state.role,
        kind: "message",
        content,
        parentId,
        pinned: false,
      });
      this.broadcast({ type: "message", message });
      return;
    }

    if (input.type === "reaction") {
      if (readOnly) {
        socket.send(JSON.stringify({ type: "error", error: "This Room is now read-only." }));
        return;
      }
      const messageId = typeof input.messageId === "string" ? input.messageId : "";
      const emoji = typeof input.emoji === "string" ? input.emoji : "";
      if (!messageId || !REACTIONS.has(emoji) || !this.messageExists(messageId)) return;
      const existing = this.ctx.storage.sql.exec<{ found: number }>(
        "SELECT 1 AS found FROM reactions WHERE message_id = ? AND attendee_id = ? AND emoji = ? LIMIT 1",
        messageId,
        state.attendeeId,
        emoji,
      ).toArray().length > 0;
      if (existing) {
        this.ctx.storage.sql.exec(
          "DELETE FROM reactions WHERE message_id = ? AND attendee_id = ? AND emoji = ?",
          messageId,
          state.attendeeId,
          emoji,
        );
      } else {
        this.ctx.storage.sql.exec(
          "INSERT INTO reactions (message_id, attendee_id, emoji, created_at) VALUES (?, ?, ?, ?)",
          messageId,
          state.attendeeId,
          emoji,
          new Date().toISOString(),
        );
      }
      const count = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM reactions WHERE message_id = ? AND emoji = ?",
        messageId,
        emoji,
      ).one().count;
      this.broadcast({ type: "reaction", messageId, emoji, count, attendeeId: state.attendeeId, active: !existing });
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcast({ type: "presence", online: this.ctx.getWebSockets().length });
  }

  async publishAnnouncement(actor: string, content: string, pinned: boolean, policy: RoomPolicyInput): Promise<RoomMessage> {
    const cleaned = content.trim();
    if (!cleaned || cleaned.length > MAX_MESSAGE_LENGTH) throw new Error("Invalid announcement length");
    this.configure(policy);
    const message = this.insertMessage({
      attendeeId: `admin:${actor}`,
      displayName: "BeCore Host",
      role: "organizer",
      kind: "announcement",
      content: cleaned,
      parentId: null,
      pinned,
    });
    this.broadcast({ type: "message", message });
    return message;
  }

  async removeMessage(messageId: string): Promise<boolean> {
    const found = this.messageExists(messageId);
    if (!found) return false;
    this.ctx.storage.sql.exec("UPDATE messages SET deleted_at = ? WHERE id = ?", new Date().toISOString(), messageId);
    this.broadcast({ type: "message_removed", messageId });
    return true;
  }

  async publishFlash(flash: FlashRecord, policy: RoomPolicyInput): Promise<void> {
    this.configure(policy);
    await this.scheduleFlashExpiry(policy);
    this.broadcast({ type: "flash_added", flash });
  }

  removeFlash(flashId: string): void {
    this.broadcast({ type: "flash_removed", flashId });
  }

  async scheduleFlashExpiry(policy: RoomPolicyInput): Promise<void> {
    const expiry = Date.parse(policy.readOnlyAt);
    if (!Number.isFinite(expiry)) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current !== expiry) await this.ctx.storage.setAlarm(expiry);
  }

  async alarm(): Promise<void> {
    const configured = this.ctx.storage.sql.exec<{ eventSlug: string }>(
      "SELECT event_slug AS eventSlug FROM room_config WHERE id = 1 LIMIT 1",
    ).toArray()[0];
    if (!configured) return;
    await purgeExpiredFlashes(this.env.DB, this.env.FLASHES_BUCKET, configured.eventSlug);
    this.broadcast({ type: "room_closed" });
  }

  hasMessage(messageId: string): boolean {
    return this.messageExists(messageId);
  }

  getMessage(messageId: string): { id: string; attendeeId: string; displayName: string; content: string; createdAt: string; deletedAt: string | null } | null {
    const rows = this.ctx.storage.sql.exec<{
      id: string; attendeeId: string; displayName: string; content: string; createdAt: string; deletedAt: string | null;
    }>(`
      SELECT id, attendee_id AS attendeeId, display_name AS displayName, content,
             created_at AS createdAt, deleted_at AS deletedAt
      FROM messages WHERE id = ? LIMIT 1
    `, messageId).toArray();
    return rows[0] ?? null;
  }

  private configure(policy: RoomPolicyInput): void {
    this.ctx.storage.sql.exec(`
      INSERT INTO room_config (id, event_slug, event_title, starts_at, ends_at, read_only_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        event_title = excluded.event_title,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        read_only_at = excluded.read_only_at,
        updated_at = excluded.updated_at
    `, policy.eventSlug, policy.eventTitle, policy.startsAt, policy.endsAt, policy.readOnlyAt, new Date().toISOString());
  }

  private messageExists(messageId: string): boolean {
    return this.ctx.storage.sql.exec<{ found: number }>(
      "SELECT 1 AS found FROM messages WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      messageId,
    ).toArray().length > 0;
  }

  private insertMessage(input: Omit<RoomMessage, "id" | "sequence" | "createdAt" | "deletedAt" | "reactions">): RoomMessage {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const row = this.ctx.storage.sql.exec<{ sequence: number }>(`
      INSERT INTO messages (id, attendee_id, display_name, role, kind, content, parent_id, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING sequence
    `, id, input.attendeeId, input.displayName, input.role, input.kind, input.content, input.parentId, input.pinned ? 1 : 0, createdAt).one();
    return { ...input, id, sequence: row.sequence, createdAt, deletedAt: null, reactions: [] };
  }

  private readMessages(viewer: ConnectionState): RoomMessage[] {
    const rows = this.ctx.storage.sql.exec<{
      id: string; sequence: number; attendeeId: string; displayName: string; role: RoomRole;
      kind: "message" | "announcement"; content: string; parentId: string | null;
      pinned: number; createdAt: string; deletedAt: string | null;
    }>(`
      SELECT id, sequence, attendee_id AS attendeeId, display_name AS displayName, role, kind,
             content, parent_id AS parentId, pinned, created_at AS createdAt, deleted_at AS deletedAt
      FROM messages ORDER BY sequence DESC LIMIT 100
    `).toArray().reverse();
    return rows
      .filter((row) => !viewer.blockedAttendeeIds.includes(row.attendeeId))
      .map((row) => {
        const reactions = this.ctx.storage.sql.exec<{ emoji: string; count: number; mine: number }>(`
          SELECT emoji, COUNT(*) AS count,
                 MAX(CASE WHEN attendee_id = ? THEN 1 ELSE 0 END) AS mine
          FROM reactions WHERE message_id = ? GROUP BY emoji ORDER BY emoji
        `, viewer.attendeeId, row.id).toArray();
        return {
          ...row,
          content: row.deletedAt ? "Message removed" : row.content,
          pinned: row.pinned === 1,
          reactions: reactions.map((reaction) => ({ emoji: reaction.emoji, count: reaction.count, mine: reaction.mine === 1 })),
        };
      });
  }

  private broadcast(payload: Record<string, unknown>): void {
    const encoded = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const state = socket.deserializeAttachment() as ConnectionState | null;
        const message = payload.message;
        if (state && isRecord(message) && typeof message.attendeeId === "string" && state.blockedAttendeeIds.includes(message.attendeeId)) {
          continue;
        }
        socket.send(encoded);
      } catch {
        socket.close(1011, "Room connection reset");
      }
    }
  }
}
