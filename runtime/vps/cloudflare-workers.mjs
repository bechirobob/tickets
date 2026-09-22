// The alias is included only in the Node build. Cloudflare keeps its native
// bindings. A process has exactly one installed authoritative environment.
export const environmentKey = Symbol.for('becore.tickets.vps.environment');
export const env = new Proxy({}, {
  get(_target, key) {
    const active = globalThis[environmentKey];
    if (!active) throw new Error('Tickets VPS environment has not been installed.');
    return active[key];
  },
  ownKeys() { return Reflect.ownKeys(globalThis[environmentKey] ?? {}); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
});
export class DurableObject {
  constructor(ctx, environment) { this.ctx = ctx; this.env = environment; }
}
