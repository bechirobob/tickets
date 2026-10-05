import { cp, mkdir, rm, symlink, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { digest, runtimeInputs, verifyPlatform } from './vps-runtime-dependencies.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const platform = verifyPlatform();
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const dirty = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim());
if (process.env.CI && (dirty || process.env.BECORE_RELEASE_SHA !== head)) throw new Error('Deployment build requires a clean checkout of the exact release commit.');
const stage = path.join(root, '.vps-build');
await rm(stage, { recursive: true, force: true });
await mkdir(stage);
// Explicit source allowlist: no secrets, local DBs, logs or Cloudflare config.
for (const item of ['app', 'lib', 'db', 'public', 'styles', 'worker', 'runtime', 'package.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts', 'postcss.config.mjs', 'cloudflare-env.d.ts']) {
  try { await cp(path.join(root, item), path.join(stage, item), { recursive: true }); }
  catch (error) { if (item !== 'next-env.d.ts' || error.code !== 'ENOENT') throw error; }
}
await cp(path.join(root, 'vite.vps.config.ts'), path.join(stage, 'vite.config.ts'));
await symlink(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vinext/dist/cli.js'), 'build'], { cwd: stage, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const target = path.join(root, 'dist-vps');
await rm(target, { recursive: true, force: true });
await cp(path.join(stage, 'dist'), target, { recursive: true });
const bundled = await build({
  entryPoints: [path.join(root, 'runtime/vps/server.mjs')], outfile: path.join(target, 'server.mjs'),
  bundle: true, metafile: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external',
  alias: { 'vinext/server/prod-server': fileURLToPath(import.meta.resolve('vinext/server/prod-server')), 'cloudflare:workers': path.join(root, 'runtime/vps/cloudflare-workers.mjs'), 'cloudflare:sockets': path.join(root, 'runtime/vps/cloudflare-sockets.mjs') },
});
const revision = process.env.BECORE_RELEASE_SHA ?? head;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Missing source revision.');
await mkdir(path.join(target, 'bin'));
await cp(process.execPath, path.join(target, 'bin/node'));
const appExternals = JSON.parse(await readFile(path.join(target, 'server/vinext-externals.json'), 'utf8'));
const wrapperExternals = Object.values(bundled.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path));
const runtime = await runtimeInputs(root, [...appExternals, ...wrapperExternals]);
await writeFile(path.join(target, 'package.json'), runtime.manifestBytes);
await writeFile(path.join(target, 'release.json'), JSON.stringify({ revision, dirty, node: process.version, platform, rootLockSha256: runtime.lockHash, runtimeManifestSha256: runtime.manifestHash, nodeSha256: digest(await readFile(process.execPath)) }));
console.log('Node application build saved to dist-vps.');

