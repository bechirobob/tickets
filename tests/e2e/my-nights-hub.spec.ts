import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./catalogue";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page, eventSlug }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", route => route.fulfill({ status: 401, json: { error: "Isolated member fixture" } }));
  await page.route(`**/api/customer/experience/${eventSlug}`, route => route.fulfill({ json: {
    attendee: { displayName: "Ama" }, preference: { attendeeVisible: false, keepPosted: true }, visibleAttendees: 12,
    questions: [{ id: "arrival", prompt: "When are you joining us?", kind: "text", options: [], required: false, answer: "" }],
    updates: [{ id: "doors", title: "Meet us at the main gate", body: "Your pass is all you need at the door.", pinned: true, publishedAt: "2026-09-15T12:00:00Z", publishedBy: "The host" }], memories: [],
  } }));
  await page.route("**/api/customer/tickets", route => route.fulfill({ json: {
    attendee: { attendeeId: "isolated-nights-review" }, orders: [{
      roomAccess: true, orderId: "isolated-order", reference: "BECORE-FIXTURE", eventSlug: `${eventSlug}`,
      faceAmountMinor: 10000, bookingFeeMinor: 500, totalAmountMinor: 10500, currency: "GHS", paidAt: "2026-09-15T12:00:00Z", bookedFor: null,
      canViewPurchase: true, tierName: "General admission", tierDescription: "Grills, drinks and an afternoon with your people.", roomBadge: null,
      tickets: [{ id: "isolated-pass", ticketType: "general", status: "issued", checkedInAt: null, gateCode: "FIXTURE", qrPayload: "isolated-visual-fixture-not-valid-for-entry" }],
    }],
  } }));
  await page.route("**/api/customer/returns", route => route.fulfill({ json: { returns: [] } }));
  await page.route(`**/api/customer/support/${eventSlug}`, route => route.fulfill({ json: { orders: [], cases: [] } }));
  await page.route("**/api/customer/wallet/config", route => route.fulfill({ json: { apple: false, google: false } }));
});

test("the pass leads, supporting tools expand, and the plan preserves answers", async ({ page, eventSlug }, info) => {
  await page.goto(`/my-nights/${eventSlug}`);
  const nav = page.getByRole("navigation", { name: "Night views" });
  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(nav.getByRole("link", { name: "Room", exact: true })).toHaveAttribute("href", `/room/${eventSlug}`);
  await expect(nav.getByRole("button", { name: "Ticket 1" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("img", { name: "Entry QR code for ticket 1" })).toBeVisible();
  await expect(page.locator(".night-perks")).not.toHaveAttribute("open", "");
  await expect(page.locator(".night-purchase")).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await nav.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("my-nights-ticket.png"), fullPage: true });
  await page.getByText("What comes with it", { exact: true }).click();
  await expect(page.getByText("Grills, drinks and an afternoon with your people.")).toBeVisible();
  await page.getByText("Booking & help", { exact: true }).click();
  await expect(page.getByText("BECORE-FIXTURE", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("my-nights-booking-expanded.png"), fullPage: true });
  await nav.getByRole("button", { name: "The Night", exact: true }).click();
  await expect(page).toHaveURL(/view=details$/);
  await expect(page.getByText("Meet us at the main gate", { exact: true })).toBeVisible();
  await page.getByLabel("When are you joining us?").fill("Around five");
  await nav.getByRole("button", { name: "Ticket 1" }).click();
  await nav.getByRole("button", { name: "The Night", exact: true }).click();
  await expect(page.getByLabel("When are you joining us?")).toHaveValue("Around five");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("my-nights-plan.png"), fullPage: true });
  await page.reload();
  await expect(nav.getByRole("button", { name: "The Night", exact: true })).toHaveAttribute("aria-current", "page");
});

test("existing receipt and perks links still open their content", async ({ page, eventSlug }) => {
  await page.goto(`/my-nights/${eventSlug}?view=purchase`);
  await expect(page.getByText("BECORE-FIXTURE", { exact: true })).toBeVisible();
  await page.goto(`/my-nights/${eventSlug}?view=perks`);
  await expect(page.getByText("Grills, drinks and an afternoon with your people.")).toBeVisible();
  await page.goto(`/my-nights/${eventSlug}?view=tonight`);
  await expect(page.getByText("Meet us at the main gate", { exact: true })).toBeVisible();
});

test("group passes stay separate and support drafts survive view changes", async ({ page, eventSlug }, info) => {
  await page.route("**/api/customer/tickets", route => route.fulfill({ json: {
    attendee: { attendeeId: "isolated-group" }, orders: [{
      roomAccess: true, orderId: "group-order", reference: "GROUP-FIXTURE", eventSlug: `${eventSlug}`,
      faceAmountMinor: 30000, bookingFeeMinor: 1500, totalAmountMinor: 31500, currency: "GHS", paidAt: "2026-09-15T12:00:00Z", bookedFor: null,
      canViewPurchase: true, tierName: "General admission", tierDescription: "An afternoon with your people.", roomBadge: null,
      tickets: [1, 2, 3].map(number => ({ id: `group-${number}`, ticketType: "general", status: number === 3 ? "checked_in" : "issued", checkedInAt: number === 3 ? "2026-09-15T12:00:00Z" : null, gateCode: `PASS-${number}`, qrPayload: `isolated-qr-${number}` })),
    }],
  } }));
  await page.goto(`/my-nights/${eventSlug}`);
  await expect(page.getByRole("img", { name: "Entry QR code for ticket 1" })).toBeVisible();
  await page.getByRole("button", { name: "Next ticket" }).click();
  await expect(page.getByRole("img", { name: "Entry QR code for ticket 2" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Entry QR code for ticket 1" })).toHaveCount(0);
  await page.getByRole("button", { name: "Next ticket" }).click();
  await expect(page.getByText("Already inside. Excellent.")).toBeVisible();
  await expect(page.getByRole("img", { name: /Entry QR code/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next ticket" })).toBeDisabled();
  await page.getByLabel("Choose ticket").selectOption("0");
  await page.getByText("Booking & help", { exact: true }).click();
  await page.getByText("Start a support conversation", { exact: true }).click();
  await page.getByLabel("Subject", { exact: true }).fill("Arrival question");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Where should our group meet?");
  await page.getByRole("button", { name: "The Night", exact: true }).click();
  await page.getByRole("button", { name: "Ticket 3", exact: true }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Arrival question");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Where should our group meet?");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("my-nights-group-support.png"), fullPage: true });
});
