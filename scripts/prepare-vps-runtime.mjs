import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyRuntimeClosure, digest, runtimeClosure, runtimeInputs, runRuntimeCheck, verifyPlatform } from './vps-runtime-dependencies.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'dist-vps');
const platform = verifyPlatform();
const inputs = await runtimeInputs(root);
const release = JSON.parse(await fs.readFile(path.join(target, 'release.json'), 'utf8'));
assert.deepEqual(release.platform, platform, 'Runtime build platform changed');
assert.equal(release.node, process.version, 'Runtime build Node changed');
assert.equal(release.rootLockSha256, inputs.lockHash, 'Audited source lock changed after build');
assert.equal(release.runtimeManifestSha256, inputs.manifestHash, 'Runtime roots changed after build');
assert.equal(digest(await fs.readFile(path.join(target, 'package.json'))), inputs.manifestHash);
assert.equal(digest(await fs.readFile(path.join(target, 'bin/node'))), release.nodeSha256, 'Packaged Node changed');
const packages = await runtimeClosure(root, inputs);
await copyRuntimeClosure(packages, target, async () => {
  // Smoke-test outside the checkout: Node must not fall back to build dependencies.
  const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'tickets-packaged-runtime-'));
  const { NODE_PATH: nodePath, NODE_OPTIONS: nodeOptions, ...environment } = process.env;
  void nodePath; void nodeOptions;
  try {
    await fs.cp(target, isolated, { recursive: true, verbatimSymlinks: true });
    const node = path.join(isolated, 'bin/node');
    const image = runRuntimeCheck(node, ['--input-type=module', '-e', "import sharp from 'sharp'; const image = await sharp({create:{width:2,height:2,channels:3,background:'white'}}).resize(1,1).webp().toBuffer(); if (!image.length) process.exit(1);"], { cwd: isolated, env: environment, stdio: 'inherit', timeout: 30000 });
    assert.equal(image.status, 0, 'Packaged native image processing failed');
    const verified = runRuntimeCheck(node, [path.join(root, 'scripts/verify-vps-runtime.mjs')], { cwd: root, env: { ...environment, TICKETS_VERIFY_DISTRIBUTION: isolated, TICKETS_VERIFY_TEMP_ROOT: isolated }, stdio: 'inherit', timeout: 120000 });
    assert.equal(verified.status, 0, 'Isolated packaged runtime verification failed');
  } finally {
    await fs.rm(isolated, { recursive: true, force: true });
  }
});
console.log(`Verified ${packages.length} runtime packages from the audited root installation; build dependencies were not copied.`);
