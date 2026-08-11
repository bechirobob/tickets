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

export function eventImageSrcSet(source: string, widths = [480, 720, 960]): string | undefined {
  try {
    if (new URL(source).hostname !== "images.unsplash.com") return undefined;
    return widths.map((width) => `${eventImageUrl(source, width)} ${width}w`).join(", ");
  } catch {
    return undefined;
  }
}
