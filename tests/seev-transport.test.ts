import type { connect } from "cloudflare:sockets";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSeevHttpsResponse, requestSeev, seevTlsRequest } from "../lib/seev-transport";

const api = "https://api.seevplus.com/api/v1/developer/payments";
const encode = (value: string) => new TextEncoder().encode(value);
const json = JSON.stringify({ success: true, data: { name: "Kofi · GH₵1", amount: 100 } });
function wire(body = json) {
  return encode(`HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: ${encode(body).length}\r\nConnection: close\r\n\r\n${body}`);
}
function fakeSocket(response = wire(), failure?: Error) {
  const written: Uint8Array[] = [];
  const close = vi.fn(async () => {});
  const socket = {
    opened: Promise.resolve({}), closed: Promise.resolve(), close,
    writable: new WritableStream<Uint8Array>({ write(chunk) { written.push(chunk); } }),
    readable: new ReadableStream<Uint8Array>({ start(controller) {
      if (failure) { controller.error(failure); return; }
      // Break headers and UTF-8 body across arbitrary network reads.
      for (let index = 0; index < response.length; index += 7) controller.enqueue(response.slice(index, index + 7));
      controller.close();
    } }),
  };
  const open = vi.fn(() => socket) as unknown as typeof connect;
  return { open, close, written };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("SeeV secure HTTP response framing", () => {
  it("reads byte-counted JSON with non-ASCII names", async () => {
    const response = parseSeevHttpsResponse(wire());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(JSON.parse(json));
  });

  it("decodes chunked JSON without leaking transfer framing", async () => {
    const payload = encode(json);
    const head = encode("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n");
    const parts = [head, encode("3\r\n"), payload.slice(0, 3), encode("\r\n" + (payload.length - 3).toString(16) + ";source=test\r\n"), payload.slice(3), encode("\r\n0\r\n\r\n")];
    const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const response = parseSeevHttpsResponse(bytes);
    expect(await response.json()).toEqual(JSON.parse(json));
    expect(response.headers.has("transfer-encoding")).toBe(false);
  });

  it("preserves errors and redirects for the payment validator without following them", async () => {
    const response = parseSeevHttpsResponse(encode("HTTP/1.1 302 Found\r\nLocation: https://example.com/\r\nContent-Length: 0\r\n\r\n"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/");
  });

  it.each([
    "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\nContent-Length: 1\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\nextra",
    "HTTP/1.1 204 No Content\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\n Bad-Header: folded\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Length: -2\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nX-Large: " + "a".repeat(17000) + "\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\n\r\n" + "a".repeat(131073),
  ])("rejects truncated, ambiguous, compressed or oversized framing %#", (response) => {
    expect(() => parseSeevHttpsResponse(encode(response))).toThrow("invalid HTTPS response");
  });
});

describe("SeeV Worker TLS fallback", () => {
  it("reuses the exact original key/body once after the observed 525", async () => {
    const options = { method: "POST" as const, headers: { authorization: "Bearer test-only", "idempotency-key": "original-order", "content-type": "application/json" }, body: '{"amount":100,"recipient":{"name":"Kofi · GH₵1"}}' };
    const first = vi.fn(async () => new Response("error code: 525\n", { status: 525 }));
    vi.stubGlobal("fetch", first);
    const socket = fakeSocket();
    const fallback = vi.fn((url: string, init: Parameters<typeof seevTlsRequest>[1]) => seevTlsRequest(url, init, socket.open));
    const response = await requestSeev(api, options, fallback);
    expect(response.status).toBe(201);
    expect(first).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledExactlyOnceWith(api, options);
    expect(socket.open).toHaveBeenCalledExactlyOnceWith({ hostname: "api.seevplus.com", port: 443 }, { secureTransport: "on" });
    const sent = new TextDecoder().decode(socket.written[0]);
    expect(sent).toContain("idempotency-key: original-order\r\n");
    expect(sent).toContain(`Content-Length: ${encode(options.body).length}\r\n`);
    expect(sent.split("\r\n\r\n")[1]).toBe(options.body);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it.each([200, 302, 400, 401, 403, 409, 429, 500, 502, 503, 526])("does not retry HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
    const fallback = vi.fn();
    expect((await requestSeev(api + "/PAY-original", {}, fallback)).status).toBe(status);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not blindly retry an unknown network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection lost"); }));
    const fallback = vi.fn();
    await expect(requestSeev(api, {}, fallback)).rejects.toThrow("connection lost");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("keeps certificate failures fatal and closes the socket", async () => {
    const socket = fakeSocket(wire(), new Error("TLS certificate validation failed"));
    await expect(seevTlsRequest(api + "/PAY-original", {}, socket.open)).rejects.toThrow("certificate validation failed");
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("times out and closes a stalled TLS handshake", async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => {});
    const open = vi.fn(() => ({ opened: new Promise(() => {}), closed: Promise.resolve(), close })) as unknown as typeof connect;
    const pending = expect(seevTlsRequest(api + "/PAY-original", {}, open)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_001);
    await pending;
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["http://api.seevplus.com/api/v1/developer/payments", "https://api.seevplus.com.evil.example/api/v1/developer/payments", "https://user@api.seevplus.com/api/v1/developer/payments", api + "?redirect=evil", api + "/../accounts", api + "/PAY-invalid#fragment"])("rejects untrusted destinations before networking: %s", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestSeev(url)).rejects.toThrow("destination");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a POST without an original idempotency key", async () => {
    const socket = fakeSocket();
    await expect(seevTlsRequest(api, { method: "POST", body: "{}" }, socket.open)).rejects.toThrow("idempotency key");
    expect(socket.open).not.toHaveBeenCalled();
  });
});
