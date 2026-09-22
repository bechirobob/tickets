import { cp, mkdir, rm, symlink, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
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
await build({
  entryPoints: [path.join(root, 'runtime/vps/server.mjs')], outfile: path.join(target, 'server.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external',
  alias: { 'cloudflare:workers': path.join(root, 'runtime/vps/cloudflare-workers.mjs'), 'cloudflare:sockets': path.join(root, 'runtime/vps/cloudflare-sockets.mjs') },
});
const revision = process.env.BECORE_RELEASE_SHA ?? head;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Missing source revision.');
await writeFile(path.join(target, 'release.json'), JSON.stringify({ revision, dirty }));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(target, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: pkg.dependencies }));
console.log('Node application build saved to dist-vps.');
