import { describe, expect, it } from "vitest";
import { POST as claimSession } from "../app/api/customer/session/route";
import { POST as prepareTickets } from "../app/api/customer/tickets/route";
import { DELETE as unblockAttendee, POST as blockAttendee } from "../app/api/rooms/[slug]/block/route";
import { POST as reportMessage } from "../app/api/rooms/[slug]/report/route";

const foreignOrigin = "https://compromised.becoreops.com";
const roomContext = { params: Promise.resolve({ slug: "after-dark-osu" }) };

function crossOriginRequest(path: string, method = "POST", body: Record<string, string> = {}): Request {
  return new Request(`https://tickets.becoreops.com${path}`, {
    method,
    headers: { "content-type": "application/json", origin: foreignOrigin },
    body: JSON.stringify(body),
  });
}

describe("attendee mutation origin guards", () => {
  it("rejects payment-return claims and wallet preparation from sibling origins", async () => {
    expect((await claimSession(crossOriginRequest("/api/customer/session"))).status).toBe(403);
    expect((await prepareTickets(crossOriginRequest("/api/customer/tickets"))).status).toBe(403);
  });

  it("rejects Room block, unblock and report writes from sibling origins", async () => {
    expect((await blockAttendee(crossOriginRequest("/api/rooms/after-dark-osu/block", "POST", { attendeeId: crypto.randomUUID() }), roomContext)).status).toBe(403);
    expect((await unblockAttendee(crossOriginRequest("/api/rooms/after-dark-osu/block", "DELETE", { attendeeId: crypto.randomUUID() }), roomContext)).status).toBe(403);
    expect((await reportMessage(crossOriginRequest("/api/rooms/after-dark-osu/report", "POST", { messageId: crypto.randomUUID(), reason: "spam" }), roomContext)).status).toBe(403);
  });
});
