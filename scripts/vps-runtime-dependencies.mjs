import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const runtimeRoots = ['ipaddr.js', 'react', 'react-dom', 'sharp', 'web-push-neo', 'ws'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyPlatform(platform = process.platform, arch = process.arch, glibc = process.report.getReport().header.glibcVersionRuntime) {
  assert.equal(platform, 'linux', 'VPS artifacts require Linux');
  assert.equal(arch, 'x64', 'VPS artifacts require x64');
  assert.ok(glibc, 'VPS artifacts require glibc');
  return { platform, arch, libc: 'glibc', glibc };
}
export function externalPackage(specifier) {
  if (isBuiltin(specifier)) return null;
  assert.ok(!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':'), `Unexpected external: ${specifier}`);
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}
export async function runtimeInputs(root, externalSpecifiers) {
  const manifestBytes = await fs.readFile(path.join(root, 'runtime/vps/package.json'));
  const lockBytes = await fs.readFile(path.join(root, 'package-lock.json'));
  const manifest = JSON.parse(manifestBytes), lock = JSON.parse(lockBytes);
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), runtimeRoots, 'Runtime root allowlist changed');
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.scripts, undefined, 'Runtime install hooks are forbidden');
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    assert.equal(version, lock.packages[`node_modules/${name}`]?.version, `${name} must match the audited root lock exactly`);
  }
  if (externalSpecifiers) {
    const actual = [...new Set(externalSpecifiers.map(externalPackage).filter(Boolean))].sort();
    assert.deepEqual(actual, runtimeRoots, 'Built external roots differ from the reviewed runtime roots');
  }
  return { manifest, manifestBytes, lock, lockHash: digest(lockBytes), manifestHash: digest(manifestBytes) };
}
export async function runtimeClosure(root, inputs) {
  const modules = path.join(root, 'node_modules'), selected = new Map();
  async function visit(name, from, optional = false) {
    let source;
    for (const lookup of createRequire(path.join(from, 'package.json')).resolve.paths(name) ?? []) {
      const candidate = path.join(lookup, name);
      if (!candidate.startsWith(modules + path.sep)) continue;
      try { await fs.access(path.join(candidate, 'package.json')); source = candidate; break; }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    }
    if (!source) { assert.ok(optional, `Missing required runtime package ${name}`); return; }
    const real = await fs.realpath(source), rel = path.relative(root, real).split(path.sep).join('/');
    assert.ok(real.startsWith(modules + path.sep), `Runtime dependency escapes installed tree: ${name}`);
    assert.equal(real, source, `Linked runtime package is unsupported: ${name}`);
    if (selected.has(rel)) return;
    const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'))), pinned = inputs.lock.packages[rel];
    assert.ok(pinned && !pinned.link, `Runtime package is absent from root lock: ${rel}`);
    assert.equal(pkg.name, name, `Runtime package identity mismatch: ${rel}`);
    assert.equal(pkg.version, pinned.version, `Runtime package version mismatch: ${rel}`);
    const url = new URL(pinned.resolved);
    assert.equal(url.origin, 'https://registry.npmjs.org');
    assert.ok(!url.username && !url.password && !url.search && !url.hash);
    assert.match(pinned.integrity, /^sha512-[A-Za-z0-9+/=]+$/);
    assert.ok(!(pkg.bundledDependencies?.length || pkg.bundleDependencies?.length), 'Bundled runtime packages need separate review');
    selected.set(rel, { source, rel, name, version: pkg.version, integrity: pinned.integrity });
    for (const dep of Object.keys(pkg.dependencies ?? {})) await visit(dep, source, Object.hasOwn(pkg.optionalDependencies ?? {}, dep));
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) await visit(dep, source, true);
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) await visit(dep, source, pkg.peerDependenciesMeta?.[dep]?.optional === true);
  }
  for (const name of runtimeRoots) await visit(name, root);
  for (const native of ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']) {
    assert.ok([...selected.values()].some(p => p.name === native), `Missing required Linux x64 native image package ${native}`);
  }
  return [...selected.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}
export async function copyRuntimeClosure(packages, target, verify = async () => {}) {
  const modules = path.join(target, 'node_modules');
  try { await fs.mkdir(modules); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Refuse a pre-existing runtime dependency tree', { cause: error });
    throw error;
  }
  try {
    for (const pkg of packages) {
      const destination = path.join(target, pkg.rel);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(pkg.source, destination, { recursive: true, verbatimSymlinks: true,
        filter: source => source === pkg.source || path.basename(source) !== 'node_modules' });
    }
    async function checkLinks(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await checkLinks(filename);
        else if (entry.isSymbolicLink()) {
          const link = await fs.readlink(filename);
          assert.ok(!path.isAbsolute(link), `Absolute runtime symlink: ${filename}`);
          assert.ok((await fs.realpath(filename)).startsWith(path.join(target, 'node_modules') + path.sep), `Runtime symlink escapes package closure: ${filename}`);
        }
      }
    }
    await checkLinks(modules);
    await verify();
  } catch (error) {
    // Only the directory exclusively created by this invocation is removed.
    await fs.rm(modules, { recursive: true, force: true });
    throw error;
  }
}

export function runRuntimeCheck(executable, args, options) {
  const result = spawnSync(executable, args, { ...options, detached: true, killSignal: 'SIGKILL' });
  // A timed-out verifier may have spawned a server. Its entire owned process
  // group must stop before temporary files are removed or a retry starts.
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return result;
}
