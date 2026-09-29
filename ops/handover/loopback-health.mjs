import { request } from 'node:http';
// Native fetch discards custom Host headers. Preserve the canonical host while
// connecting only to loopback; never relax the application's Host validation.
export function requestLoopbackHealth(host, port = 3119) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/healthz', method: 'GET', headers: { host }, timeout: 3000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 65536) response.destroy(new Error('Oversized health response.')); });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) { reject(new Error('Private health status rejected.')); return; }
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid private health response.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Private health request timed out.')));
    req.end();
  });
}
