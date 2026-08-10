"use client";

import { CheckCircle2, Loader2, Send, Upload } from "lucide-react";
import { FormEvent, useState } from "react";

export default function PartySubmissionForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const response = await fetch("/api/submissions", { method: "POST", body: new FormData(event.currentTarget) });
    const result = await response.json() as { error?: string; reference?: string };
    if (!response.ok) {
      setState("error");
      setMessage(result.error ?? "The submission refused to behave. Try again.");
      return;
    }
    setState("done");
    setMessage(result.reference ?? "Submitted");
    event.currentTarget.reset();
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
        <label className="poster-upload"><Upload size={20} /><span><b>Upload the poster or key visual</b><small>JPG, PNG or WebP · 8 MB maximum</small></span><input name="poster" type="file" accept="image/jpeg,image/png,image/webp" /></label>
        <p className="submission-consent">Submitting does not guarantee placement. If approved, BeCore may edit customer-facing copy for clarity and tone; the organiser remains responsible for accurate event, venue and refund information.</p>
      </section>

      <div className="submission-submit">
        <p>Good concept? Clear venue? Real line-up? Lovely. Send it over.</p>
        <button disabled={state === "sending"}>{state === "sending" ? <Loader2 className="spin" size={17} /> : <Send size={17} />} {state === "sending" ? "Sending to the queue…" : "Submit for review"}</button>
      </div>
      {state === "error" && <p className="submission-error" role="alert">{message}</p>}
    </form>
  );
}
