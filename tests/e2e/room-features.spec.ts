import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function roomFixture(page: Page, options: { vipFailure?: boolean; imageFailure?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const photo = await readFile(new URL("../../public/atmospheres/behind-the-night.webp", import.meta.url));
  const now = new Date().toISOString(); const future = new Date(Date.now() + 86_400_000).toISOString();
  const room = { eventSlug: "after-dark-osu", eventTitle: "After Dark: Osu", readOnly: false, readOnlyAt: future };
  const base = { sequence: 1, roomBadge: null, kind: "message", parentId: null, pinned: false, deletedAt: null, reactions: [], createdAt: now };
  const messages = [
    { ...base, id: "pin", attendeeId: "host", displayName: "The Host", role: "organizer", kind: "announcement", pinned: true, content: "Gate 2 tonight. The pin is right; the queue on the other side isn’t." },
    { ...base, id: "host-later", attendeeId: "host", displayName: "The Host", role: "organizer", kind: "announcement", content: "Water is by the bar. Take a breather before the next set." },
    { ...base, id: "chat", attendeeId: "kofi", displayName: "Kofi", role: "attendee", content: "The loud shirt has arrived." },
  ];
  let flashes = [
    { id: "ama", attendeeId: "ama", displayName: "Ama", mine: false, openedAt: null as string | null },
    { id: "yaw", attendeeId: "yaw", displayName: "Yaw", mine: false, openedAt: null as string | null },
    { id: "mine", attendeeId: "self", displayName: "You", mine: true, openedAt: null as string | null },
  ].map((flash) => ({ ...flash, width: 1100, height: 733, createdAt: now, expiresAt: future }));
  const calls = { claims: [] as { id: string; viewId: string }[], closes: [] as string[], vip: [] as Record<string, unknown>[], reports: [] as Record<string, unknown>[], deletes: [] as string[], images: 0 };
  let vipAttempts = 0; let vipSent = false; let imageAttempts = 0; let reportAttempts = 0;
  const leases = new Map<string, { viewId: string; until: number }>();
  await page.route("**/api/**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const method = request.method();
    if (path.endsWith("/access")) return route.fulfill({ json: { allowed: true, attendee: { id: "self", roomBadge: "VIP" }, room } });
    if (path.endsWith("/vip")) {
      if (method === "POST") {
        calls.vip.push(request.postDataJSON());
        if (options.vipFailure && vipAttempts++ === 0) return route.fulfill({ status: 503, json: { error: "The Host connection dropped. Your request was not sent." } });
        vipSent = true; return route.fulfill({ status: 201, json: { requested: true, id: "private-request" } });
      }
      if (vipSent && options.vipFailure) return route.fulfill({ status: 503, json: { error: "History unavailable" } });
      return route.fulfill({ json: { settings: { bottleServiceEnabled: true, bottleMenu: "Water · Champagne · Cognac", songSuggestionsEnabled: true, assistanceEnabled: true }, requests: [] } });
    }
    if (path.endsWith("/flashes")) return route.fulfill({ json: { flashes, expiresAt: future } });
    const match = path.match(/\/flashes\/([^/]+)(\/report)?$/u);
    if (match) {
      const id = match[1];
      if (match[2]) {
        calls.reports.push(request.postDataJSON());
        if (reportAttempts++ === 0) return route.fulfill({ status: 503, json: { error: "Report not sent. Please try again." } });
        flashes = flashes.filter((flash) => flash.id !== id);
        return route.fulfill({ json: { reported: true } });
      }
      if (method === "DELETE") { calls.deletes.push(id); flashes = flashes.filter((flash) => flash.id !== id); return route.fulfill({ json: { removed: true } }); }
      if (method === "POST") {
        const { viewId } = request.postDataJSON(); calls.claims.push({ id, viewId });
        const existing = leases.get(id);
        if (existing && (existing.viewId !== viewId || existing.until <= Date.now()) && id !== "mine") return route.fulfill({ status: 410, json: { error: "Already opened." } });
        const lease = existing && existing.viewId === viewId ? existing : { viewId, until: Date.now() + 10_000 }; leases.set(id, lease);
        flashes = flashes.map((flash) => flash.id === id ? { ...flash, openedAt: now } : flash);
        return route.fulfill({ json: { imageUrl: `${path}?view=${viewId}`, openedAt: now, remainingMs: lease.until - Date.now() } });
      }
      if (method === "PATCH") { calls.closes.push(id); const lease = leases.get(id); if (lease) lease.until = 0; return route.fulfill({ json: { closed: true } }); }
      if (method === "GET") {
        calls.images++;
        if (options.imageFailure && imageAttempts++ === 0) return route.abort("failed");
        return route.fulfill({ contentType: "image/webp", body: photo, headers: { "cache-control": "no-store" } });
      }
    }
    if (path.includes("/notifications/preferences/")) return route.fulfill({ json: { roomMessages: true, hostUpdates: true } });
    if (path.endsWith("/notifications/subscription")) return route.fulfill({ json: { available: false } });
    return route.fulfill({ status: 401, json: { error: "Isolated fixture: no real attendee API access" } });
  });
  await page.routeWebSocket(/\/api\/room\/socket/u, (socket) => socket.send(JSON.stringify({ type: "snapshot", messages, room, online: 4 })));
  await page.goto("/room/after-dark-osu", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Message The Room" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Flashes; 2 unopened" })).toBeVisible();
  return calls;
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("concierge belongs to the Room and preserves a failed request through recovery", async ({ page }, info) => {
  const calls = await roomFixture(page, { vipFailure: true });
  const pin = page.locator(".room-pinned");
  expect((await pin.boundingBox())!.height).toBeLessThanOrEqual(44);
  await expect(page.locator(".room-stream")).not.toContainText("Gate 2 tonight");
  const host = page.locator(".room-host-update");
  expect((await host.boundingBox())!.height).toBeLessThanOrEqual(44);
  await host.locator("summary").click();
  await expect(host.locator("p")).toContainText("Water is by the bar");
  await host.locator("summary").click();
  const concierge = page.getByRole("button", { name: "Open VIP services" });
  await concierge.click();
  const sheet = page.getByRole("dialog", { name: "VIP concierge" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".room-sheet")).toHaveCSS("background-color", "rgb(48, 33, 44)");
  await sheet.getByRole("button", { name: /Suggest a song/u }).click();
  await expect(sheet.getByRole("textbox", { name: "Song and artist" })).toBeVisible();
  await sheet.getByRole("button", { name: /Bottle service/u }).click();
  await sheet.getByRole("textbox", { name: "Bottle or package" }).fill("Two bottles of water");
  await sheet.getByRole("textbox", { name: "Find me at" }).fill("Table 4");
  await sheet.getByRole("button", { name: "Send privately" }).click();
  await expect(sheet.getByRole("alert")).toContainText("not sent");
  await expect(sheet.getByRole("textbox", { name: "Bottle or package" })).toHaveValue("Two bottles of water");
  await accessible(page);
  await page.screenshot({ path: info.outputPath("room-concierge-sheet.png") });
  await sheet.getByRole("button", { name: "Send privately" }).click();
  await expect(sheet.getByRole("status")).toContainText("You’re on their radar.");
  expect(calls.vip).toEqual([{ kind: "bottle_service", detail: "Two bottles of water", location: "Table 4" }, { kind: "bottle_service", detail: "Two bottles of water", location: "Table 4" }]);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(concierge).toBeFocused();
});

test("Flashes stay minimal until opened, retry the same session, and stay opened after refresh", async ({ page }, info) => {
  const calls = await roomFixture(page, { imageFailure: true });
  const marker = page.getByRole("button", { name: "Open Flash from Ama", exact: true });
  expect((await marker.boundingBox())!.height).toBeLessThanOrEqual(48);
  await expect(marker.locator("img")).toHaveCount(0);
  expect(calls.images).toBe(0);
  await marker.click();
  const viewer = page.getByRole("dialog", { name: "Flash from Ama" });
  await expect(viewer.getByRole("button", { name: "Try opening again" })).toBeVisible();
  await viewer.getByRole("button", { name: "Try opening again" }).click();
  const photo = viewer.getByRole("img", { name: "Flash shared by Ama" });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(calls.claims).toHaveLength(2);
  expect(calls.claims[0]).toEqual(calls.claims[1]);
  await expect(viewer.getByRole("progressbar")).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: info.outputPath("room-flash-viewer.png") });
  await viewer.getByRole("button", { name: "Close Flash", exact: true }).click();
  await expect(viewer).not.toBeVisible();
  await expect.poll(() => calls.closes).toContain("ama");
  await expect(page.getByRole("button", { name: "Opened Flash from Ama" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Open Flashes; 1 unopened" })).toBeFocused();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Opened Flash from Ama" })).toBeDisabled();
  expect(calls.images).toBe(2);
});

test("the Flash inbox supports expiry, private reports and owner removal without photo tiles", async ({ page }, info) => {
  const calls = await roomFixture(page);
  await page.getByRole("button", { name: "Open Flashes; 2 unopened" }).click();
  const inbox = page.getByRole("dialog", { name: "Room Flashes", exact: true });
  await expect(inbox.locator("img")).toHaveCount(0);
  await accessible(page);
  await page.screenshot({ path: info.outputPath("room-flash-inbox.png") });
  await inbox.getByRole("button", { name: "Open Flash from Yaw", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Flash from Yaw" });
  await expect(viewer.getByRole("img")).toBeVisible();
  await expect(viewer).not.toBeVisible({ timeout: 12_000 });
  await expect(inbox).toBeVisible();
  await inbox.getByRole("button", { name: /All Flashes/u }).click();
  await expect(inbox.getByRole("button", { name: "Opened Flash from Yaw" })).toBeDisabled();
  await inbox.getByRole("button", { name: "Options for Flash from Yaw" }).click();
  const options = page.getByRole("dialog", { name: "Flash options", exact: true });
  await options.getByRole("button", { name: /Report this Flash/u }).click();
  await options.getByRole("textbox", { name: /Anything else/u }).fill("Shared without my permission.");
  await options.getByRole("button", { name: "Send report" }).click();
  await expect(options.getByRole("alert")).toContainText("Report not sent");
  await expect(options.getByRole("textbox")).toHaveValue("Shared without my permission.");
  await options.getByRole("button", { name: "Send report" }).click();
  await expect(inbox).toBeVisible();
  await expect(inbox.getByRole("button", { name: "Options for Flash from Yaw" })).toHaveCount(0);
  await inbox.getByRole("button", { name: "Options for Flash from you" }).click();
  await page.getByRole("dialog", { name: "Remove Flash" }).getByRole("button", { name: "Delete Flash", exact: true }).click();
  expect(calls.deletes).toEqual(["mine"]);
  expect(calls.reports).toEqual([{ reason: "nonconsensual", details: "Shared without my permission." }, { reason: "nonconsensual", details: "Shared without my permission." }]);
  await expect(inbox).toBeVisible();
});

test("the camera closes safely when permission resolves after dismissal", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { stopped: 0, requested: 0, resolve: null as null | ((stream: MediaStream) => void) };
    Object.defineProperty(window, "__roomCamera", { value: state });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: () => { state.requested++; return new Promise<MediaStream>((resolve) => { state.resolve = resolve; }); } });
  });
  await roomFixture(page);
  const camera = page.getByRole("button", { name: "Share a Flash", exact: true });
  await camera.click();
  await expect(page.getByRole("dialog", { name: "Flash camera" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __roomCamera: { requested: number } }).__roomCamera.requested)).toBe(1);
  await page.getByRole("button", { name: "Close camera" }).click();
  await expect(camera).toBeFocused();
  await page.evaluate(() => {
    const state = (window as unknown as { __roomCamera: { stopped: number; resolve: (stream: MediaStream) => void } }).__roomCamera;
    state.resolve({ getTracks: () => [{ stop: () => { state.stopped++; } }] } as unknown as MediaStream);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __roomCamera: { stopped: number } }).__roomCamera.stopped)).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("message actions animate in and out without a surrounding box", async ({ page }) => {
  await roomFixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const trigger = page.getByRole("button", { name: "Actions for Kofi's message" });
  await trigger.click();
  const actions = page.getByRole("toolbar", { name: "Actions for Kofi's message" });
  await expect(actions).toBeVisible();
  await expect(actions).toHaveCSS("animation-name", "room-actions-in");
  await expect(actions).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(actions).toHaveCSS("border-top-width", "0px");
  await expect(actions.getByRole("button", { name: "React 🔥", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(actions.getByRole("button", { name: "React ❤️", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(actions).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("textbox", { name: "Message The Room" }).click();
  await expect(actions).not.toBeVisible();
});
