import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
const destination = new URL('../../dist/fallback/', import.meta.url);
await mkdir(destination, { recursive: true });
const template = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const brand = await readFile(new URL('../../public/brand/becore-ticket.webp', import.meta.url));
await writeFile(new URL('index.html', destination), template.replace('__BRAND_IMAGE__', brand.toString('base64')));
await copyFile(new URL('./Caddyfile', import.meta.url), new URL('Caddyfile', destination));
for (const file of ['monitor.py', 'becore-tickets-fallback.service', 'becore-tickets-fallback.timer']) {
  await copyFile(new URL(file, import.meta.url), new URL(file, destination));
}
