import { connect } from "cloudflare:sockets";

const ORIGIN = "https://api.seevplus.com";
const PATH = "/api/v1/developer/payments";
const MAX_BODY = 128 * 1024;
const MAX_HEADERS = 16 * 1024;
const MAX_WIRE = MAX_BODY * 2 + MAX_HEADERS;
type Options = { method?: "GET" | "POST"; headers?: HeadersInit; body?: string };

function invalidResponse(): never { throw new Error("SeevPlus returned an invalid HTTPS response."); }

// Small, bounded HTTP/1.1 reader for this JSON API only. No redirects,
// compression, connection reuse or untrusted destination URLs are supported.
export function parseSeevHttpsResponse(bytes: Uint8Array): Response {
  if (bytes.length > MAX_WIRE) invalidResponse();
  const wire = new TextDecoder("latin1").decode(bytes);
  const boundary = wire.indexOf("\r\n\r\n");
  if (boundary < 0 || boundary > MAX_HEADERS) invalidResponse();
  const lines = wire.slice(0, boundary).split("\r\n");
  const status = /^HTTP\/1\.[01] ([2-5]\d{2})(?: [\x20-\x7e]*)?$/u.exec(lines.shift() ?? "");
  if (!status) invalidResponse();
  const headers = new Headers();
  for (const line of lines) {
    const pair = /^([!#$%&'*+.^_`|~\w-]+):[\t ]*([^\r\n]*)$/u.exec(line);
    if (!pair || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(pair[2])) invalidResponse();
    const name = pair[1].toLowerCase();
    if (["content-length", "transfer-encoding", "content-encoding"].includes(name) && headers.has(name)) invalidResponse();
    headers.append(name, pair[2].trim());
  }
  const encoding = headers.get("content-encoding");
  if (encoding && encoding !== "identity") invalidResponse();
  const transfer = headers.get("transfer-encoding");
  const length = headers.get("content-length");
  let body = bytes.slice(boundary + 4);
  if (transfer) {
    if (transfer.toLowerCase() !== "chunked" || length !== null) invalidResponse();
    const decoded: Uint8Array[] = [];
    let offset = boundary + 4;
    let size = 0;
    while (true) {
      const end = wire.indexOf("\r\n", offset);
      if (end < 0 || end - offset > 1024) invalidResponse();
      const chunk = /^([0-9a-fA-F]{1,8})(?:;[\x20-\x7e]*)?$/u.exec(wire.slice(offset, end));
      if (!chunk) invalidResponse();
      const count = parseInt(chunk[1], 16);
      offset = end + 2;
      if (count === 0) {
        // No trailers are requested; reject them rather than letting them
        // change the meaning of payment response headers.
        if (wire.slice(offset) !== "\r\n") invalidResponse();
        break;
      }
      size += count;
      if (size > MAX_BODY || offset + count + 2 > bytes.length || wire.slice(offset + count, offset + count + 2) !== "\r\n") invalidResponse();
      decoded.push(bytes.slice(offset, offset + count));
      offset += count + 2;
    }
    body = new Uint8Array(size);
    let position = 0;
    for (const chunk of decoded) { body.set(chunk, position); position += chunk.length; }
    headers.delete("transfer-encoding");
    headers.delete("content-length");
  } else if (length !== null && (!/^\d+$/u.test(length) || Number(length) !== body.length)) invalidResponse();
  if (body.length > MAX_BODY) invalidResponse();
  headers.delete("connection");
  const code = Number(status[1]);
  if ([204, 205, 304].includes(code) && body.length) invalidResponse();
  return new Response([204, 205, 304].includes(code) ? null : body, { status: code, headers });
}

function validateRequest(url: string, options: Options) {
  const target = new URL(url);
  const method = options.method ?? "GET";
  if (target.origin !== ORIGIN || target.username || target.password || target.search || target.hash
    || !(target.pathname === PATH || /^\/api\/v1\/developer\/payments\/PAY-[A-Za-z0-9-]{1,160}$/u.test(target.pathname))
    || (method === "POST" && target.pathname !== PATH) || !["GET", "POST"].includes(method)) {
    throw new Error("Invalid SeevPlus request destination.");
  }
  if (method === "GET" && options.body !== undefined) throw new Error("Invalid SeevPlus request body.");
  if (method === "POST" && (!options.body || !new Headers(options.headers).get("idempotency-key"))) {
    throw new Error("SeevPlus checkout requires its original body and idempotency key.");
  }
  return { target, method };
}

export async function seevTlsRequest(url: string, options: Options, openSocket: typeof connect = connect): Promise<Response> {
  const { target, method } = validateRequest(url, options);
  const body = new TextEncoder().encode(options.body ?? "");
  if (body.length > MAX_BODY) throw new Error("SeevPlus request exceeds the size limit.");
  const headers = new Headers(options.headers);
  const lines = [`${method} ${target.pathname} HTTP/1.1`, "Host: api.seevplus.com", "Accept: application/json", "Accept-Encoding: identity", "Connection: close"];
  for (const name of ["authorization", "content-type", "idempotency-key"]) {
    const value = headers.get(name);
    if (value !== null) {
      if (!/^[\x20-\x7e]*$/u.test(value)) throw new Error("Invalid SeevPlus request header.");
      lines.push(`${name}: ${value}`);
    }
  }
  if (method === "POST") lines.push(`Content-Length: ${body.length}`);
  const head = new TextEncoder().encode(lines.join("\r\n") + "\r\n\r\n");
  const request = new Uint8Array(head.length + body.length);
  request.set(head); request.set(body, head.length);
  // The official hostname supplies SNI and certificate verification. Never use
  // an IP override, plaintext socket, alternate host or disabled TLS validation.
  const socket = openSocket({ hostname: target.hostname, port: 443 }, { secureTransport: "on" });
  void socket.closed.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await socket.opened;
        const writer = socket.writable.getWriter();
        await writer.write(request);
        writer.releaseLock();
        const reader = socket.readable.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > MAX_WIRE) throw new Error("SeevPlus response exceeds the size limit.");
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return parseSeevHttpsResponse(bytes);
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("SeevPlus HTTPS request timed out.")), 10_000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await socket.close().catch(() => {});
  }
}

export async function requestSeev(url: string, options: Options = {}, secureRequest = seevTlsRequest): Promise<Response> {
  validateRequest(url, options);
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000), redirect: "manual" });
  if (response.status !== 525) return response;
  await response.body?.cancel();
  // Reuse the exact body and key. A single fallback is allowed only for the
  // observed edge TLS failure; provider rejections/redirects are never retried.
  return secureRequest(url, options);
}
