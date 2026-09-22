import tls from 'node:tls';
import { Duplex } from 'node:stream';

export function connect(address, options) {
  if (address.hostname !== 'api.seevplus.com' || address.port !== 443 || options?.secureTransport !== 'on') throw new Error('Unsupported payment socket destination.');
  const socket = tls.connect({ host: address.hostname, port: 443, servername: address.hostname, rejectUnauthorized: true, allowHalfOpen: false });
  const opened = new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
  const closed = new Promise((resolve, reject) => { socket.once('close', resolve); socket.once('error', reject); });
  const streams = Duplex.toWeb(socket);
  return { ...streams, opened, closed, async close() { socket.destroy(); } };
}
