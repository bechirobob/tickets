import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only named, bounded screenshots from local migration-seeded public pages. */
export async function packageHostBrandPreviews({ root, output, sourceSha, sourceTree, runId }) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.match(sourceTree, /^[a-f0-9]{40}$/u);
  const resolvedRoot = await realpath(root);
  const entries = await readdir(root, { recursive: true });
  const files = [];
  for (const [browser, width] of [['desktop-chromium', 1280], ['mobile-chromium', 390]]) {
    for (const [view, filename, captureWidth] of [['directory', 'yorke-directory.png', width], ['profile', 'yorke-profile.png', width], ['event', 'yorke-event.png', width], ['event-host', 'yorke-event-host.png', width], ...(browser === 'mobile-chromium' ? [['profile-narrow', 'yorke-profile-narrow.png', 320], ['event-host-narrow', 'yorke-event-host-narrow.png', 320]] : [])]) {
      const matches = entries.filter(entry => path.basename(entry) === filename && path.basename(path.dirname(entry)).endsWith(`-${browser}`));
      assert.equal(matches.length, 1, `Expected exactly one ${view} screenshot for ${browser}`);
      const source = path.join(root, matches[0]);
      assert.equal((await lstat(source)).isSymbolicLink(), false);
      assert.ok((await realpath(source)).startsWith(resolvedRoot + path.sep), 'Screenshot must stay inside fixture output');
      const bytes = await readFile(source);
      assert.ok(bytes.length >= 33 && bytes.length <= 2 * 1024 * 1024, 'Screenshot size is out of bounds');
      assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Expected a PNG screenshot');
      assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
      const imageWidth = bytes.readUInt32BE(16), imageHeight = bytes.readUInt32BE(20);
      assert.ok(imageWidth > 0 && imageWidth <= captureWidth && imageHeight > 0 && imageWidth * imageHeight <= 16_000_000);
      if (!view.startsWith('event-host')) assert.equal(imageWidth, captureWidth, 'Page screenshot must match requested viewport');
      files.push({ file: `${view}-${browser}.png`, browser, view, viewport: { width: captureWidth, height: 900 }, image: { width: imageWidth, height: imageHeight }, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes });
    }
  }
  const spacingComparisons = [];
  const metricKeys = ['hostHeight', 'brandToName', 'nameToMeta', 'metaToLink', 'linkHeight', 'paddingTop', 'paddingBottom', 'nameFontSize', 'nameLineHeight', 'brandFontSize', 'metaFontSize', 'portraitWidth', 'portraitHeight', 'sealWidth'];
  for (const [browser, width, filename] of [['desktop-chromium', 1280, 'yorke-host-spacing.json'], ['mobile-chromium', 390, 'yorke-host-spacing.json'], ['mobile-chromium', 320, 'yorke-host-spacing-narrow.json']]) {
    const matches = entries.filter(entry => path.basename(entry) === filename && path.basename(path.dirname(entry)).endsWith(`-${browser}`));
    assert.equal(matches.length, 1, 'Expected exactly one bounded spacing comparison');
    const source = path.join(root, matches[0]);
    assert.equal((await lstat(source)).isSymbolicLink(), false);
    assert.ok((await realpath(source)).startsWith(resolvedRoot + path.sep));
    const bytes = await readFile(source);
    assert.ok(bytes.length > 0 && bytes.length <= 8192);
    const data = JSON.parse(bytes.toString('utf8'));
    assert.equal(data.sourceSha, sourceSha);
    assert.equal(data.baselineSourceSha, '7013070856ed3dc9cfb81693b5c70df19005c0e9');
    assert.equal(data.viewport.width, width);
    assert.equal(data.viewport.height, 900);
    const metrics = value => Object.fromEntries(metricKeys.map(key => {
      assert.ok(typeof value?.[key] === 'number' && Number.isFinite(value[key]) && value[key] >= -1 && value[key] <= 20000);
      return [key, value[key]];
    }));
    const before = metrics(data.before), after = metrics(data.after);
    assert.ok(after.linkHeight >= 44 && after.hostHeight < before.hostHeight - 30);
    for (const key of ['nameFontSize', 'brandFontSize', 'metaFontSize', 'portraitWidth', 'portraitHeight', 'sealWidth']) assert.equal(after[key], before[key]);
    spacingComparisons.push({ browser, viewport: { width, height: 900 }, baselineSourceSha: data.baselineSourceSha, method: 'Same candidate DOM; exact prior spacing declarations applied temporarily, then removed before candidate screenshots.', before, after, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await mkdir(output, { recursive: false });
  for (const file of files) await writeFile(path.join(output, file.file), file.content, { flag: 'wx' });
  const manifest = { sourceSha, sourceTree, runId, environment: 'isolated candidate', spacingComparisons, data: 'Local database seeded with the repository migrations, including the approved host brand migration. Not live production.', files: files.map(file => ({ file: file.file, browser: file.browser, view: file.view, viewport: file.viewport, image: file.image, bytes: file.bytes, sha256: file.sha256 })) };
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.env.BECORE_ISOLATED_PREVIEW, 'true');
  assert.ok(!process.env.E2E_BASE_URL, 'Never package production captures as fixture evidence');
  const sourceSha = process.env.BECORE_RELEASE_SHA;
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceSha);
  assert.equal(JSON.parse(await readFile('dist/server/wrangler.json', 'utf8')).vars.RELEASE_SHA, sourceSha);
  await mkdir('outputs', { recursive: true });
  await packageHostBrandPreviews({ root: 'test-results/host-brand', output: 'outputs/host-brand-previews', sourceSha, sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), runId: process.env.GITHUB_RUN_ID });
}
