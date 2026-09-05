import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestError, requestJson } from "../lib/client-request";

afterEach(() => vi.unstubAllGlobals());

describe("customer request recovery", () => {
  it("returns confirmed JSON and preserves session-expired status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ saved: true })).mockResolvedValueOnce(Response.json({ error: "Sign in again." }, { status: 401 })));
    await expect(requestJson("/api/customer/privacy")).resolves.toEqual({ saved: true });
    await expect(requestJson("/api/customer/privacy")).rejects.toMatchObject({ status: 401, message: "Sign in again." });
  });
  it("does not report success for an unreadable gateway response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Gateway failed</html>", { status: 502 })));
    await expect(requestJson("/api/customer/support/night")).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json")));
    await expect(requestJson("/api/customer/transfers")).rejects.toThrow("Refresh to check");
  });
  it("treats a lost response as uncertain rather than inviting an immediate duplicate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(requestJson("/api/customer/transfers", { method: "POST" })).rejects.toThrow("may have completed");
  });
  it("aborts requests that exceed their deadline", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    await expect(requestJson("/api/customer/privacy", {}, 5)).rejects.toThrow("taking too long");
  });
  it("honours a caller cancellation and reports a recoverable request error", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }));
    await expect(requestJson("/api/customer/privacy", { signal: controller.signal })).rejects.toBeInstanceOf(RequestError);
  });
});
