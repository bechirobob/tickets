import { getDb } from "../../../db";
import { partySubmissions } from "../../../db/schema";

export const dynamic = "force-dynamic";

const allowedVibes = new Set(["Late night", "Day party", "Alté", "Amapiano"]);
const allowedPosterTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function required(form: FormData, key: string, max = 500) {
  const value = String(form.get(key) ?? "").trim();
  if (!value || value.length > max) throw new Error(`Please check ${key}.`);
  return value;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    if (String(form.get("website") ?? "").trim()) {
      return Response.json({ accepted: true }, { status: 202 });
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
    let posterObjectKey: string | null = null;
    let posterContentType: string | null = null;

    if (poster instanceof File && poster.size > 0) {
      if (poster.size > 8 * 1024 * 1024 || !allowedPosterTypes.has(poster.type)) {
        return Response.json({ error: "Poster must be a JPG, PNG or WebP under 8 MB." }, { status: 400 });
      }
      const { env } = await import("cloudflare:workers");
      if (!env.BUCKET) return Response.json({ error: "Poster storage is temporarily unavailable." }, { status: 503 });
      posterObjectKey = `submission-posters/${id}`;
      posterContentType = poster.type;
      await env.BUCKET.put(posterObjectKey, await poster.arrayBuffer(), {
        httpMetadata: { contentType: poster.type, cacheControl: "public, max-age=86400" },
      });
    }

    const record = {
      id,
      organizerName: required(form, "organizerName", 120),
      contactName: required(form, "contactName", 120),
      contactEmail: required(form, "contactEmail", 180).toLowerCase(),
      contactPhone: required(form, "contactPhone", 40),
      title: required(form, "title", 120),
      concept: required(form, "concept", 1800),
      venueName: required(form, "venueName", 160),
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
      status: "submitted" as const,
      reviewNote: null,
      curationNote: null,
      scheduledPublishAt: null,
      publishedAt: null,
      eventSlug: null,
      createdAt: now,
      updatedAt: now,
    };

    const db = await getDb();
    await db.insert(partySubmissions).values(record);
    return Response.json({ id, reference: `BC-${id.slice(0, 8).toUpperCase()}`, status: record.status }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "We could not save this submission.";
    return Response.json({ error: message }, { status: 400 });
  }
}
