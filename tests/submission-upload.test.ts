import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GET as readSubmissionMedia } from "../app/api/media/[id]/route";
import { POST as submitParty } from "../app/api/submissions/route";

function validSubmission(includeFlyer = true) {
  const form = new FormData();
  form.set("organizerName", "Night Test Collective");
  form.set("contactName", "Nana Test");
  form.set("contactEmail", "nana@example.com");
  form.set("contactPhone", "+233240000000");
  form.set("title", `Runtime Party ${crypto.randomUUID().slice(0, 6)}`);
  form.set("concept", "A deliberately detailed late-night event concept with a confirmed venue, line-up and a clear reason for guests to attend.");
  form.set("venueName", "Test Venue");
  form.set("area", "Osu");
  form.set("startsAt", "2027-02-14T21:00");
  form.set("endsAt", "2027-02-15T03:00");
  form.set("vibe", "Late night");
  form.set("ageRestriction", "21+");
  form.set("capacity", "500");
  form.set("priceFrom", "120");
  form.set("lineup", "DJ Test and friends");
  if (includeFlyer) form.set("poster", new File([new Uint8Array([82, 73, 70, 70])], "flyer.webp", { type: "image/webp" }));
  return form;
}

describe("organiser flyer upload", () => {
  it("stores the flyer in R2 and serves it through the protected media route", async () => {
    const response = await submitParty(new Request("https://tickets.becoreops.com/api/submissions", {
      method: "POST",
      body: validSubmission(),
    }));
    expect(response.status).toBe(201);
    const result = await response.json() as { id: string; reference: string };
    expect(result.reference).toMatch(/^BC-[A-F0-9]{8}$/u);

    const stored = await env.BUCKET.head(`submission-posters/${result.id}`);
    expect(stored).not.toBeNull();
    expect(stored?.httpMetadata?.contentType).toBe("image/webp");

    const media = await readSubmissionMedia(
      new Request(`https://tickets.becoreops.com/api/media/${result.id}`),
      { params: Promise.resolve({ id: result.id }) },
    );
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
  });

  it("rejects an event submission that has no flyer", async () => {
    const response = await submitParty(new Request("https://tickets.becoreops.com/api/submissions", {
      method: "POST",
      body: validSubmission(false),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Add a flyer or key visual before submitting." });
  });
});
