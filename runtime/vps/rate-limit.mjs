import { createHash } from 'node:crypto';

export class RateLimiter {
  constructor(database, namespace, limit, period = 60) {
    this.database = database;
    this.namespace = namespace;
    this.maximum = limit;
    this.period = period * 1000;
    database.exec('CREATE TABLE IF NOT EXISTS rate_limits(namespace TEXT NOT NULL, key TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(namespace,key)); CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(window)');
  }
  async limit({ key }) {
    const now = Date.now(), hash = createHash('sha256').update(String(key)).digest('hex');
    const connection = this.database;
    connection.prepare('DELETE FROM rate_limits WHERE window < ?').run(now - this.period);
    if (connection.prepare('SELECT count(*) AS n FROM rate_limits').get().n >= 30000 && !connection.prepare('SELECT 1 FROM rate_limits WHERE namespace=? AND key=?').get(this.namespace, hash)) return { success: false };
    const row = connection.prepare('INSERT INTO rate_limits VALUES(?,?,?,1) ON CONFLICT(namespace,key) DO UPDATE SET count=count+1 RETURNING count').get(this.namespace, hash, now);
    return { success: row.count <= this.maximum };
  }
}
