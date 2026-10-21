"use client";

import { useEffect, useId, useRef } from "react";
import { captureArrivalDocument, mountBrandArrival } from "../lib/brand-arrival";

// Module evaluation precedes child effects that consume one-time access links.
// The record is scoped to this document, never to a stored day/session or route.
const entry = captureArrivalDocument();

export default function BrandArrival() {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    if (!ref.current) return;
    return mountBrandArrival(ref.current, entry);
  }, []);
  return <div ref={ref} className="brand-arrival" hidden data-testid="brand-arrival">
    <svg className="brand-arrival__canvas" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <mask id={`${id}-page`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <rect width="100%" height="100%" fill="white" />
          <g className="brand-arrival__stage"><g className="brand-arrival__portal brand-arrival__portal-hole">
            <path d="M257 385V355a17.5 17.5 0 0 1 35 0v30Z" fill="black" />
          </g></g>
        </mask>
        <linearGradient id={`${id}-threshold`} gradientUnits="userSpaceOnUse" x1="264" x2="294.5">
          <stop stopColor="white" /><stop offset="1" stopColor="black" />
        </linearGradient>
        <mask id={`${id}-entry`} maskUnits="userSpaceOnUse" x="0" y="0" width="390" height="740">
          <rect width="264" height="740" fill="white" /><rect x="264" width="30.5" height="740" fill={`url(#${id}-threshold)`} />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="#281b2b" mask={`url(#${id}-page)`} />
      <g className="brand-arrival__stage">
        <g mask={`url(#${id}-entry)`}><g className="brand-arrival__lockup">
          <text className="brand-arrival__tickets" x="147" y="385">TICKETS</text>
          <text className="brand-arrival__word" x="146.5" y="371">BeCore</text>
          <image className="brand-arrival__emblem" href="/brand/becore-ticket.webp" x="92" y="341" width="49" height="52.5" />
        </g></g>
        <g className="brand-arrival__portal brand-arrival__door">
          <g fill="none" stroke="#f8eee7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M257 385V355a17.5 17.5 0 0 1 35 0v30M252 385h45" />
            <g className="brand-arrival__leaf">
              <path d="M257 355l22.5-7.5V385H257Z" fill="#37263a" />
              <path d="M270.95 367.5h.01" strokeWidth="1.5" />
            </g>
          </g>
        </g>
      </g>
    </svg>
    <button type="button" className="brand-arrival__skip" aria-label="Skip opening animation">Skip</button>
  </div>;
}
