/** Local, deterministic still-photo grades. No network, face detection or geometry changes. */
export const FLASH_LOOKS = [
  { id: "original", name: "Original", description: "Natural colour" },
  { id: "noir", name: "Noir", description: "Crisp black and white" },
  { id: "35mm", name: "35mm", description: "Warm tone, fine grain" },
  { id: "after-hours", name: "After Hours", description: "Cool shadows, warm light" },
  { id: "chrome", name: "Chrome", description: "Muted colour, clean contrast" },
] as const;
export type FlashLook = typeof FLASH_LOOKS[number]["id"];
export const FLASH_MAX_EDGE = 1600;
export const FLASH_RENDER_CHUNK_PIXELS = 32_768;

export function flashStrength(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

/** Centre crop corresponding to object-fit: cover at the instant of capture. */
export function flashCaptureFrame(sourceWidth: number, sourceHeight: number, viewWidth: number, viewHeight: number) {
  if (![sourceWidth, sourceHeight, viewWidth, viewHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error("The camera isn’t ready. Try again.");
  const ratio = viewWidth / viewHeight;
  const width = Math.min(sourceWidth, sourceHeight * ratio);
  const height = width / ratio;
  const scale = Math.min(1, FLASH_MAX_EDGE / Math.max(width, height));
  return { x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height, outputWidth: Math.max(1, Math.round(width * scale)), outputHeight: Math.max(1, Math.round(height * scale)) };
}

const clamp = (value: number) => Math.max(0, Math.min(255, value));
const contrast = (value: number, amount: number) => clamp((value - 127.5) * amount + 127.5);

/** Mutates only the specified RGBA pixel range, preserving alpha and spatial layout. */
export function gradeFlashPixels(pixels: Uint8ClampedArray, look: FlashLook, strength: number, startPixel = 0, endPixel = pixels.length / 4): void {
  const mix = flashStrength(strength) / 100;
  if (look === "original" || !mix) return;
  if (!FLASH_LOOKS.some(item => item.id === look)) throw new Error("That look isn’t available.");
  for (let pixel = startPixel; pixel < endPixel; pixel++) {
    const i = pixel * 4;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const luma = .2126 * r + .7152 * g + .0722 * b;
    let red = r, green = g, blue = b;
    if (look === "noir") {
      red = green = blue = contrast(luma, 1.15);
    } else if (look === "35mm") {
      // A pixel-index hash makes noise stable across repeat renders and chunks.
      let seed = Math.imul(pixel ^ 0x6d2b79f5, 0x45d9f3b);
      seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
      const grain = (((seed ^ (seed >>> 16)) >>> 0) / 0xffffffff - .5) * 5;
      red = contrast(luma + (r - luma) * .92, .96) + 5 + grain;
      green = contrast(luma + (g - luma) * .92, .96) + 2 + grain;
      blue = contrast(luma + (b - luma) * .92, .96) - 5 + grain;
    } else if (look === "after-hours") {
      const shadow = Math.pow(1 - luma / 255, 2);
      const light = Math.pow(luma / 255, 2);
      red = contrast(r, 1.07) - shadow * 5 + light * 7;
      green = contrast(g, 1.07) + shadow * 2 + light * 2;
      blue = contrast(b, 1.07) + shadow * 9 - light * 6;
    } else if (look === "chrome") {
      red = contrast(luma + (r - luma) * .68, 1.1);
      green = contrast(luma + (g - luma) * .68, 1.1);
      blue = contrast(luma + (b - luma) * .68, 1.1);
    }
    pixels[i] = r + (clamp(red) - r) * mix;
    pixels[i + 1] = g + (clamp(green) - g) * mix;
    pixels[i + 2] = b + (clamp(blue) - b) * mix;
  }
}

export function flashCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("That photo couldn’t be prepared. Try again.")), "image/jpeg", .88));
}

/** Shared thumbnail/export renderer. Work yields every 32K pixels; stale jobs stop before encoding. */
export async function renderFlashLook(source: HTMLCanvasElement, look: FlashLook, strength: number, signal: AbortSignal, maxEdge = FLASH_MAX_EDGE): Promise<Blob> {
  signal.throwIfAborted();
  const limit = Math.max(1, Math.min(FLASH_MAX_EDGE, maxEdge));
  const scale = Math.min(1, limit / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  try {
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new Error("This browser couldn’t prepare the look. Choose Original or try again.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (look !== "original" && flashStrength(strength)) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const count = image.data.length / 4;
      for (let start = 0; start < count; start += FLASH_RENDER_CHUNK_PIXELS) {
        signal.throwIfAborted();
        gradeFlashPixels(image.data, look, strength, start, Math.min(count, start + FLASH_RENDER_CHUNK_PIXELS));
        if (start + FLASH_RENDER_CHUNK_PIXELS < count) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      signal.throwIfAborted();
      context.putImageData(image, 0, 0);
    }
    const blob = await flashCanvasBlob(canvas);
    signal.throwIfAborted();
    return blob;
  } finally {
    // Explicitly release backing storage, important for repeated iPhone retakes.
    canvas.width = 0; canvas.height = 0;
  }
}
