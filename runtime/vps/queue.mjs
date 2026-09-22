import { createHash } from 'node:crypto';

export class DeliveryQueue {
  constructor(connection) {
    this.connection = connection;
    connection.exec("CREATE TABLE IF NOT EXISTS delivery_queue(id TEXT PRIMARY KEY, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL, lease INTEGER, created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS delivery_queue_pending ON delivery_queue(available,lease)");
  }
  async send(body, options = {}) {
    if (typeof body?.deliveryId !== 'string' || body.deliveryId.length < 1 || body.deliveryId.length > 300) throw new Error('Invalid delivery task.');
    const id = createHash('sha256').update(body.deliveryId).digest('hex');
    if (this.connection.prepare('SELECT 1 FROM delivery_queue WHERE id=?').get(id)) return;
    if (this.connection.prepare('SELECT COUNT(*) AS n FROM delivery_queue').get().n >= 10000) throw new Error('Delivery queue capacity reached; the source delivery remains available for reconciliation.');
    const now = Date.now();
    const delay = Math.max(0, Math.min(43200, Number(options.delaySeconds) || 0));
    this.connection.prepare('INSERT INTO delivery_queue(id,body,available,created) VALUES(?,?,?,?)').run(id, JSON.stringify({ deliveryId: body.deliveryId }), now + delay * 1000, now);
  }
  async process(handler) {
    const now = Date.now();
    const job = this.connection.prepare('UPDATE delivery_queue SET lease=?,attempts=attempts+1 WHERE id=(SELECT id FROM delivery_queue WHERE available<=? AND (lease IS NULL OR lease<=?) ORDER BY available LIMIT 1) RETURNING *').get(now + 300000, now, now);
    if (!job) return false;
    let acknowledged = false, delay = 60;
    const message = { body: JSON.parse(job.body), ack() { acknowledged = true; }, retry(options) { delay = options?.delaySeconds ?? 60; } };
    try { await handler({ messages: [message] }); } catch { delay = 60; }
    if (acknowledged) this.connection.prepare('DELETE FROM delivery_queue WHERE id=?').run(job.id);
    else this.connection.prepare('UPDATE delivery_queue SET lease=NULL,available=? WHERE id=?').run(Date.now() + Math.min(3600, delay * Math.max(1, job.attempts)) * 1000, job.id);
    return true;
  }
}
