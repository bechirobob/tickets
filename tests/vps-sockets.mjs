import { EventEmitter } from 'node:events';

class TestSocket extends EventTarget {
  constructor() { super(); this.readyState = 1; this.accepted = false; this.pending = []; this.events = new EventEmitter(); }
  on(name, callback) { this.events.on(name, callback); }
  accept() { this.accepted = true; queueMicrotask(() => { for (const value of this.pending.splice(0)) this.deliver(value); }); }
  deliver(value) {
    if (!this.accepted) { this.pending.push(value); return; }
    this.dispatchEvent(new MessageEvent('message', { data: value }));
    this.events.emit('message', Buffer.from(value), false);
  }
  send(value) { if (this.readyState !== 1) throw new Error('Socket closed.'); queueMicrotask(() => this.peer.deliver(value)); }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    for (const socket of [this, this.peer]) {
      socket.readyState = 3;
      queueMicrotask(() => {
        const event = new Event('close'); Object.assign(event, { code, reason });
        socket.dispatchEvent(event); socket.events.emit('close', code, Buffer.from(reason));
      });
    }
  }
}

// In-memory transport only for the shared business tests. Production uses ws
// over a real HTTP Upgrade and is tested separately with network connections.
export function addTestTransport(namespace) {
  const original = namespace.getByName.bind(namespace);
  namespace.getByName = name => new Proxy(original(name), { get(target, key) {
    if (key !== 'fetch') return target[key];
    return async request => {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 });
      if (request.headers.get('x-bct-room-authorized') !== '1') return new Response('Forbidden', { status: 403 });
      const client = new TestSocket(), server = new TestSocket();
      client.peer = server; server.peer = client; server.accept();
      await namespace.accept(name, request, server);
      return { status: 101, webSocket: client };
    };
  } });
}
