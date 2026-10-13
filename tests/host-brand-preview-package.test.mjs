import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
    for (const name of ['yorke-directory.png', 'yorke-profile.png', 'yorke-event.png', 'yorke-event-host.png', ...(browser === 'mobile-chromium' ? ['yorke-profile-narrow.png', 'yorke-event-host-narrow.png'] : [])]) {
      // Packaging tests inspect PNG envelope and dimensions, not rendered pixels.
      const bytes = Buffer.alloc(33);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
      bytes.write('IHDR', 12); bytes.writeUInt32BE(name.includes('narrow') ? 320 : width, 16); bytes.writeUInt32BE(900, 20);
      await writeFile(path.join(folder, name), bytes);
    }
    await writeFile(path.join(folder, 'trace.zip'), 'never-package-this');
    for (const width of browser === 'mobile-chromium' ? [390, 320] : [1280]) {
      const before = { hostHeight: 197, brandToName: 4, nameToMeta: 6, metaToLink: 12, linkHeight: 44, paddingTop: 26, paddingBottom: 26, nameFontSize: 25, nameLineHeight: 37.5, brandFontSize: 13, metaFontSize: 13, portraitWidth: 64, portraitHeight: 78, sealWidth: 28 };
      const after = { ...before, hostHeight: 140, brandToName: 2, nameToMeta: 2, metaToLink: 0, paddingTop: 12, paddingBottom: 12, nameLineHeight: 28.75 };
      await writeFile(path.join(folder, width === 320 ? 'yorke-host-spacing-narrow.json' : 'yorke-host-spacing.json'), JSON.stringify({ sourceSha: 'a'.repeat(40), baselineSourceSha: '7013070856ed3dc9cfb81693b5c70df19005c0e9', viewport: { width, height: 900 }, before, after }));
    }

  }
  return { root, output: path.join(base, 'output'), sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), runId: 'test-only' };
}

test('host preview package preserves only the ten named PNGs with exact source and hashes', async () => {
  const options = await fixture();
  const manifest = await packageHostBrandPreviews(options);
  assert.equal(manifest.sourceSha, options.sourceSha);
  assert.equal(manifest.sourceTree, options.sourceTree);
  assert.equal(manifest.environment, 'isolated candidate');
  assert.equal(manifest.files.length, 10);
  assert.equal(manifest.spacingComparisons.length, 3);
  assert.deepEqual(manifest.spacingComparisons.map(item => item.viewport.width), [1280, 390, 320]);
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(options.output, file.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(file.viewport.width, file.view.includes('narrow') ? 320 : file.browser === 'desktop-chromium' ? 1280 : 390);
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

test('spacing evidence rejects changed type size, shrunken targets and mismatched source', async () => {
  for (const mutate of [data => { data.after.nameFontSize = 20; }, data => { data.after.linkHeight = 32; }, data => { data.sourceSha = 'c'.repeat(40); }]) {
    const options = await fixture();
    const file = path.join(options.root, 'brand-fixture-mobile-chromium/yorke-host-spacing.json');
    const data = JSON.parse(await readFile(file, 'utf8')); mutate(data); await writeFile(file, JSON.stringify(data));
    await assert.rejects(packageHostBrandPreviews(options));
  }
});


test('candidate screenshots remain reviewable when optional comparison is unavailable', async () => {
  const options = await fixture();
  const file = path.join(options.root, 'brand-fixture-mobile-chromium/yorke-host-spacing.json');
  await rename(file, file + '.incomplete');
  const manifest = await packageHostBrandPreviews(options);
  assert.equal(manifest.files.length, 10);
  assert.equal(manifest.spacingComparisons[1].status, 'unavailable');
  assert.equal(manifest.spacingComparisons[1].before, undefined);
  assert.equal(manifest.uiResult, 'not supplied');
});


test('actual browser geometry is checked before the explicit isolated-preview comparison gate', async () => {
  const source = await readFile(new URL('../tests/e2e/host-brand-identity.spec.ts', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function recordHostSpacing('), source.indexOf('test.beforeEach('));
  const measurement = helper.indexOf('const actual = await hostSpacing(host);');
  const assertion = helper.indexOf('expectCandidateHostSpacing(actual);');
  const gate = helper.indexOf("if (process.env.BECORE_ISOLATED_PREVIEW !== 'true') return;");
  const overlay = helper.indexOf('await page.addStyleTag(');
  assert.ok(measurement >= 0 && assertion > measurement && gate > assertion && overlay > gate);
  assert.doesNotMatch(helper, /catch\s*\(|project\.name|test\.skip|bypassCSP/);
  assert.match(helper, /expectCandidateHostSpacing\(after\);/);
});
