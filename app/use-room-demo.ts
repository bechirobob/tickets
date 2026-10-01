"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Even phases type; odd phases insert one item and give it time to be read.
// The complete server/reduced-motion transcript is separate from the client scene.
export function useRoomDemo(paused: boolean, reducedMotion: boolean, offset = 0, itemCount = 5) {
  const completeStep = itemCount * 2 - 1;
  const resetStep = itemCount * 2;
  const phoneRef = useRef<HTMLElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const positions = useRef(new Map<string, number>());
  const running = ready && started && visible && !hidden && !paused && !reducedMotion;

  useEffect(() => {
    // Prepare an empty typing scene during hydration, before natural viewport
    // entry. No-JS and reduced-motion renders retain the complete transcript.
    const timer = window.setTimeout(() => {
      setReady(!reducedMotion);
      if (reducedMotion) { setStarted(false); setStep(0); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  useEffect(() => {
    const phone = phoneRef.current;
    if (!phone) return;
    const observer = new IntersectionObserver(([entry]) => {
      const phoneBounds = entry.boundingClientRect;
      const viewportHeight = entry.rootBounds?.height ?? window.innerHeight ?? phoneBounds.height;
      // A tall phone must not require more visible height than a short browser
      // can provide. Keep the width guard so a neighboring slide's sliver cannot run.
      setVisible(entry.isIntersecting && phoneBounds.width > 0 && phoneBounds.height > 0 && viewportHeight > 0
        && entry.intersectionRect.width >= phoneBounds.width * .55
        && entry.intersectionRect.height >= Math.min(phoneBounds.height, viewportHeight) * .55);
    }, { threshold: Array.from({ length: 21 }, (_, index) => index / 20) });
    observer.observe(phone);
    const visibility = () => setHidden(document.visibilityState !== "visible");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    if (!ready || reducedMotion || paused || hidden || !visible || started) return;
    const timer = window.setTimeout(() => setStarted(true), offset);
    return () => window.clearTimeout(timer);
  }, [visible, reducedMotion, paused, hidden, ready, started, offset]);

  useEffect(() => {
    if (!running) return;
    const duration = step === resetStep ? 350 : step === completeStep ? 4000 : step % 2 === 0 ? 800 : 2200;
    const timer = window.setTimeout(() => setStep((current) => (current + 1) % (resetStep + 1)), duration);
    return () => window.clearTimeout(timer);
  }, [running, step, completeStep, resetStep]);

  const shownStep = reducedMotion || !ready || (!running && step === resetStep) ? completeStep : step;
  const visibleCount = Math.min(itemCount, Math.floor((shownStep + 1) / 2));
  const resetting = shownStep === resetStep;
  const typing = shownStep < completeStep && shownStep % 2 === 0;
  const pauseReason = reducedMotion ? "reduced-motion" : !ready ? "not-ready" : hidden ? "hidden" : paused ? "paused" : !visible ? "offscreen" : !started ? "starting" : null;
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
      if (!running || shownStep === 0 || resetting) continue;
      const oldTop = previous.get(key);
      element.getAnimations().forEach((animation) => animation.cancel());
      // FLIP keeps reflow inside the fixed screen and animates only transforms.
      element.animate(oldTop === undefined
        ? [{ opacity: 0, transform: "translateY(7px) scale(.98)" }, { opacity: 1, transform: "none" }]
        : [{ transform: `translateY(${oldTop - top}px)` }, { transform: "none" }],
      { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" });
    }
    positions.current = next;
  }, [shownStep, running, resetting]);

  useEffect(() => {
    const animations = phoneRef.current?.getAnimations({ subtree: true }) ?? [];
    animations.forEach((animation) => {
      if (reducedMotion) animation.cancel();
      else if (running) animation.play();
      else animation.pause();
    });
  }, [running, reducedMotion]);

  return { phoneRef, streamRef, step: shownStep, ready, running, visible, visibleCount, typing, resetting, completeStep, pauseReason };
}
