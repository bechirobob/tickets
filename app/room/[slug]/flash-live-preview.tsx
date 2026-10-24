"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { gradeFlashPixels, type FlashLook } from "../../../lib/flash-photo-filters";

// Use the export's pixel kernel instead of CanvasRenderingContext2D.filter,
// which is not consistently available on iPhone Safari. Bounded local frames
// keep processing below the full-resolution still-photo workload.
export default function FlashLivePreview({ video, look, strength, mirrored, ready, onReady, onError }: {
  video: RefObject<HTMLVideoElement | null>; look: FlashLook; strength: number;
  mirrored: boolean; ready: boolean; onReady: (ready: boolean) => void; onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const identity = `${look}:${strength}:${mirrored}`;
  const [shownIdentity, setShownIdentity] = useState("");
  useEffect(() => {
    const output = canvas.current;
    onReady(false);
    if (!ready || !output || look === "original" || !strength) return;
    const context = output.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    let frame = 0, last = -Infinity, interval = 1000 / 30, shown = false;
    const draw = (now: number) => {
      const source = video.current;
      if (document.visibilityState === "hidden") { frame = requestAnimationFrame(draw); return; }
      try {
        if (!context) throw new Error("Live looks aren’t available here. Choose Original or try again.");
        if (source?.videoWidth && source.videoHeight && now - last >= interval - 1) {
          const started = performance.now();
          const scale = Math.min(1, 480 / Math.max(source.videoWidth, source.videoHeight));
          const width = Math.max(1, Math.round(source.videoWidth * scale)), height = Math.max(1, Math.round(source.videoHeight * scale));
          if (output.width !== width) output.width = width;
          if (output.height !== height) output.height = height;
          context.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? width : 0, 0);
          context.drawImage(source, 0, 0, width, height);
          context.resetTransform();
          const image = context.getImageData(0, 0, width, height);
          gradeFlashPixels(image.data, look, strength);
          context.putImageData(image, 0, 0);
          // Target 30 fps, leaving at least as much time for input/paint as
          // this frame used. Slow devices back off; processing stays bounded.
          interval = Math.max(1000 / 30, Math.min(100, (performance.now() - started) * 2));
          last = now;
          if (!shown) { shown = true; setShownIdentity(identity); onReady(true); }
        }
        frame = requestAnimationFrame(draw);
      } catch {
        setShownIdentity(""); onReady(false);
        onError("The live look couldn’t load. Choose Original or try another look.");
      }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); output.width = 0; output.height = 0; };
  }, [video, look, strength, mirrored, ready, onReady, onError, identity]);
  return <canvas ref={canvas} className="flash-stage__image flash-capture__live-look" aria-hidden="true" style={{ visibility: ready && shownIdentity === identity ? "visible" : "hidden" }} />;
}
