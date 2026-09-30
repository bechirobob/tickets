"use client";

const positions = new Map<string, number>();
let destination: string | null = null;
export function rememberPublicScroll(path: string, top: number) {
  if (path === "/" || path === "/events") positions.set(path, Math.max(0, top));
}
export function restorePublicDestination(path: string) { destination = path; }
export function takePublicScroll(path: string) {
  if (destination !== path) return null;
  destination = null;
  return positions.get(path) ?? 0;
}
