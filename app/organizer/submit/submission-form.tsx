"use client";

import { CheckCircle2, Loader2, Send, Upload } from "lucide-react";
import { FormEvent, useState } from "react";

const maximumSourceBytes = 8 * 1024 * 1024;
const maximumPreparedBytes = 1_500_000;
const supportedPosterTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function loadPoster(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("We could not read that flyer. Choose a JPG, PNG or WebP image."));
    };
    image.src = url;
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, type: "image/webp" | "image/jpeg", quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  const webp = await encodeCanvas(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;
  return encodeCanvas(canvas, "image/jpeg", quality);
}

async function preparePoster(file: File) {
  if (file.size > maximumSourceBytes) throw new Error("Choose a flyer under 8 MB.");
  if (!supportedPosterTypes.has(file.type)) throw new Error("Choose a JPG, PNG or WebP flyer.");
  if (file.size <= maximumPreparedBytes) return file;

  const image = await loadPoster(file);
  let maximumEdge = 1800;
  let quality = 0.84;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, maximumEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the flyer. Try another image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const prepared = await canvasBlob(canvas, quality);
    if (prepared && prepared.size <= maximumPreparedBytes) {
      const name = file.name.replace(/\.[^.]+$/u, "") || "event-flyer";
      const extension = prepared.type === "image/webp" ? "webp" : "jpg";
      return new File([prepared], `${name}.${extension}`, { type: prepared.type, lastModified: Date.now() });
    }
    maximumEdge = Math.round(maximumEdge * 0.82);
    quality = Math.max(0.6, quality - 0.06);
  }

  throw new Error("That flyer stays too large after preparation. Choose a simpler or smaller image.");
}

export default function PartySubmissionForm() {
  const [state, setState] = useState<"idle" | "preparing" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setState("preparing");
    setMessage("");
    try {
      const poster = form.get("poster");
      if (!(poster instanceof File) || poster.size === 0) throw new Error("Add a flyer or key visual before submitting.");
      form.set("poster", await preparePoster(poster));
      setState("sending");

      const response = await fetch("/api/submissions", { method: "POST", body: form });
      const result = await response.json().catch(() => ({ error: "The upload did not finish. Please try again." })) as { error?: string; reference?: string };
      if (!response.ok) throw new Error(result.error ?? "The submission refused to behave. Try again.");

      setState("done");
      setMessage(result.reference ?? "Submitted");
      formElement.reset();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "The submission refused to behave. Try again.");
    }
  }

  if (state === "done") {
    return (
      <section className="submission-success">
        <CheckCircle2 size={37} />
        <p className="night-kicker"><span /> Safely in the queue</p>
        <h2>Your party has entered the group chat.</h2>
        <p>Reference <b>{message}</b>. BeCore will review the concept, venue, organiser history and ticket terms before anything goes public.</p>
        <button type="button" onClick={() => setState("idle")}>Submit another party</button>
      </section>
    );
  }

  return (
    <form className="submission-form" onSubmit={submit}>
      <input className="submission-honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <section>
        <div className="submission-step"><b>01</b><span>The people</span></div>
        <div className="submission-fields">
          <label>Organiser or collective<input name="organizerName" required maxLength={120} placeholder="Nightlife Accra" /></label>
          <label>Your name<input name="contactName" required maxLength={120} placeholder="Nana Mensah" /></label>
          <label>Email<input name="contactEmail" type="email" required maxLength={180} placeholder="nana@example.com" /></label>
          <label>Phone / WhatsApp<input name="contactPhone" type="tel" required maxLength={40} placeholder="+233 24 000 0000" /></label>
          <label className="wide">Social page <span>optional</span><input name="socialUrl" type="url" placeholder="https://instagram.com/..." /></label>
        </div>
      </section>

      <section>
        <div className="submission-step"><b>02</b><span>The party</span></div>
        <div className="submission-fields">
          <label className="wide">Party name<input name="title" required maxLength={120} placeholder="A name people will remember tomorrow" /></label>
          <label className="wide">The concept<textarea name="concept" required minLength={80} maxLength={1800} placeholder="What makes this worth dressing up and leaving the house for?" /></label>
          <label>Venue<input name="venueName" required maxLength={160} placeholder="The venue name" /></label>
          <label>Exact venue map link<input name="venueMapUrl" type="url" required maxLength={500} placeholder="https://maps.google.com/..." /></label>
          <label>Area<input name="area" required maxLength={80} placeholder="Osu, Labone, Cantonments…" /></label>
          <label>Starts<input name="startsAt" type="datetime-local" required /></label>
          <label>Ends<input name="endsAt" type="datetime-local" required /></label>
          <label>Mood<select name="vibe" required defaultValue=""><option value="" disabled>Choose honestly</option><option>Late night</option><option>Day party</option><option>Alté</option><option>Amapiano</option></select></label>
          <label>Age restriction<select name="ageRestriction" required defaultValue="18+"><option>18+</option><option>21+</option><option>25+</option></select></label>
          <label>Expected capacity<input name="capacity" type="number" min="20" max="20000" required placeholder="500" /></label>
          <label>Tickets from (GH₵)<input name="priceFrom" type="number" min="0" max="100000" step="0.01" required placeholder="120" /></label>
          <label className="wide">DJs / hosts / line-up<textarea name="lineup" required maxLength={1000} placeholder="Confirmed names first. Optimism is not a booking." /></label>
        </div>
      </section>

      <section>
        <div className="submission-step"><b>03</b><span>The proof</span></div>
        <label className="poster-upload"><Upload size={20} /><span><b>Upload the poster or key visual</b><small>JPG, PNG or WebP · up to 8 MB · prepared automatically</small></span><input name="poster" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <p className="submission-consent">Submitting does not guarantee placement. If approved, BeCore may edit customer-facing copy for clarity and tone; the organiser remains responsible for accurate event, venue and refund information.</p>
      </section>

      <div className="submission-submit">
        <p>Good concept? Clear venue? Real line-up? Lovely. Send it over.</p>
        <button disabled={state === "preparing" || state === "sending"}>{state === "preparing" || state === "sending" ? <Loader2 className="spin" size={17} /> : <Send size={17} />} {state === "preparing" ? "Preparing the flyer…" : state === "sending" ? "Sending to the queue…" : "Submit for review"}</button>
      </div>
      {state === "error" && <p className="submission-error" role="alert">{message}</p>}
    </form>
  );
}
