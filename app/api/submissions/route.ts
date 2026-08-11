import { getDb } from "../../../db";
import { partySubmissions } from "../../../db/schema";
import { hashToken, mutationHasValidOrigin, requestMetadata, recordSecurityEvent } from "../../../lib/admin-session";
import { enforceRateLimit, verifyTurnstile } from "../../../lib/security-controls";

export const dynamic = "force-dynamic";

const allowedVibes = new Set(["Late night", "Day party", "Alté", "Amapiano"]);
const allowedPosterTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumStoredPosterBytes = 1_500_000;

function hasValidPosterSignature(bytes: Uint8Array, type: string) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= png.length && png.every((value, index) => bytes[index] === value);
  }
  if (type === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

function required(form: FormData, key: string, max = 500) {
  const value = String(form.get(key) ?? "").trim();
  if (!value || value.length > max) throw new Error(`Please check ${key}.`);
  return value;
}

function requiredHttpUrl(form: FormData, key: string) {
  const value = required(form, key, 500);
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Please check ${key}.`);
  return url.toString();
}

export async function POST(request: Request) {
  try {
    if (!mutationHasValidOrigin(request)) return Response.json({ error: "This submission request was not accepted." }, { status: 403 });
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 9 * 1024 * 1024) {
      return Response.json({ error: "The complete submission must stay under 9 MB." }, { status: 413 });
    }

    const form = await request.formData();
    if (String(form.get("website") ?? "").trim()) {
      return Response.json({ accepted: true }, { status: 202 });
    }
    const { env } = await import("cloudflare:workers");
    const contactEmail = String(form.get("contactEmail") ?? "").trim().toLowerCase();
    if (!(await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `submission:${await hashToken(contactEmail || requestMetadata(request).ip || "anonymous")}`))) {
      await recordSecurityEvent(env.DB, { kind: "rate_limited", subject: contactEmail, path: "/api/submissions", requestId: requestMetadata(request).requestId });
      return Response.json({ error: "Too many submissions were attempted. Wait a minute and try again." }, { status: 429 });
    }
    if (!(await verifyTurnstile(request, String(form.get("turnstileToken") ?? ""), "organizer_submission", env))) {
      return Response.json({ error: "Complete the browser security check and try again." }, { status: 400 });
    }

    const startsAt = required(form, "startsAt", 40);
    const endsAt = required(form, "endsAt", 40);
    const startTime = new Date(startsAt).getTime();
    const endTime = new Date(endsAt).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      return Response.json({ error: "The end time must be after the start time." }, { status: 400 });
    }

    const vibe = required(form, "vibe", 30);
    if (!allowedVibes.has(vibe)) return Response.json({ error: "Choose a valid party mood." }, { status: 400 });

    const capacity = Number(form.get("capacity"));
    const priceFrom = Number(form.get("priceFrom"));
    if (!Number.isInteger(capacity) || capacity < 20 || capacity > 20000) {
      return Response.json({ error: "Capacity must be between 20 and 20,000." }, { status: 400 });
    }
    if (!Number.isFinite(priceFrom) || priceFrom < 0 || priceFrom > 100000) {
      return Response.json({ error: "Enter a valid starting ticket price." }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const poster = form.get("poster");
    if (!(poster instanceof File) || poster.size === 0) {
      return Response.json({ error: "Add a flyer or key visual before submitting." }, { status: 400 });
    }
    if (poster.size > maximumStoredPosterBytes || !allowedPosterTypes.has(poster.type)) {
      return Response.json({ error: "The prepared flyer must be a JPG, PNG or WebP under 1.5 MB." }, { status: 400 });
    }

    const posterBytes = new Uint8Array(await poster.arrayBuffer());
    if (!hasValidPosterSignature(posterBytes, poster.type)) {
      return Response.json({ error: "The flyer file does not match its image format." }, { status: 400 });
    }

    const posterObjectKey = `submission-posters/${id}`;
    const posterContentType = poster.type;

    const record = {
      id,
      organizerName: required(form, "organizerName", 120),
      contactName: required(form, "contactName", 120),
      contactEmail,
      contactPhone: required(form, "contactPhone", 40),
      title: required(form, "title", 120),
      concept: required(form, "concept", 1800),
      venueName: required(form, "venueName", 160),
      venueMapUrl: requiredHttpUrl(form, "venueMapUrl"),
      area: required(form, "area", 80),
      startsAt: new Date(startTime).toISOString(),
      endsAt: new Date(endTime).toISOString(),
      vibe: vibe as "Late night" | "Day party" | "Alté" | "Amapiano",
      lineup: required(form, "lineup", 1000),
      capacity,
      priceFromMinor: Math.round(priceFrom * 100),
      ageRestriction: required(form, "ageRestriction", 20),
      socialUrl: String(form.get("socialUrl") ?? "").trim() || null,
      posterObjectKey,
      posterContentType,
      posterData: Buffer.from(posterBytes),
      status: "submitted" as const,
      reviewNote: null,
      curationNote: null,
      scheduledPublishAt: null,
      publishedAt: null,
      eventSlug: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const db = await getDb();
      await db.insert(partySubmissions).values(record);
    } catch (error) {
      console.error(JSON.stringify({ message: "party submission save failed", error: error instanceof Error ? error.message : String(error) }));
      return Response.json({ error: "The submission could not be saved. Please try again." }, { status: 500 });
    }
    return Response.json({ id, reference: `BC-${id.slice(0, 8).toUpperCase()}`, status: record.status }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "We could not save this submission.";
    return Response.json({ error: message }, { status: 400 });
  }
}
