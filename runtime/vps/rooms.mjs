import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { TheRoom } from '../../worker/the-room.ts';

class RoomState {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS vps_alarm(id INTEGER PRIMARY KEY CHECK(id=1), due INTEGER NOT NULL)');
    this.sockets = new Set();
    this.pending = new Set();
    this.ready = Promise.resolve();
    this.storage = {
      sql: { exec: (sql, ...args) => {
        // Only application-owned SQL reaches this API; all guest values are bound.
        let rows = [], changes = 0;
        if (!args.length && sql.trim().replace(/;$/, '').includes(';')) this.db.exec(sql);
        else {
          const statement = this.db.prepare(sql);
          const before = this.db.prepare('SELECT total_changes() AS n').get().n;
          if (statement.columns().length) rows = statement.all(...args).map(row => ({ ...row }));
          else statement.run(...args);
          changes = this.db.prepare('SELECT total_changes() AS n').get().n - before;
        }
        return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('Expected one Room row.'); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator](), rowsWritten: changes, rowsRead: rows.length };
      } },
      transactionSync: callback => {
        this.db.exec('BEGIN IMMEDIATE');
        try { const value = callback(); this.db.exec('COMMIT'); return value; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
      },
      getAlarm: async () => this.db.prepare('SELECT due FROM vps_alarm WHERE id=1').get()?.due ?? null,
      setAlarm: async due => { this.db.prepare('INSERT INTO vps_alarm VALUES(1,?) ON CONFLICT(id) DO UPDATE SET due=excluded.due').run(Number(due)); },
      deleteAlarm: async () => { this.db.exec('DELETE FROM vps_alarm'); },
    };
  }
  blockConcurrencyWhile(callback) { this.ready = this.ready.then(callback); return this.ready; }
  acceptWebSocket(socket) { this.sockets.add(socket); }
  getWebSockets() { return [...this.sockets].filter(socket => socket.readyState === 1); }
  waitUntil(promise) {
    const task = Promise.resolve(promise).catch(() => console.error('Room background operation failed.')).finally(() => this.pending.delete(task));
    this.pending.add(task);
  }
}

export class NodeRooms {
  constructor(directory, environment) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = directory;
    this.environment = environment;
    this.instances = new Map();
  }
  getByName(name) {
    if (typeof name !== 'string' || name.length < 1 || name.length > 200) throw new Error('Invalid Room name.');
    let entry = this.instances.get(name);
    if (!entry) {
      if (this.instances.size >= 1000) throw new Error('Room capacity reached.');
      const hash = createHash('sha256').update(name).digest('hex');
      const ctx = new RoomState(path.join(this.directory, hash + '.sqlite'));
      const room = new TheRoom(ctx, this.environment);
      let tail = ctx.ready;
      const proxy = new Proxy(room, { get(target, key) {
        if (key === 'then') return undefined;
        if (typeof target[key] !== 'function') return target[key];
        return (...args) => {
          const task = tail.then(() => target[key](...args));
          tail = task.catch(() => undefined);
          return task;
        };
      } });
      entry = { ctx, room: proxy, drain: () => tail };
      this.instances.set(name, entry);
    }
    return entry.room;
  }
  async accept(name, request, socket) {
    const room = this.getByName(name);
    let attachment = null;
    socket.serializeAttachment = value => { attachment = structuredClone(value); };
    socket.deserializeAttachment = () => structuredClone(attachment);
    socket.on('message', (data, binary) => { void room.webSocketMessage(socket, binary ? new Uint8Array(data).buffer : data.toString()).catch(() => socket.close(1011, 'Room unavailable')); });
    socket.on('close', (code, reason) => {
      this.instances.get(name)?.ctx.sockets.delete(socket);
      void room.webSocketClose(socket, code, reason.toString()).catch(() => {});
    });
    socket.on('error', () => socket.close(1011, 'Room unavailable'));
    await room.acceptConnection(request, socket);
  }
  async runAlarms() {
    // Durable alarms also survive a restart before anyone reopens their Room.
    for (const file of readdirSync(this.directory)) {
      if (!/^[a-f0-9]{64}\.sqlite$/.test(file)) continue;
      const db = new DatabaseSync(path.join(this.directory, file), { readOnly: true });
      try {
        const due = db.prepare('SELECT due FROM vps_alarm WHERE id=1').get()?.due;
        if (due !== undefined && due <= Date.now()) {
          const name = db.prepare('SELECT event_slug FROM room_config WHERE id=1').get()?.event_slug;
          if (name) this.getByName(name);
        }
      } finally { db.close(); }
    }
    for (const { ctx, room } of this.instances.values()) {
      const due = await ctx.storage.getAlarm();
      if (due !== null && due <= Date.now()) {
        // Delete before dispatch as Workers does; scheduleFlashExpiry may reset it.
        await ctx.storage.deleteAlarm();
        try { await room.alarm(); } catch { await ctx.storage.setAlarm(Date.now() + 60000); }
      }
    }
  }
  async close() {
    for (const { ctx, drain } of this.instances.values()) {
      for (const socket of ctx.sockets) socket.close(1012, 'Service restarting');
      await drain();
      await Promise.allSettled(ctx.pending);
      ctx.db.close();
    }
  }
}
