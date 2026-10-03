export function eventImageUrl(source: string, width: number, quality = 74): string {
  try {
    const url = new URL(source);
    if (url.hostname !== "images.unsplash.com") return source;
    url.searchParams.set("auto", "format");
    url.searchParams.set("fit", "crop");
    url.searchParams.set("w", String(width));
    url.searchParams.set("q", String(quality));
    return url.toString();
  } catch {
    return source;
  }
}

export function eventImageLoader({ src, width, quality }: ImageLoaderProps): string {
  return eventImageUrl(src, width, quality ?? 74);
}

import type { ImageLoaderProps } from "next/image";
