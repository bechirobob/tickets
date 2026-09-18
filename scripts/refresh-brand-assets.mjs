// Repackage the approved render without redrawing or changing the identity.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');

const root = new URL('../', import.meta.url);
const png = await sharp(await readFile(new URL('public/brand/becore-ticket.webp', root))).png().toBuffer();
await writeFile(new URL('public/brand/becore-ticket.png', root), png);
const path = new URL('public/social-card.svg', root);
const svg = (await readFile(path, 'utf8')).replace(/<image[^>]*data-brand="rendered-ticket"[^>]*\/>/u,
  `<image data-brand="rendered-ticket" x="70" y="62" width="94" height="101" href="data:image/png;base64,${png.toString('base64')}"/>`);
await writeFile(path, svg);
await sharp(Buffer.from(svg)).resize(1200, 630).png().toFile(new URL('public/social-card.png', root).pathname);
console.log('Updated email and social assets from the approved rendered mark.');
