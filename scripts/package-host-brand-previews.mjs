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
  await mkdir(output, { recursive: false });
  for (const file of files) await writeFile(path.join(output, file.file), file.content, { flag: 'wx' });
  const manifest = { sourceSha, sourceTree, runId, environment: 'isolated candidate', data: 'Local database seeded with the repository migrations, including the approved host brand migration. Not live production.', files: files.map(file => ({ file: file.file, browser: file.browser, view: file.view, viewport: file.viewport, image: file.image, bytes: file.bytes, sha256: file.sha256 })) };
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
