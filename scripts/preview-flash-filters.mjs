/** Produce a reproducible pixel-kernel study, not a browser/device screenshot. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { transformSync } from "esbuild";

const [input, cropArgument, destination] = process.argv.slice(2);
if (!input || !cropArgument || !destination) throw new Error("Usage: node scripts/preview-flash-filters.mjs input.png x,y,width,height output-directory");
const [left, top, width, height] = cropArgument.split(",").map(Number);
if (![left, top, width, height].every(Number.isInteger) || left < 0 || top < 0 || width < 1 || height < 1) throw new Error("Invalid crop");
const source = await readFile(new URL("../lib/flash-photo-filters.ts", import.meta.url), "utf8");
const { FLASH_LOOKS, gradeFlashPixels } = await import(`data:text/javascript;base64,${Buffer.from(transformSync(source, { loader: "ts", format: "esm" }).code).toString("base64")}`);
const original = await sharp(input).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();
const out = resolve(destination); await mkdir(out, { recursive: true });
const escaped = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const layers = [];
const header = `<svg width="1080" height="1300"><rect width="1080" height="1300" fill="#171016"/><g font-family="sans-serif" fill="#fff0e9"><text x="36" y="46" font-size="28">FLASHES · THE ACTUAL GRADES</text><text x="36" y="79" font-size="18" fill="#d7bfce">One fictional still. Same pixels and framing. Strength 100%.</text><text x="36" y="1250" font-size="16" fill="#d7bfce">Output from the implemented pixel renderer. Not a camera UI screenshot or iPhone test.</text><text x="36" y="1276" font-size="16" fill="#d7bfce">Source: Original panel of the earlier fictional visual study. No customer photos.</text></g></svg>`;
layers.push({ input: Buffer.from(header), left: 0, top: 0 });
for (const [i, look] of FLASH_LOOKS.entries()) {
  const pixels = new Uint8ClampedArray(original); gradeFlashPixels(pixels, look.id, 100);
  const jpeg = await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).jpeg({ quality: 88 }).toBuffer();
  await writeFile(join(out, `${look.id}.jpg`), jpeg);
  const x = 36 + i % 2 * 518, y = 110 + Math.floor(i / 2) * 367;
  layers.push({ input: await sharp(jpeg).resize(490, 280, { fit: "contain", background: "#171016" }).png().toBuffer(), left: x, top: y });
  layers.push({ input: Buffer.from(`<svg width="490" height="70"><g font-family="sans-serif"><text x="0" y="28" font-size="22" fill="#fff0e9">${escaped(look.name)}</text><text x="0" y="56" font-size="17" fill="#d7bfce">${escaped(look.description)}</text></g></svg>`), left: x, top: y + 280 });
}
await sharp({ create: { width: 1080, height: 1300, channels: 4, background: "#171016" } }).composite(layers).png().toFile(join(out, "flashes-implemented-grades.png"));
await writeFile(join(out, "evidence.json"), JSON.stringify({ input, crop: { left, top, width, height }, rendererSha256: createHash("sha256").update(source).digest("hex"), strength: 100, renderer: "Actual gradeFlashPixels implementation; Sharp JPEG encoder for this code-output artifact, not browser canvas encoding or device performance evidence.", createdAt: new Date().toISOString() }, null, 2));
console.log(join(out, "flashes-implemented-grades.png"));
