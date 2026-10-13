import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packageHostBrandPreviews } from '../scripts/package-host-brand-previews.mjs';

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'host-brand-preview-'));
  const root = path.join(base, 'screens');
  await mkdir(root);
  for (const [browser, width] of [['desktop-chromium', 1280], ['mobile-chromium', 390]]) {
    const folder = path.join(root, `brand-fixture-${browser}`);
    await mkdir(folder);
    for (const name of ['yorke-profile.png', 'yorke-event.png', 'yorke-event-host.png']) {
      // Packaging tests inspect PNG envelope and dimensions, not rendered pixels.
      const bytes = Buffer.alloc(33);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
      bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(900, 20);
      await writeFile(path.join(folder, name), bytes);
    }
    await writeFile(path.join(folder, 'trace.zip'), 'never-package-this');
  }
  return { root, output: path.join(base, 'output'), sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), runId: 'test-only' };
}

test('host preview package preserves only the six named PNGs with exact source and hashes', async () => {
  const options = await fixture();
  const manifest = await packageHostBrandPreviews(options);
  assert.equal(manifest.sourceSha, options.sourceSha);
  assert.equal(manifest.sourceTree, options.sourceTree);
  assert.equal(manifest.environment, 'isolated candidate');
  assert.equal(manifest.files.length, 6);
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(options.output, file.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(file.viewport.width, file.browser === 'desktop-chromium' ? 1280 : 390);
  }
  assert.doesNotMatch(await readFile(path.join(options.output, 'evidence.json'), 'utf8'), /content|trace.zip|never-package/);
});

test('host preview package rejects mixed dimensions, duplicate images and malformed source identity', async () => {
  const wrongSize = await fixture();
  const image = path.join(wrongSize.root, 'brand-fixture-mobile-chromium/yorke-profile.png');
  const bytes = await readFile(image); bytes.writeUInt32BE(1280, 16); await writeFile(image, bytes);
  await assert.rejects(packageHostBrandPreviews(wrongSize));
  const duplicate = await fixture();
  const folder = path.join(duplicate.root, 'duplicate-mobile-chromium'); await mkdir(folder);
  await writeFile(path.join(folder, 'yorke-profile.png'), bytes);
  await assert.rejects(packageHostBrandPreviews(duplicate), /Expected exactly one/);
  await assert.rejects(packageHostBrandPreviews({ ...await fixture(), sourceSha: 'main' }));
});
