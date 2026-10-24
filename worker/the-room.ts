import { isLegacyInventory, type OperationRecord } from "./handover-reconciliation";
import { restoreFrozenRoom, type RoomReturn } from "./room-return";
import { trackedOperation, requireTransfer, HandoverPaused } from "./handover-control";
import { requireHandover } from "./handover-crypto";
import { writerGuardStatements, transitionWriterSql } from "../ops/handover/writer-lock.mjs";
import { encryptedRoomSnapshot } from "./room-handover";
import { DurableObject } from "cloudflare:workers";
import { purgeExpiredFlashes, type FlashRecord } from "../lib/flashes";
import { firstHostPublicName, queueFirstHostPost, type FirstHostPost } from '../lib/room-host-first-post';
import { notifyRoomMessage } from "../lib/notifications";

type RoomRole = "attendee" | "organizer" | "moderator";

type ConnectionState = {
  sessionId: string;
  attendeeId: string;
  displayName: string;
  role: RoomRole;
  roomBadge: "VIP" | null;
  blockedAttendeeIds: string[];
  readOnly: boolean;
  readOnlyAt: string;
  emergencyReadOnly: boolean;
  slowModeSeconds: number;
  lastMessageAt: number;
  rateWindowStartedAt: number;
  rateCount: number;
};

type RoomMessage = {
  id: string;
  sequence: number;
  attendeeId: string;
  displayName: string;
  role: RoomRole;
  roomBadge: "VIP" | null;
  kind: "message" | "announcement";
  content: string;
  parentId: string | null;
  pinned: boolean;
  createdAt: string;
  deletedAt: string | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
};

type StoredRoomMessage = Omit<RoomMessage, "pinned" | "reactions"> & { pinned: number };

type RoomPolicyInput = {
  eventSlug: string;
  eventTitle: string;
  startsAt: string;
  endsAt: string;
  readOnlyAt: string;
  readOnly: boolean;
  emergencyReadOnly?: boolean;
  slowModeSeconds?: number;
  archived?: boolean;
};

const REACTIONS = new Set(["🔥", "❤️", "😂", "👏", "👀"]);
const MAX_MESSAGE_LENGTH = 500;
// Four tabs/devices per guest, with headroom above the verified 600-guest
// workload. These are safety ceilings, not a throughput/SLA promise.
export const ROOM_MAX_CONNECTIONS_PER_ATTENDEE = 4;
export const ROOM_MAX_CONNECTIONS = 2048;
const RATE_WINDOW_MS = 10_000;
const RATE_ACTIONS = 5;
type IdentityBudget = { windowStartedAt: number; count: number; lastMessageAt: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export class TheRoom extends DurableObject<Cloudflare.Env> {
  private firstHostDrain: Promise<void> | null = null;
  private presencePending = false;
  private identityBudgets = new Map<string, IdentityBudget>();
  private lastBudgetPrune = 0;
  private writerFrozen = false;
  private alarmRunning = false;
  private handoverDeferred = new Set<Promise<void>>();
  private recentMessages: StoredRoomMessage[] | null = null;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // Native heartbeats keep idle Cloudflare sockets alive without waking JS.
    // The VPS adapter keeps using the handler below; it has no hibernation API.
    if (typeof ctx.setWebSocketAutoResponse === "function") {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }), JSON.stringify({ type: "pong" }),
      ));
    }
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
          room_badge TEXT,
          kind TEXT NOT NULL,
          content TEXT NOT NULL,
          parent_id TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at);
        CREATE INDEX IF NOT EXISTS messages_pinned_idx ON messages(pinned, created_at);
        CREATE TABLE IF NOT EXISTS room_host_posts (
          host_account_id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL UNIQUE,
          sender_attendee_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS reactions (
          message_id TEXT NOT NULL,
          attendee_id TEXT NOT NULL,
          emoji TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (message_id, attendee_id, emoji)
        );
        CREATE INDEX IF NOT EXISTS reactions_message_idx ON reactions(message_id);
      `);
      const writerStateExists = this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='_bct_handover_state'").toArray().length;
      this.writerFrozen = Boolean(writerStateExists && this.ctx.storage.sql.exec<{ frozen: number }>('SELECT frozen FROM _bct_handover_state WHERE id=1').one().frozen);
      const messageColumns = this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(messages)").toArray();
      if (!this.writerFrozen && this.env.ROOM_HOST_FIRST_POST_ENABLED === '1' && this.pendingFirstHostPosts().length) {
        const current = await this.ctx.storage.getAlarm();
        if (current === null || current > Date.now() + 1000) await this.ctx.storage.setAlarm(Date.now() + 1000);
      }
      if (!messageColumns.some((column) => column.name === "room_badge")) {
        this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN room_badge TEXT");
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:fetch', () => this.fetchUntracked(request));
  }
  async acceptConnection(request: Request, server: WebSocket): Promise<void> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:acceptConnection', () => this.acceptConnectionUntracked(request, server));
  }
  async webSocketMessage(socket: WebSocket, payload: string | ArrayBuffer): Promise<void> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:webSocketMessage', () => this.webSocketMessageUntracked(socket, payload));
  }
  async publishAnnouncement(actor: string, content: string, pinned: boolean, policy: RoomPolicyInput, submissionId?: string): Promise<RoomMessage> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:publishAnnouncement', () => this.publishAnnouncementUntracked(actor, content, pinned, policy, submissionId));
  }
  async removeEventContent(): Promise<void> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:removeEventContent', () => this.removeEventContentUntracked());
  }
  async removePreviewContentBefore(before: string): Promise<void> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:removePreviewContentBefore', () => this.removePreviewContentBeforeUntracked(before));
  }
  async removeMessage(messageId: string): Promise<boolean> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:removeMessage', () => this.removeMessageUntracked(messageId));
  }
  async publishFlash(flash: FlashRecord, policy: RoomPolicyInput): Promise<void> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:publishFlash', () => this.publishFlashUntracked(flash, policy));
  }
  async scheduleFlashExpiry(policy: RoomPolicyInput): Promise<void> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:scheduleFlashExpiry', () => this.scheduleFlashExpiryUntracked(policy));
  }
  async alarm(): Promise<void> {
    if (this.writerFrozen) return;
    this.alarmRunning = true;
    try { await this.trackedRoomOperation('room:alarm', () => this.alarmUntracked()); }
    catch (error) {
      if (!(error instanceof HandoverPaused)) throw error;
      if (!this.writerFrozen) await this.ctx.storage.setAlarm(Date.now() + 60000);
    } finally { this.alarmRunning = false; }
  }
  async refreshAdmissionAccess(): Promise<void> {
    this.assertWriterAvailable();
    return this.trackedRoomOperation('room:refreshAdmissionAccess', () => this.refreshAdmissionAccessUntracked());
  }
  private defer(promise: Promise<unknown>): void {
    if (this.env.HANDOVER_TRACKING === '1') {
      const settled = promise.then(() => { this.handoverDeferred.delete(settled); }, () => { this.handoverDeferred.delete(settled); });
      this.handoverDeferred.add(settled);
      this.ctx.waitUntil(settled);
    }
    this.ctx.waitUntil(promise);
  }

  private async trackedRoomOperation<T>(kind: string, operation: () => Promise<T>): Promise<T> {
    return trackedOperation(this.env, kind, async () => {
      try { return await operation(); }
      finally { while (this.handoverDeferred.size) await Promise.all(this.handoverDeferred); }
    });
  }

  private assertWriterAvailable(): void {
    if (this.writerFrozen) throw new Error('Room writer is paused.');
  }

  async freezeHandover(transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    const admission = await this.env.DB.prepare("SELECT transfer_id FROM _bct_handover_admission WHERE id=1 AND phase IN ('paused','frozen')").first<{ transfer_id: string }>();
    const operations = (await this.env.DB.prepare('SELECT id,kind,started_at FROM _bct_handover_operations ORDER BY id').all<OperationRecord>()).results;
    if (admission?.transfer_id !== transferId || (operations.length !== 0 && !await isLegacyInventory(operations))) throw new Error('Source has not drained.');
    const alarm = this.writerFrozen ? undefined : (await this.ctx.storage.getAlarm()) ?? (this.alarmRunning ? Date.now() : null);
    this.ctx.storage.transactionSync(() => {
      for (const sql of writerGuardStatements(['room_config', 'messages', 'reactions', 'room_host_posts'])) this.ctx.storage.sql.exec(sql);
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS _bct_handover_alarm(id INTEGER PRIMARY KEY CHECK(id=1),due INTEGER)');
      if (alarm !== undefined) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO _bct_handover_alarm VALUES(1,?)', alarm);
      const command = transitionWriterSql(transferId, true);
      if (this.ctx.storage.sql.exec(command.sql, ...command.params).toArray().length !== 1) throw new Error('Room freeze belongs to another transfer.');
    });
    this.writerFrozen = true;
    await this.ctx.storage.deleteAlarm();
    for (const socket of this.ctx.getWebSockets()) socket.close(1012, 'Service moving. Please reconnect shortly.');
    return { objectId: this.ctx.id.toString(), transferId, frozen: true };
  }

  async restoreHandover(transferId: string, snapshot: RoomReturn) {
    requireHandover(this.env);
    restoreFrozenRoom(this.ctx.storage, transferId, snapshot);
    this.writerFrozen = true;
    this.recentMessages = null;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO _bct_handover_alarm VALUES(1,?)', snapshot.alarm);
    await this.ctx.storage.deleteAlarm();
    return this.encryptedHandoverSnapshot();
  }

  async resumeHandover(transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    const admission = await this.env.DB.prepare("SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1").first<{ phase: string; transfer_id: string }>();
    if (admission?.transfer_id !== transferId || admission?.phase === 'transferred') throw new Error('A completed transfer requires verified reverse import before release.');
    const command = transitionWriterSql(transferId, false);
    if (this.ctx.storage.sql.exec(command.sql, ...command.params).toArray().length !== 1) throw new Error('Room freeze belongs to another transfer.');
    this.writerFrozen = false;
    const alarm = this.ctx.storage.sql.exec<{ due: number | null }>('SELECT due FROM _bct_handover_alarm WHERE id=1').one().due;
    if (alarm !== null) await this.ctx.storage.setAlarm(alarm);
    return { resumed: true, transferId };
  }

  async encryptedHandoverSnapshot() {
    try { return await encryptedRoomSnapshot(this.ctx.storage, this.env, this.env.RELEASE_SHA, this.ctx.id.toString()); }
    catch { return { error: "Room handover unavailable." }; }
  }

  private async fetchUntracked(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }
    if (request.headers.get("x-bct-room-authorized") !== "1") {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      await this.acceptConnection(request, server);
      return new Response(null, { status: 101, webSocket: client });
    } catch (error) {
      console.error(JSON.stringify({ message: "room websocket rejected", error: error instanceof Error ? error.message : String(error) }));
      return new Response("Invalid room connection", { status: 400 });
    }
  }

  private async acceptConnectionUntracked(request: Request, server: WebSocket): Promise<void> {
    if (request.headers.get("x-bct-room-authorized") !== "1") throw new Error("Unauthorized Room connection.");
    const attendeeId = requiredHeader(request, "x-bct-attendee-id");
    const displayName = decodeURIComponent(requiredHeader(request, "x-bct-display-name"));
    const roomBadge = request.headers.get("x-bct-room-badge") === "VIP" ? "VIP" : null;
    const blocked = request.headers.get("x-bct-blocked-attendees")?.split(",").filter(Boolean) ?? [];
    const policy: RoomPolicyInput = {
      eventSlug: requiredHeader(request, "x-bct-event-slug"),
      eventTitle: decodeURIComponent(requiredHeader(request, "x-bct-event-title")),
      startsAt: requiredHeader(request, "x-bct-starts-at"),
      endsAt: requiredHeader(request, "x-bct-ends-at"),
      readOnlyAt: requiredHeader(request, "x-bct-read-only-at"),
      readOnly: request.headers.get("x-bct-read-only") === "1",
      emergencyReadOnly: request.headers.get("x-bct-emergency-read-only") === "1",
      slowModeSeconds: Number(request.headers.get("x-bct-slow-mode-seconds") ?? 0),
      archived: request.headers.get("x-bct-archived") === "1",
    };
    this.configure(policy);
    await this.scheduleFlashExpiry(policy);

    // Check immediately before accepting, without an await between the count
    // and insertion, so concurrent upgrades cannot all claim the last slot.
    const sockets = this.ctx.getWebSockets().filter(socket => socket.readyState === WebSocket.OPEN);
    const peers = sockets.filter(socket => (socket.deserializeAttachment() as ConnectionState | null)?.attendeeId === attendeeId);
    if (sockets.length >= ROOM_MAX_CONNECTIONS || peers.length >= ROOM_MAX_CONNECTIONS_PER_ATTENDEE) {
      this.ctx.acceptWebSocket(server);
      server.close(1013, peers.length >= ROOM_MAX_CONNECTIONS_PER_ATTENDEE ? 'Close another Room tab before reconnecting' : 'Room is busy; try again shortly');
      return;
    }
    const budget = this.identityBudget(attendeeId, peers);
    const attachment: ConnectionState = {
      attendeeId,
      sessionId: requiredHeader(request,"x-bct-session-id"),
      displayName: displayName.slice(0, 50),
      role: "attendee",
      roomBadge,
      blockedAttendeeIds: blocked,
      readOnly: policy.readOnly,
      readOnlyAt: policy.readOnlyAt,
      emergencyReadOnly: Boolean(policy.emergencyReadOnly),
      slowModeSeconds: policy.slowModeSeconds ?? 0,
      lastMessageAt: budget.lastMessageAt,
      rateWindowStartedAt: budget.windowStartedAt,
      rateCount: budget.count,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({
      type: "snapshot",
      room: policy,
      messages: this.readMessages(attachment, (new URL(request.url).searchParams.get("announcement") ?? new URL(request.url).searchParams.get("message"))?.slice(0,80) ?? ""),
      online: this.ctx.getWebSockets().length,
    }));
    this.schedulePresence();
  }

  private async webSocketMessageUntracked(socket: WebSocket, payload: string | ArrayBuffer): Promise<void> {
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

    let currentBadge: "VIP" | null = null;
    let currentHost: {accountId:string;displayName:string} | null = null;
    if (input.type === "message" || input.type === "reaction") {
      const peers = this.ctx.getWebSockets().filter(peer => peer.readyState === WebSocket.OPEN
        && (peer.deserializeAttachment() as ConnectionState | null)?.attendeeId === state.attendeeId);
      const budget = this.identityBudget(state.attendeeId, peers);
      budget.count = Math.min(RATE_ACTIONS + 1, budget.count + 1);
      this.syncIdentityBudget(peers, budget);
      state.rateWindowStartedAt = budget.windowStartedAt;
      state.rateCount = budget.count;
      state.lastMessageAt = budget.lastMessageAt;
      if (budget.count > RATE_ACTIONS) {
        socket.send(JSON.stringify({ type: "error", error: "Slow down for a moment before posting again." }));
        return;
      }
      const access=state.sessionId ? await this.currentRoomIdentity(state.attendeeId,state.sessionId) : null;
      if (!access) {socket.close(4003,"Room access changed");return;}
      currentBadge = access.roomBadge === 'VIP' ? 'VIP' : null;
      currentHost = access.hostIdentity;
    }
    if (input.type === "message") {
      if (readOnly) {
        socket.send(JSON.stringify({ type: "error", error: "This Room is now read-only." }));
        return;
      }
      const now = Date.now();
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
      // Admission, session and host assignment share one fresh database snapshot.
      // No await separates that result and Room persistence.
      const previousMessage = this.identityBudgets.get(state.attendeeId)?.lastMessageAt ?? state.lastMessageAt;
      if (state.slowModeSeconds > 0 && now - previousMessage < state.slowModeSeconds * 1000) {
        const wait = Math.ceil((state.slowModeSeconds * 1000 - (now - previousMessage)) / 1000);
        socket.send(JSON.stringify({ type: "error", error: `Slow mode is on. Give it ${wait}s.` }));
        return;
      }
      state.roomBadge = currentBadge;
      state.role = currentHost ? 'organizer' : 'attendee';
      let firstHostPost = false;
      const message = this.ctx.storage.transactionSync(() => {
        const inserted = this.insertMessage({
        attendeeId: state.attendeeId,
        displayName: currentHost?.displayName ?? state.displayName,
        role: state.role,
        roomBadge: state.roomBadge,
        kind: "message",
        content,
        parentId,
        pinned: false,
        });
        if (currentHost) {
          firstHostPost = this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO room_host_posts
            (host_account_id,message_id,sender_attendee_id,created_at) VALUES(?,?,?,?)`,
            currentHost.accountId,inserted.id,state.attendeeId,inserted.createdAt).rowsWritten > 0;
        }
        return inserted;
      });
      state.lastMessageAt = now;
      socket.serializeAttachment(state);
      const budget = this.identityBudgets.get(state.attendeeId)!;
      budget.lastMessageAt = now;
      this.syncIdentityBudget(this.ctx.getWebSockets().filter(peer => peer.readyState === WebSocket.OPEN
        && (peer.deserializeAttachment() as ConnectionState | null)?.attendeeId === state.attendeeId), budget);
      this.broadcast({ type: "message", message });
      if (currentHost) {
        this.defer(this.drainFirstHostPosts());
        this.defer(this.scheduleFirstHostRetry());
      }
      if (!firstHostPost) this.defer(notifyRoomMessage(this.env, {
        eventSlug: this.eventSlug(),
        messageId: message.id,
        senderAttendeeId: state.attendeeId,
        senderName: state.displayName,
        content: message.content,
      }));
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

  private identityBudget(attendeeId: string, peers: WebSocket[]): IdentityBudget {
    const now = Date.now();
    if (now - this.lastBudgetPrune >= 60_000) {
      for (const [id, budget] of this.identityBudgets) {
        if (now - Math.max(budget.windowStartedAt, budget.lastMessageAt) >= 60_000) this.identityBudgets.delete(id);
      }
      this.lastBudgetPrune = now;
    }
    let budget = this.identityBudgets.get(attendeeId);
    if (!budget) {
      // Hibernated Durable Objects reconstruct the shared counter from socket
      // attachments. All live sockets carry the same current identity budget.
      const states = peers.map(peer => peer.deserializeAttachment() as ConnectionState | null).filter((state): state is ConnectionState => Boolean(state));
      const current = states.filter(state => now - state.rateWindowStartedAt < RATE_WINDOW_MS);
      budget = {
        windowStartedAt: current.length ? Math.min(...current.map(state => state.rateWindowStartedAt)) : now,
        count: current.length ? Math.max(...current.map(state => state.rateCount)) : 0,
        lastMessageAt: states.length ? Math.max(...states.map(state => state.lastMessageAt)) : 0,
      };
      this.identityBudgets.set(attendeeId, budget);
    }
    if (now - budget.windowStartedAt >= RATE_WINDOW_MS) { budget.windowStartedAt = now; budget.count = 0; }
    return budget;
  }

  private syncIdentityBudget(peers: WebSocket[], budget: IdentityBudget): void {
    for (const peer of peers) {
      const state = peer.deserializeAttachment() as ConnectionState | null;
      if (!state) continue;
      peer.serializeAttachment({ ...state, rateWindowStartedAt: budget.windowStartedAt, rateCount: budget.count, lastMessageAt: budget.lastMessageAt });
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    // Complete the closing handshake explicitly, including local runtimes.
    socket.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
    this.schedulePresence();
  }

  private async publishAnnouncementUntracked(actor: string, content: string, pinned: boolean, policy: RoomPolicyInput, submissionId?: string): Promise<RoomMessage> {
    const cleaned = content.trim();
    if (!cleaned || cleaned.length > MAX_MESSAGE_LENGTH) throw new Error("Invalid announcement length");
    this.configure(policy);
    if (submissionId && !/^[a-f0-9]{64}$/u.test(submissionId)) throw new Error("Invalid announcement submission");
    const previous = submissionId ? this.ctx.storage.sql.exec<StoredRoomMessage>(`
      SELECT id, sequence, attendee_id AS attendeeId, display_name AS displayName, role, room_badge AS roomBadge, kind,
        content, parent_id AS parentId, pinned, created_at AS createdAt, deleted_at AS deletedAt
      FROM messages WHERE id = ? LIMIT 1
    `, submissionId).toArray()[0] : undefined;
    if (previous && (previous.attendeeId !== `admin:${actor}` || previous.kind !== 'announcement' || previous.content !== cleaned || Boolean(previous.pinned) !== pinned || previous.deletedAt)) {
      throw new Error("This announcement changed. Start a new announcement.");
    }
    const message: RoomMessage = previous ? { ...previous, pinned: Boolean(previous.pinned), reactions: [] } : this.insertMessage({
      attendeeId: `admin:${actor}`,
      displayName: "BeCore Host",
      role: "organizer",
      roomBadge: null,
      kind: "announcement",
      content: cleaned,
      parentId: null,
      pinned,
    }, submissionId);
    if (!previous) this.broadcast({ type: "message", message });
    // A stale retry must not recreate push jobs after their retention period.
    if (!previous || Date.now() - Date.parse(previous.createdAt) < 86400000) await notifyRoomMessage(this.env, {
      eventSlug: policy.eventSlug,
      messageId: message.id,
      senderAttendeeId: `admin:${actor}`,
      senderName: "The Host",
      content: message.content,
      announcement: true,
    });
    return message;
  }

  private async removeEventContentUntracked(): Promise<void> {
    this.recentMessages = null;
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, "Event removed");
    this.ctx.storage.sql.exec('UPDATE room_host_posts SET completed_at=COALESCE(completed_at,?)',new Date().toISOString());
    this.ctx.storage.sql.exec("DELETE FROM reactions; DELETE FROM messages; DELETE FROM room_config;");
    await this.ctx.storage.deleteAlarm();
  }

  private async removePreviewContentBeforeUntracked(before: string): Promise<void> {
    if (!Number.isFinite(Date.parse(before))) throw new Error("Invalid preview cutoff.");
    this.recentMessages = null;
    const ids = this.ctx.storage.sql.exec<{id:string}>("SELECT id FROM messages WHERE datetime(created_at) < datetime(?)", before).toArray();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE datetime(created_at) < datetime(?))", before);
      this.ctx.storage.sql.exec("UPDATE messages SET parent_id=NULL WHERE parent_id IN (SELECT id FROM messages WHERE datetime(created_at) < datetime(?))", before);
      this.ctx.storage.sql.exec("DELETE FROM messages WHERE datetime(created_at) < datetime(?)", before);
    });
    for (const {id} of ids) this.broadcast({type:"message_removed",messageId:id});
  }

  private async removeMessageUntracked(messageId: string): Promise<boolean> {
    const found = this.messageExists(messageId);
    const firstPost = this.ctx.storage.sql.exec('SELECT 1 FROM room_host_posts WHERE message_id=?', messageId).toArray().length > 0;
    if (!found && !firstPost) return false;
    this.recentMessages = null;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE messages SET deleted_at = COALESCE(deleted_at,?) WHERE id = ?", new Date().toISOString(), messageId);
      // A deleted source plus an incomplete durable receipt is a cancellation
      // obligation. Never acknowledge it locally before the D1 batch commits.
      this.ctx.storage.sql.exec('UPDATE room_host_posts SET completed_at=NULL WHERE message_id=?', messageId);
    });
    if (found) this.broadcast({ type: "message_removed", messageId });
    try {
      await this.cancelMessageNotifications(messageId);
      this.ctx.storage.sql.exec('UPDATE room_host_posts SET completed_at=? WHERE message_id=?', new Date().toISOString(), messageId);
    } catch (error) {
      await this.scheduleFirstHostRetry();
      throw error;
    }
    return true;
  }

  private async cancelMessageNotifications(messageId: string): Promise<void> {
    const firstPost = this.ctx.storage.sql.exec<{hostId:string;senderId:string;createdAt:string}>('SELECT host_account_id AS hostId,sender_attendee_id AS senderId,created_at AS createdAt FROM room_host_posts WHERE message_id=?',messageId).toArray()[0];
    const now = new Date().toISOString();
    await this.env.DB.batch([
      ...(firstPost ? [this.env.DB.prepare(`INSERT INTO room_host_first_posts(event_slug,host_account_id,message_id,sender_attendee_id,created_at,fanout_at,cancelled_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_slug,host_account_id) DO UPDATE SET cancelled_at=excluded.cancelled_at,
        fanout_at=COALESCE(room_host_first_posts.fanout_at,excluded.fanout_at) WHERE room_host_first_posts.message_id=excluded.message_id`)
        .bind(this.eventSlug(),firstPost.hostId,messageId,firstPost.senderId,firstPost.createdAt,now,now)] : []),
      this.env.DB.prepare("UPDATE room_announcement_deliveries SET status='complete',lease_token=NULL,lease_until=NULL,updated_at=? WHERE event_slug=? AND json_extract(payload_json,'$.sourceId')=?").bind(new Date().toISOString(),this.eventSlug(),messageId),
      this.env.DB.prepare("UPDATE delivery_events SET status='suppressed',next_attempt_at=NULL,updated_at=? WHERE kind='room_host_post' AND status='queued' AND json_extract(payload_json,'$.eventSlug')=? AND json_extract(payload_json,'$.messageId')=?").bind(new Date().toISOString(),this.eventSlug(),messageId),
      this.env.DB.prepare("UPDATE attendee_notifications SET body='This host announcement was removed.',title='Host announcement removed' WHERE event_slug=? AND kind IN ('host_update','host_first_post') AND source_id=?").bind(this.eventSlug(),messageId),
    ]);
  }

  updatePolicy(policy: RoomPolicyInput): void {
    this.assertWriterAvailable();
    this.configure(policy);
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() as ConnectionState | null;
      if (!state) continue;
      state.readOnly = policy.readOnly;
      state.readOnlyAt = policy.readOnlyAt;
      state.emergencyReadOnly = Boolean(policy.emergencyReadOnly);
      state.slowModeSeconds = policy.slowModeSeconds ?? 0;
      socket.serializeAttachment(state);
    }
    this.broadcast({ type: "policy", room: policy });
  }

  clearPins(): number {
    this.assertWriterAvailable();
    this.recentMessages = null;
    const result = this.ctx.storage.sql.exec("UPDATE messages SET pinned = 0 WHERE pinned = 1 AND deleted_at IS NULL");
    this.broadcast({ type: "pins_cleared" });
    return result.rowsWritten;
  }

  suspendAttendee(attendeeId: string): void {
    this.assertWriterAvailable();
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() as ConnectionState | null;
      if (state?.attendeeId === attendeeId) socket.close(4003, "Room access suspended");
    }
  }

  private async publishFlashUntracked(flash: FlashRecord, policy: RoomPolicyInput): Promise<void> {
    this.configure(policy);
    await this.scheduleFlashExpiry(policy);
    this.broadcast({ type: "flash_added", flash });
  }

  removeFlash(flashId: string): void {
    this.assertWriterAvailable();
    this.broadcast({ type: "flash_removed", flashId });
  }

  private async scheduleFlashExpiryUntracked(policy: RoomPolicyInput): Promise<void> {
    const expiry = Date.parse(policy.readOnlyAt);
    if (!Number.isFinite(expiry)) return;
    const current = await this.ctx.storage.getAlarm();
    const next = this.env.ROOM_HOST_FIRST_POST_ENABLED === '1' && this.pendingFirstHostPosts().length ? Math.min(expiry, Date.now() + 60_000) : expiry;
    if (current === null || current > next) await this.ctx.storage.setAlarm(next);
  }

  private pendingFirstHostPosts(): FirstHostPost[] {
    return this.ctx.storage.sql.exec<Omit<FirstHostPost,'eventSlug'>>(`SELECT host_account_id AS hostAccountId,message_id AS messageId,
      sender_attendee_id AS senderAttendeeId,created_at AS createdAt FROM room_host_posts WHERE completed_at IS NULL ORDER BY created_at LIMIT 25`)
      .toArray().map(row=>({...row,eventSlug:this.eventSlug()}));
  }

  private async scheduleFirstHostRetry(): Promise<void> {
    if(this.env.ROOM_HOST_FIRST_POST_ENABLED !== '1' || !this.pendingFirstHostPosts().length)return;
    const next=Date.now()+60_000, current=await this.ctx.storage.getAlarm();
    if(current===null || current>next)await this.ctx.storage.setAlarm(next);
  }

  private drainFirstHostPosts(): Promise<void> {
    if(this.firstHostDrain)return this.firstHostDrain;
    this.firstHostDrain=this.flushFirstHostPosts().finally(()=>{this.firstHostDrain=null;});
    return this.firstHostDrain;
  }

  private async flushFirstHostPosts(): Promise<void> {
    if(this.env.ROOM_HOST_FIRST_POST_ENABLED !== '1')return;
    for(const post of this.pendingFirstHostPosts()) {
      try {
        if(this.messageExists(post.messageId))await queueFirstHostPost(this.env,post);
        // Deletion may interleave while D1 fanout is awaited. Recheck before
        // acknowledging the outbox, so a failed cancellation remains retryable.
        if(!this.messageExists(post.messageId))await this.cancelMessageNotifications(post.messageId);
        this.ctx.storage.sql.exec('UPDATE room_host_posts SET completed_at=? WHERE host_account_id=? AND message_id=?',new Date().toISOString(),post.hostAccountId,post.messageId);
      } catch { console.error('First host notification remains queued for retry.'); }
    }
    await this.scheduleFirstHostRetry();
  }

  private async alarmUntracked(): Promise<void> {
    const configured = this.ctx.storage.sql.exec<{ eventSlug: string }>(
      "SELECT event_slug AS eventSlug FROM room_config WHERE id = 1 LIMIT 1",
    ).toArray()[0];
    if (!configured) return;
    await this.drainFirstHostPosts();
    const closing=this.ctx.storage.sql.exec<{at:string}>('SELECT read_only_at AS at FROM room_config WHERE id=1').one().at;
    const expiry=Date.parse(closing);
    if(Date.now()>=expiry) {
      await purgeExpiredFlashes(this.env.DB, configured.eventSlug);
      this.broadcast({ type: "room_closed" });
    } else {
      const current=await this.ctx.storage.getAlarm();
      if(current===null || current>expiry)await this.ctx.storage.setAlarm(expiry);
    }
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
      WHERE room_config.event_title IS NOT excluded.event_title
         OR room_config.starts_at IS NOT excluded.starts_at
         OR room_config.ends_at IS NOT excluded.ends_at
         OR room_config.read_only_at IS NOT excluded.read_only_at
    `, policy.eventSlug, policy.eventTitle, policy.startsAt, policy.endsAt, policy.readOnlyAt, new Date().toISOString());
  }

  private messageExists(messageId: string): boolean {
    return this.ctx.storage.sql.exec<{ found: number }>(
      "SELECT 1 AS found FROM messages WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      messageId,
    ).toArray().length > 0;
  }

  private eventSlug(): string {
    return this.ctx.storage.sql.exec<{ eventSlug: string }>(
      "SELECT event_slug AS eventSlug FROM room_config WHERE id = 1 LIMIT 1",
    ).toArray()[0]?.eventSlug ?? "";
  }

  private async refreshAdmissionAccessUntracked(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() as ConnectionState | null;
      if (state && await this.currentRoomBadge(state.attendeeId) === undefined) socket.close(4003, "Room access changed");
    }
  }

  private async currentRoomBadge(attendeeId: string): Promise<"VIP" | null | undefined> {
    const row=await this.currentRoomIdentity(attendeeId);
    return row ? row.roomBadge==='VIP' ? 'VIP' : null : undefined;
  }

  private async currentRoomIdentity(attendeeId: string, sessionId: string | null = null) {
    const row=await this.env.DB.prepare(`
      SELECT tier.room_badge AS roomBadge,
        (SELECT json_object('accountId',staff.id,'displayName',${firstHostPublicName}) FROM staff_accounts staff JOIN staff_event_assignments host_assignment ON host_assignment.account_id=staff.id
          WHERE ?='1' AND ticket.event_slug=? AND staff.id=? AND profile.email_verified_at IS NOT NULL AND staff.normalized_email=profile.normalized_email
            AND staff.status='active' AND staff.role='organizer' AND staff.must_change_password=0
            AND (staff.locked_until IS NULL OR staff.locked_until<=?) AND host_assignment.event_slug=ticket.event_slug LIMIT 1) AS hostJson
      FROM ticket_assignments assignment
      JOIN tickets ticket ON ticket.id = assignment.ticket_id
      JOIN orders orders ON orders.id = ticket.order_id
      JOIN attendee_profiles profile ON profile.id=assignment.attendee_id
      LEFT JOIN event_ticket_tiers tier ON tier.id = orders.ticket_tier_id
      WHERE assignment.attendee_id = ? AND assignment.status = 'active' AND profile.status='active' AND orders.status='paid'
        AND NOT EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug=ticket.event_slug AND (e.removed_at IS NOT NULL OR e.event_state IN ('cancelled','postponed')))
        AND NOT EXISTS (SELECT 1 FROM room_suspensions r WHERE r.attendee_id=assignment.attendee_id AND r.event_slug=ticket.event_slug AND r.restored_at IS NULL)
        AND ticket.event_slug = ? AND ticket.status IN ('issued', 'checked_in')
        AND (? IS NULL OR EXISTS (SELECT 1 FROM attendee_sessions session WHERE session.id=? AND session.attendee_id=profile.id
          AND session.revoked_at IS NULL AND session.expires_at>?))
        AND (orders.payment_provider <> 'rsvp' OR EXISTS (SELECT 1 FROM event_registrations r JOIN event_registration_settings rs ON rs.event_slug = r.event_slug WHERE r.order_id = orders.id AND r.status = 'confirmed' AND rs.room_access = 1))
      ORDER BY CASE WHEN tier.room_badge = 'VIP' THEN 1 ELSE 0 END DESC, tier.sort_order DESC
      LIMIT 1
    `).bind(this.env.ROOM_HOST_FIRST_POST_ENABLED ?? '',this.env.ROOM_HOST_FIRST_POST_EVENT_SLUG ?? '',this.env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID ?? '',new Date().toISOString(),attendeeId,this.eventSlug(),sessionId,sessionId,new Date().toISOString())
      .first<{roomBadge:string|null;hostJson:string|null}>();
    return row ? {roomBadge:row.roomBadge,hostIdentity:row.hostJson ? JSON.parse(row.hostJson) as {accountId:string;displayName:string} : null} : null;
  }

  private insertMessage(input: Omit<RoomMessage, "id" | "sequence" | "createdAt" | "deletedAt" | "reactions">, id: string = crypto.randomUUID()): RoomMessage {
    const createdAt = new Date().toISOString();
    this.recentMessages = null;
    const row = this.ctx.storage.sql.exec<{ sequence: number }>(`
      INSERT INTO messages (id, attendee_id, display_name, role, room_badge, kind, content, parent_id, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING sequence
    `, id, input.attendeeId, input.displayName, input.role, input.roomBadge, input.kind, input.content, input.parentId, input.pinned ? 1 : 0, createdAt).one();
    return { ...input, id, sequence: row.sequence, createdAt, deletedAt: null, reactions: [] };
  }

  private readMessages(viewer: ConnectionState, announcementId = ""): RoomMessage[] {
    // Only shared message content is reused. Authorization, blocks and reactions
    // are evaluated for each connection; every message mutation invalidates this.
    const rows = (!announcementId && this.recentMessages) || this.ctx.storage.sql.exec<StoredRoomMessage>(`
      SELECT id, sequence, attendee_id AS attendeeId, display_name AS displayName, role, room_badge AS roomBadge, kind,
             content, parent_id AS parentId, pinned, created_at AS createdAt, deleted_at AS deletedAt
      FROM messages WHERE sequence IN (SELECT sequence FROM messages ORDER BY sequence DESC LIMIT 100)
        OR (id = ? AND (kind = 'announcement' OR (kind = 'message' AND role = 'organizer')) AND deleted_at IS NULL)
      ORDER BY sequence DESC
    `, announcementId).toArray().reverse();
    if (!announcementId) this.recentMessages = rows;
    const visible = rows.filter((row) => !viewer.blockedAttendeeIds.includes(row.attendeeId));
    const reactionsByMessage = new Map<string, Array<{ emoji: string; count: number; mine: number }>>();
    // Load reactions once for this viewer's visible history, not once per message.
    // Only two bindings are needed even when an older linked announcement is included.
    if (visible.length) {
      const reactions = this.ctx.storage.sql.exec<{ messageId: string; emoji: string; count: number; mine: number }>(`
        SELECT message_id AS messageId, emoji, COUNT(*) AS count,
               MAX(CASE WHEN attendee_id = ? THEN 1 ELSE 0 END) AS mine
        FROM reactions WHERE message_id IN (SELECT value FROM json_each(?))
        GROUP BY message_id, emoji ORDER BY emoji
      `, viewer.attendeeId, JSON.stringify(visible.map(row => row.id))).toArray();
      for (const reaction of reactions) {
        const group = reactionsByMessage.get(reaction.messageId) ?? [];
        group.push(reaction);
        reactionsByMessage.set(reaction.messageId, group);
      }
    }
    return visible
      .map((row) => {
        const reactions = reactionsByMessage.get(row.id) ?? [];
        return {
          ...row,
          content: row.deletedAt ? "Message removed" : row.content,
          pinned: row.pinned === 1,
          reactions: reactions.map((reaction) => ({ emoji: reaction.emoji, count: reaction.count, mine: reaction.mine === 1 })),
        };
      });
  }

  private schedulePresence(): void {
    // A join burst must not send one full-room headcount for every connection.
    // New guests still receive their immediate snapshot. Existing guests get
    // the latest count once per short window, including after the last leave.
    if (this.presencePending) return;
    this.presencePending = true;
    this.defer(new Promise<void>((resolve) => {
      setTimeout(() => {
        this.presencePending = false;
        this.broadcast({ type: "presence", online: this.ctx.getWebSockets().length });
        resolve();
      }, 250);
    }));
  }

  private broadcast(payload: Record<string, unknown>): void {
    if (payload.type === 'message' || payload.type === 'reaction' || payload.type === 'flash_added') {
      this.defer(this.broadcastPrivate(payload));
      return;
    }
    const encoded = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        // Private content uses broadcastPrivate above. Public Room metadata
        // needs no per-recipient attachment deserialization.
        socket.send(encoded);
      } catch {
        socket.close(1011, "Room connection reset");
      }
    }
  }

  private async broadcastPrivate(payload: Record<string, unknown>): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const states = sockets.map(socket => ({ socket, state: socket.deserializeAttachment() as ConnectionState | null }));
    const sessionIds = [...new Set(states.flatMap(({ state }) => state?.sessionId ? [state.sessionId] : []))];
    const message = payload.message ?? payload.flash;
    const sender = isRecord(message) && typeof message.attendeeId === 'string' ? message.attendeeId
      : typeof payload.attendeeId === 'string' ? payload.attendeeId : '';
    const allowed = new Map<string, { attendeeId: string; blocked: number }>();
    try {
      // Batch socket identities below D1's bind limit. Silent, expired or revoked
      // connections must be checked before receiving private content too.
      for (let offset = 0; offset < sessionIds.length; offset += 80) {
        const ids = sessionIds.slice(offset, offset + 80);
        const rows = await this.env.DB.prepare(`
          SELECT session.id, session.attendee_id AS attendeeId,
            EXISTS (SELECT 1 FROM room_blocks block WHERE block.event_slug = ?
              AND block.blocker_attendee_id = session.attendee_id AND block.blocked_attendee_id = ?) AS blocked
          FROM attendee_sessions session JOIN attendee_profiles profile ON profile.id = session.attendee_id
          WHERE session.id IN (${ids.map(() => '?').join(',')}) AND session.revoked_at IS NULL
            AND session.expires_at > ? AND profile.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM room_suspensions r WHERE r.attendee_id = session.attendee_id AND r.event_slug = ? AND r.restored_at IS NULL)
            AND EXISTS (
              SELECT 1 FROM ticket_assignments assignment JOIN tickets ticket ON ticket.id = assignment.ticket_id
              JOIN orders orders ON orders.id = ticket.order_id
              WHERE assignment.attendee_id = session.attendee_id AND assignment.status = 'active'
                AND ticket.event_slug = ? AND ticket.status IN ('issued', 'checked_in') AND orders.status = 'paid'
                AND NOT EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug = ticket.event_slug AND (e.removed_at IS NOT NULL OR e.event_state IN ('cancelled', 'postponed')))
                AND (orders.payment_provider <> 'rsvp' OR EXISTS (SELECT 1 FROM event_registrations r
                  JOIN event_registration_settings rs ON rs.event_slug = r.event_slug
                  WHERE r.order_id = orders.id AND r.status = 'confirmed' AND rs.room_access = 1))
            )
        `).bind(this.eventSlug(), sender, ...ids, new Date().toISOString(), this.eventSlug(), this.eventSlug())
          .all<{ id: string; attendeeId: string; blocked: number }>();
        for (const row of rows.results) allowed.set(row.id, row);
      }
      const encoded = JSON.stringify(payload);
      for (const { socket, state } of states) {
        const current = state && allowed.get(state.sessionId);
        if (!current || current.attendeeId !== state?.attendeeId) { socket.close(4003, 'Room access changed'); continue; }
        if (current.blocked) continue;
        try { socket.send(encoded); } catch { socket.close(1011, 'Room connection reset'); }
      }
    } catch {
      // Do not send private content when authorization cannot be established.
      for (const { socket } of states) socket.close(1011, 'Room access could not be checked');
      console.error(JSON.stringify({ message: 'Room recipient access check failed', eventSlug: this.eventSlug() }));
    }
  }
}

