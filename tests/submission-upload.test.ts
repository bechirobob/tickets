import { securityResponse } from "../worker/security-response";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GET as readSubmissionMedia } from "../app/api/media/[id]/route";
import { createStaffSession, PASSWORD_ITERATIONS } from "../lib/admin-session";
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
  form.set("venueMapUrl", "https://maps.google.com/?q=Test+Venue+Osu");
  form.set("area", "Osu");
  form.set("startsAt", "2027-02-14T21:00");
  form.set("endsAt", "2027-02-15T03:00");
  form.set("vibe", "Late night");
  form.set("ageRestriction", "21+");
  form.set("capacity", "500");
  form.set("priceFrom", "120");
  form.set("lineup", "DJ Test and friends");
  form.set("acceptedPolicies", "yes");
  if (includeFlyer) {
    form.set("poster", new File([
      new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]),
    ], "flyer.webp", { type: "image/webp" }));
  }
  return form;
}

describe("organiser flyer upload", () => {
  it("stores the flyer with its submission and keeps draft previews private until publication", async () => {
    const response = await submitParty(new Request("https://tickets.becoreops.com/api/submissions", {
      method: "POST",
      headers: { origin: "https://tickets.becoreops.com" },
      body: validSubmission(),
    }));
    expect(response.status).toBe(201);
    const result = await response.json() as { id: string; reference: string };
    expect(result.reference).toMatch(/^BC-[A-F0-9]{8}$/u);

    const stored = await env.DB.prepare(
      "SELECT poster_content_type, poster_data FROM party_submissions WHERE id = ?",
    ).bind(result.id).first<{ poster_content_type: string; poster_data: number[] }>();
    expect(stored?.poster_content_type).toBe("image/webp");
    expect(stored?.poster_data).toEqual([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);

    const load = (cookie?: string) => readSubmissionMedia(new Request(`https://tickets.becoreops.com/api/media/${result.id}`, { headers: cookie ? {cookie} : {} }), {params:Promise.resolve({id:result.id})});
    const denied = await load();
    expect(denied.status).toBe(404);
    expect(denied.headers.get('cache-control')).toContain('no-store');
    expect(denied.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const staffId = crypto.randomUUID(), now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO staff_accounts (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
      VALUES (?,?,'Curator','curator','test','test',?,0,'active',?,?,'test',?)`).bind(staffId,`${staffId}@example.com`,PASSWORD_ITERATIONS,now,now,now).run();
    const cookie = `bct_staff=${await createStaffSession(env.DB,{id:staffId})}`;
    const media = await load(cookie);
    expect(media.status).toBe(200);
    expect(media.headers.get('cache-control')).toContain('no-store');
    expect(media.headers.get("content-type")).toBe("image/webp");
    expect(media.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(media.headers.get("content-length")).toBe("12");
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]));
    await env.DB.prepare("UPDATE curated_event_records SET submission_id=?,status='scheduled',scheduled_publish_at=?,is_test_event=0,is_verified=1 WHERE slug='after-dark-osu'").bind(result.id,new Date(Date.now()+86400000).toISOString()).run();
    expect((await load()).status).toBe(404);
    await env.DB.prepare("UPDATE curated_event_records SET status='published' WHERE slug='after-dark-osu'").run();
    const published = await load();
    expect(published.status).toBe(200);
    expect(published.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(published.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(securityResponse(published, 'fixture-nonce', `/api/media/${result.id}`).headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    await env.DB.prepare("UPDATE curated_event_records SET status='unpublished',removed_at=? WHERE slug='after-dark-osu'").bind(now).run();
    expect((await load()).status).toBe(404);
    const withdrawnPreview = await load(cookie);
    expect(withdrawnPreview.status).toBe(200);
    expect(withdrawnPreview.headers.get('cache-control')).toContain('no-store');
    expect(withdrawnPreview.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(securityResponse(withdrawnPreview, 'fixture-nonce', `/api/media/${result.id}`).headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  it("rejects an event submission that has no flyer", async () => {
    const response = await submitParty(new Request("https://tickets.becoreops.com/api/submissions", {
      method: "POST",
      headers: { origin: "https://tickets.becoreops.com" },
      body: validSubmission(false),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Add a flyer or key visual before submitting." });
  });

  it("rejects a file whose bytes do not match its claimed image format", async () => {
    const form = validSubmission(false);
    form.set("poster", new File(["not an image"], "fake.webp", { type: "image/webp" }));
    const response = await submitParty(new Request("https://tickets.becoreops.com/api/submissions", {
      method: "POST",
      headers: { origin: "https://tickets.becoreops.com" },
      body: form,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "The flyer file does not match its image format." });
  });

  it("keeps every stored flyer safely below the D1 row limit", async () => {
    const bytes = new Uint8Array(1_500_001);
    bytes.set([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    const form = validSubmission(false);
    form.set("poster", new File([bytes], "too-large.webp", { type: "image/webp" }));
    const response = await submitParty(new Request("https://tickets.becoreops.com/api/submissions", {
      method: "POST",
      headers: { origin: "https://tickets.becoreops.com" },
      body: form,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "The prepared flyer must be a JPG, PNG or WebP under 1.5 MB." });
  });
});

for (const [field,value] of [['contactEmail','invalid'],['contactEmail',''],['socialUrl','javascript:alert(1)'],['socialUrl','x'.repeat(501)]] as const) it(`rejects invalid ${field} at the server boundary (${value.slice(0,20)})`,async()=>{
  const form=validSubmission(); form.set(field,value);
  const response=await submitParty(new Request('https://tickets.becoreops.com/api/submissions',{method:'POST',headers:{origin:'https://tickets.becoreops.com'},body:form}));
  expect(response.status).toBe(400);
});
