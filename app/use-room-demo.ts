"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Each phone tells one readable story, then quietly resets within its screen.
const beats = [1600, 1400, 3000, 1400, 3000, 1400, 4400, 350] as const;
export function useRoomDemo(paused: boolean, reducedMotion: boolean, offset = 0) {
  const phoneRef = useRef<HTMLElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(6); // Complete, useful server/no-JS fallback.
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const positions = useRef(new Map<string, number>());
  const running = ready && visible && !hidden && !paused && !reducedMotion;

  useEffect(() => {
    const phone = phoneRef.current;
    if (!phone) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= .55), { threshold: .55 });
    observer.observe(phone);
    const visibility = () => setHidden(document.visibilityState !== "visible");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    if (reducedMotion || paused || hidden || !visible || ready) return;
    const timer = window.setTimeout(() => { setStep(0); setReady(true); }, offset);
    return () => window.clearTimeout(timer);
  }, [visible, reducedMotion, paused, hidden, ready, offset]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setStep((current) => (current + 1) % beats.length), beats[step]);
    return () => window.clearTimeout(timer);
  }, [running, step]);

  const shownStep = reducedMotion || !ready || (!running && step === 7) ? 6 : step;
  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const previous = positions.current;
    const next = new Map<string, number>();
    for (const element of stream.querySelectorAll<HTMLElement>("[data-room-item]")) {
      if (element.hidden) continue;
      const key = element.dataset.roomItem!;
      const top = element.offsetTop;
      next.set(key, top);
      if (!running || shownStep === 0 || shownStep === 7) continue;
      const oldTop = previous.get(key);
      element.getAnimations().forEach((animation) => animation.cancel());
      // FLIP keeps reflow inside the fixed screen and animates only transforms.
      element.animate(oldTop === undefined
        ? [{ opacity: 0, transform: "translateY(7px) scale(.98)" }, { opacity: 1, transform: "none" }]
        : [{ transform: `translateY(${oldTop - top}px)` }, { transform: "none" }],
      { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" });
    }
    positions.current = next;
  }, [shownStep, running]);

  useEffect(() => {
    const animations = phoneRef.current?.getAnimations({ subtree: true }) ?? [];
    animations.forEach((animation) => {
      if (reducedMotion) animation.cancel();
      else if (running) animation.play();
      else animation.pause();
    });
  }, [running, reducedMotion]);

  return { phoneRef, streamRef, step: shownStep, running, typing: shownStep === 1 || shownStep === 3 || shownStep === 5 };
}
