"use client";

import { useEffect } from "react";

const REVEAL_SELECTOR = "[data-scroll-reveal]";

export default function ScrollReveal() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    if (!targets.length) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      targets.forEach((target) => target.classList.add("is-revealed"));
      return;
    }

    document.documentElement.classList.add("scroll-reveal-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.12 });

    targets.forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("scroll-reveal-ready");
    };
  }, []);

  return null;
}
