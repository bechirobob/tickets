import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyRuntimeClosure, externalPackage, runtimeClosure, runtimeInputs, runtimeRoots, runRuntimeCheck, verifyPlatform } from '../scripts/vps-runtime-dependencies.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tickets-package-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = { private: true, type: 'module', dependencies: Object.fromEntries(runtimeRoots.map(name => [name, '1.0.0'])) };
  const lock = { packages: {} };
  const specs = Object.fromEntries(runtimeRoots.map(name => [name, {}]));
  specs.sharp = { dependencies: { child: '1.0.0' }, optionalDependencies: { '@img/sharp-linux-x64': '1.0.0', '@img/sharp-libvips-linux-x64': '1.0.0', missingOptional: '1.0.0' } };
  specs.react = { peerDependencies: { peer: '1.0.0', missingOptionalPeer: '1.0.0' }, peerDependenciesMeta: { missingOptionalPeer: { optional: true } } };
  for (const name of ['child', 'peer', '@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']) specs[name] = {};
  for (const [name, extra] of Object.entries(specs)) {
    const rel = `node_modules/${name}`, dir = path.join(root, rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...extra }));
    await fs.writeFile(path.join(dir, 'index.js'), 'module.exports = 1;\n');
    lock.packages[rel] = { version: '1.0.0', resolved: `https://registry.npmjs.org/${name}/-/fixture.tgz`, integrity: 'sha512-YQ==' };
  }
  await fs.mkdir(path.join(root, 'runtime/vps'), { recursive: true });
  await fs.writeFile(path.join(root, 'runtime/vps/package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  return { root, lock, manifest, saveLock: () => fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock)) };
}

test('runtime platform fails closed for non-production native targets', () => {
  assert.deepEqual(verifyPlatform('linux', 'x64', '2.39'), { platform: 'linux', arch: 'x64', libc: 'glibc', glibc: '2.39' });
  assert.throws(() => verifyPlatform('darwin', 'x64', '2.39'));
  assert.throws(() => verifyPlatform('linux', 'arm64', '2.39'));
  assert.throws(() => verifyPlatform('linux', 'x64', ''));
});
test('external package names distinguish builtins and reject filesystem/URL escapes', () => {
  assert.equal(externalPackage('node:fs'), null); assert.equal(externalPackage('fs'), null);
  assert.equal(externalPackage('react/jsx-runtime'), 'react'); assert.equal(externalPackage('@img/colour/foo'), '@img/colour');
  for (const specifier of ['./evil', '/tmp/evil', 'https://example.com/evil']) assert.throws(() => externalPackage(specifier));
});
test('runtime manifest matches the root lock and all emitted externals exactly', async t => {
  const f = await fixture(t);
  await runtimeInputs(f.root, [...runtimeRoots, 'node:fs', 'react/jsx-runtime']);
  await assert.rejects(runtimeInputs(f.root, [...runtimeRoots, 'vite']));
  f.lock.packages['node_modules/react'].version = '2.0.0'; await f.saveLock();
  await assert.rejects(runtimeInputs(f.root), /audited root lock/);
});
test('copies only selected dependencies/peers, preserving paths, bytes and relative links', async t => {
  const f = await fixture(t), target = path.join(f.root, 'artifact'); await fs.mkdir(target);
  const extra = path.join(f.root, 'node_modules/react/node_modules/unrelated'); await fs.mkdir(extra, { recursive: true });
  await fs.writeFile(path.join(extra, 'package.json'), '{}');
  await fs.symlink('index.js', path.join(f.root, 'node_modules/react/link.js'));
  const packages = await runtimeClosure(f.root, await runtimeInputs(f.root));
  assert.equal(packages.length, 10);
  await copyRuntimeClosure(packages, target);
  assert.equal(await fs.readlink(path.join(target, 'node_modules/react/link.js')), 'index.js');
  assert.equal(await fs.readFile(path.join(target, 'node_modules/react/index.js'), 'utf8'), 'module.exports = 1;\n');
  await assert.rejects(fs.access(path.join(target, 'node_modules/react/node_modules/unrelated')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(target, 'node_modules/.package-lock.json')), { code: 'ENOENT' });
  await assert.rejects(copyRuntimeClosure(packages, target), /pre-existing/);
});
test('rejects missing mandatory dependencies and peers', async t => {
  const f = await fixture(t); await fs.rename(path.join(f.root, 'node_modules/peer'), path.join(f.root, 'saved-peer'));
  await assert.rejects(runtimeClosure(f.root, await runtimeInputs(f.root)), /Missing required.*peer/);
});
test('rejects tampered versions and non-registry dependency origins', async t => {
  const f = await fixture(t); f.lock.packages['node_modules/child'].resolved = 'https://example.com/child.tgz'; await f.saveLock();
  await assert.rejects(runtimeClosure(f.root, await runtimeInputs(f.root)));
  f.lock.packages['node_modules/child'].resolved = 'https://registry.npmjs.org/child/-/child.tgz'; await f.saveLock();
  await fs.writeFile(path.join(f.root, 'node_modules/child/package.json'), JSON.stringify({ name: 'child', version: '2.0.0' }));
  await assert.rejects(runtimeClosure(f.root, await runtimeInputs(f.root)), /version mismatch/);
});
test('rejects absent platform-native Sharp packages', async t => {
  const f = await fixture(t); await fs.rename(path.join(f.root, 'node_modules/@img/sharp-linux-x64'), path.join(f.root, 'saved-native'));
  await assert.rejects(runtimeClosure(f.root, await runtimeInputs(f.root)), /Missing required Linux x64/);
});
test('rejects escaping package symlinks', async t => {
  const f = await fixture(t), target = path.join(f.root, 'artifact'); await fs.mkdir(target);
  await fs.symlink('/etc/hosts', path.join(f.root, 'node_modules/react/escape'));
  await assert.rejects(copyRuntimeClosure(await runtimeClosure(f.root, await runtimeInputs(f.root)), target), /Absolute runtime symlink/);
});
test('workflow keeps full audit gates and verifies isolated runtime without pruning source dependencies', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/vps-runtime.yml', import.meta.url), 'utf8');
  assert.match(workflow, /tickets-approved-audit\.py" --phase preinstall/);
  assert.match(workflow, /tickets-approved-audit\.py" --phase postinstall/);
  assert.match(workflow, /node scripts\/prepare-vps-runtime\.mjs/);
  assert.doesNotMatch(workflow, /npm prune|cp -a node_modules dist-vps/);
  const verifier = await fs.readFile(new URL('../scripts/verify-vps-runtime.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /TICKETS_VERIFY_DISTRIBUTION/);
  assert.match(verifier, /spawn\(path\.join\(distribution, 'bin\/node'\)/);
  assert.match(verifier, /NODE_PATH.*NODE_OPTIONS/);
});

test('failed copy and failed isolated verification roll back only the owned tree, permitting retry', async t => {
  const f = await fixture(t), target = path.join(f.root, 'artifact'); await fs.mkdir(target);
  const packages = await runtimeClosure(f.root, await runtimeInputs(f.root));
  await fs.symlink('/etc/hosts', path.join(f.root, 'node_modules/react/invalid-link'));
  await assert.rejects(copyRuntimeClosure(packages, target), /Absolute runtime symlink/);
  await assert.rejects(fs.access(path.join(target, 'node_modules')), { code: 'ENOENT' });
  await fs.unlink(path.join(f.root, 'node_modules/react/invalid-link'));
  await assert.rejects(copyRuntimeClosure(packages, target, async () => { throw new Error('isolated verifier failed'); }), /isolated verifier failed/);
  await assert.rejects(fs.access(path.join(target, 'node_modules')), { code: 'ENOENT' });
  await copyRuntimeClosure(packages, target);
  const before = await fs.readFile(path.join(target, 'node_modules/react/package.json'));
  await assert.rejects(copyRuntimeClosure(packages, target), /pre-existing/);
  assert.deepEqual(await fs.readFile(path.join(target, 'node_modules/react/package.json')), before);
});
test('nested required dependencies preserve nearest resolution and distinct versions', async t => {
  const f = await fixture(t), relative = 'node_modules/sharp/node_modules/child', dir = path.join(f.root, relative);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'child', version: '2.0.0' }));
  await fs.writeFile(path.join(dir, 'index.js'), 'module.exports = 2;');
  f.lock.packages[relative] = { ...f.lock.packages['node_modules/child'], version: '2.0.0' };
  const wsFile = path.join(f.root, 'node_modules/ws/package.json');
  const ws = JSON.parse(await fs.readFile(wsFile)); ws.dependencies = { child: '1.0.0' }; await fs.writeFile(wsFile, JSON.stringify(ws));
  await f.saveLock();
  const packages = await runtimeClosure(f.root, await runtimeInputs(f.root));
  assert.equal(packages.find(p => p.rel === relative).version, '2.0.0');
  assert.equal(packages.find(p => p.rel === 'node_modules/child').version, '1.0.0');
  const target = path.join(f.root, 'artifact'); await fs.mkdir(target); await copyRuntimeClosure(packages, target);
  assert.equal(JSON.parse(await fs.readFile(path.join(target, relative, 'package.json'))).version, '2.0.0');
});

test('a timed-out verifier cannot leave its child server running', { skip: process.platform !== 'linux' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tickets-process-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'child.pid');
  const childCode = 'setInterval(() => {}, 1000)';
  const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));setInterval(()=>{},1000);`;
  const result = runRuntimeCheck(process.execPath, ['-e', code], { timeout: 500, stdio: 'ignore' });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  const pid = Number(await fs.readFile(marker, 'utf8'));
  let stopped = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { stopped = (await fs.readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1].startsWith('Z'); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') stopped = true; else throw error; }
    if (stopped) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(stopped, 'verifier child survived timeout cleanup');
});
