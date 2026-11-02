import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

// Run from the repository root. These tests use only installed owned packages
// and fixed expectations; they never install or import the removed dependency.
const require = createRequire(path.resolve('package.json'));
const glob = require('@becoreops/tooling-glob');
const createAdapter = require('@becoreops/tooling-glob/adapter-factory.cjs');
const pluginCjs = require('vite-plugin-dynamic-import');
const pluginEsm = await import(pathToFileURL(require.resolve('vite-plugin-dynamic-import/dist/index.mjs')));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tickets-tooling-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  return root;
}

function write(root, relative, text = 'export default 1;\n') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

function link(t, target, filename, type) {
  try {
    fs.symlinkSync(target, filename, type);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'ENOSYS'].includes(error.code)) {
      t.skip('This Windows runner cannot create the required symlink.');
      return false;
    }
    throw error;
  }
}

test('installed packages have the owned identities and pinned provider', () => {
  assert.equal(require('@becoreops/tooling-glob/package.json').name, '@becoreops/tooling-glob');
  assert.equal(require('vite-plugin-dynamic-import/package.json').name, '@becoreops/vite-plugin-dynamic-import');
  assert.equal(require('glob/package.json').version, '14.0.2');
  assert.equal(glob.sync, glob.globSync);
});

test('ordinary extension discovery is ordered, file-only, and excludes hidden files', (t) => {
  const root = fixture(t);
  for (const file of ['modules/a.js', 'modules/b.ts', 'modules/.hidden.ts', 'modules/sub/index.js']) write(root, file);
  fs.mkdirSync(path.join(root, 'modules', 'directory.ts'));
  assert.deepEqual(glob.sync(['./modules/*.{js,ts}', './modules/*/index.js'], { cwd: root }), [
    './modules/a.js', './modules/b.ts', './modules/sub/index.js',
  ]);
  assert.deepEqual(glob.sync('modules/.*.ts', { cwd: root }), ['modules/.hidden.ts']);
});

test('negative directory patterns prune descendants and normalize leading dots', (t) => {
  const root = fixture(t);
  for (const file of ['modules/a.js', 'modules/sub/index.js', 'modules/sub/deep/file.js']) write(root, file);
  assert.deepEqual(glob.sync(['./modules/**/*.js', '!modules/sub/**'], { cwd: root }), ['./modules/a.js']);
  assert.deepEqual(glob.sync(['./modules/**/*.js', '!modules/sub'], { cwd: root }), ['./modules/a.js']);
});

test('explicit pattern priority and duplicate elimination survive per-pattern sorting', (t) => {
  const root = fixture(t);
  write(root, 'modules/a.js');
  write(root, 'modules/b.ts');
  assert.deepEqual(glob.sync(['./modules/b.ts', './modules/a.js', './modules/b.ts'], { cwd: root }), [
    './modules/b.ts', './modules/a.js',
  ]);
});

test('root directories include followed symlinks and their descendants', (t) => {
  const root = fixture(t);
  for (const file of ['packages/a/app/page.js', 'packages/b/pages/index.js', 'outside/app/page.js', 'packages/.hidden/app/page.js']) write(root, file);
  if (!link(t, path.join(root, 'outside'), path.join(root, 'packages', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')) return;
  assert.deepEqual(glob.globSync('packages/*', { cwd: root, onlyDirectories: true }), [
    'packages/a', 'packages/b', 'packages/linked',
  ]);
  assert.deepEqual(glob.globSync('packages/*/', { cwd: root, onlyDirectories: true }), [
    'packages/a', 'packages/b', 'packages/linked',
  ]);
  assert.deepEqual(glob.sync('packages/**/page.js', { cwd: root }), [
    'packages/a/app/page.js', 'packages/linked/app/page.js',
  ]);
});

test('directory-suffix globs never return symlinks to regular files', (t) => {
  const root = fixture(t);
  write(root, 'modules/a.js');
  fs.mkdirSync(path.join(root, 'modules', 'sub'));
  if (!link(t, 'a.js', path.join(root, 'modules', 'linked.ts'), 'file')) return;
  assert.deepEqual(glob.sync('modules/linked.ts', { cwd: root }), ['modules/linked.ts']);
  assert.deepEqual(glob.sync('modules/**/', { cwd: root }), []);
  assert.deepEqual(glob.globSync('modules/**/', { cwd: root, onlyDirectories: true }), ['modules/sub']);
});

test('absolute directory patterns keep absolute path forms', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'packages', 'a'), { recursive: true });
  const prefix = path.join(root, 'packages').split(path.sep).join('/');
  assert.deepEqual(glob.globSync(`${prefix}/*`, { onlyDirectories: true }), [`${prefix}/a`]);
});

// All unsupported-input and finite-boundary assertions use a spy provider.
// They never pass these inputs to glob or any underlying matcher.
const guards = [
  ['unknown option', '*', { dot: true }, false],
  ['invalid cwd', '*', { cwd: 1 }, false],
  ['length boundary', 'a'.repeat(4096), {}, true],
  ['length over boundary', 'a'.repeat(4097), {}, false],
  ['aggregate boundary', Array(16).fill('a'.repeat(4096)), {}, true],
  ['aggregate over boundary', [...Array(16).fill('a'.repeat(4096)), 'a'], {}, false],
  ['count boundary', Array(256).fill('a'), {}, true],
  ['count over boundary', Array(257).fill('a'), {}, false],
  ['nesting boundary', '{'.repeat(16) + 'a' + '}'.repeat(16), {}, true],
  ['nesting over boundary', '{'.repeat(17) + 'a' + '}'.repeat(17), {}, false],
  ['unclosed nesting rejected', '{'.repeat(17), {}, false],
  ['mismatched closing delimiter rejected', '{]'.repeat(17), {}, false],
  ['mixed nesting rejected', '{['.repeat(9), {}, false],
  ['escaped delimiters are not nesting', '\\{'.repeat(17), {}, true],
];
for (const [name, input, options, accepted] of guards) {
  test(`spy-provider guard: ${name}`, () => {
    let calls = 0;
    const guarded = createAdapter(() => { calls++; return []; });
    if (accepted) {
      assert.deepEqual(guarded.sync(input, options), []);
      assert.ok(calls > 0);
    } else {
      assert.throws(() => guarded.sync(input, options));
      assert.equal(calls, 0);
    }
  });
}

const collisions = [
  ['js/ts', ['foo.js', 'foo.ts'], 'foo.js'],
  ['file/index', ['foo.js', 'foo/index.js'], 'foo.js'],
  ['combined', ['foo.js', 'foo.ts', 'foo/index.js'], 'foo.js'],
  ['cjs/mjs/js/ts', ['foo.cjs', 'foo.mjs', 'foo.js', 'foo.ts'], 'foo.cjs'],
  ['mjs/js', ['foo.mjs', 'foo.js'], 'foo.js'],
  ['mjs/ts', ['foo.mjs', 'foo.ts'], 'foo.mjs'],
  ['cjs/index', ['foo.cjs', 'foo/index.js'], 'foo.cjs'],
];
const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.cjs'];
const code = 'export async function load(name) { return (await import(`./modules/${name}`)).default; }';
for (const [entrypoint, implementation] of [['CJS', pluginCjs], ['ESM', pluginEsm]]) {
  for (const loose of [false, true]) {
    for (const [name, files, expected] of collisions) {
      test(`${entrypoint} dynamic import ${loose ? 'loose' : 'strict'} keeps ${name} precedence`, async (t) => {
        const root = fixture(t);
        for (const file of files) {
          write(root, `modules/${file}`, file.endsWith('.cjs')
            ? `module.exports = ${JSON.stringify(file)};\n`
            : `export default ${JSON.stringify(file)};\n`);
        }
        const importer = path.join(root, 'importer.js');
        write(root, 'importer.js', code);
        let discovered;
        const plugin = implementation.default({ loose, onFiles: (matches) => { discovered = [...matches]; } });
        plugin.configResolved({
          root,
          resolve: { extensions, alias: [] },
          createResolver: () => async () => undefined,
          optimizeDeps: { esbuildOptions: { plugins: [] } },
        });
        const transformed = await plugin.transform(code, importer);
        assert.ok(transformed?.code, 'Expected dynamic import transformation');
        assert.deepEqual(discovered, files.map((file) => `./modules/${file}`).sort());
        const output = path.join(root, 'transformed.mjs');
        fs.writeFileSync(output, transformed.code);
        const runtime = await import(pathToFileURL(output));
        assert.equal(await runtime.load('foo'), expected);
      });
    }
  }
}


test('legacy callable and modern minimatch imports share the patched matching behavior', async () => {
  const legacy = require('minimatch');
  const modern = await import('minimatch');
  assert.equal(require('@becoreops/minimatch-engine/package.json').version, '11.0.1');
  for (const match of [legacy, legacy.minimatch, modern.default, modern.minimatch]) {
    for (const [file, pattern, expected] of [
      ['src/a.ts', 'src/*.{js,ts}', true], ['src/a.ts', '**/*.js', false],
      ['src/a.ts', '!**/*.js', true], ['a.ts', '@(a|b).ts', true],
      ['.private', '*', false], ['src/deep/a.ts', 'src/**/*.ts', true],
    ]) assert.equal(match(file, pattern), expected);
  }
  assert.equal(new legacy.Minimatch('*.ts').match('a.ts'), true);
  assert.deepEqual(legacy.match(['a.ts', 'b.js'], '*.ts'), ['a.ts']);
  assert.equal(legacy.defaults({ dot: true })('.private', '*'), true);
  assert.equal(legacy.filter('*.ts')('a.ts'), true);
  assert.equal(legacy.makeRe('*.ts').test('a.ts'), true);
});

test('upgraded glob rejects an already-aborted traversal', async (t) => {
  const root = fixture(t);
  write(root, 'nested/a.ts');
  const reason = new Error('fixture cancellation');
  await assert.rejects(require('glob').glob('**/*', { cwd: root, signal: AbortSignal.abort(reason) }),
    error => error === reason);
});


test('pinned import lint rule preserves forbidden and allowed module matching', async () => {
  const { Linter } = await import('eslint');
  const plugin = require('eslint-plugin-import');
  const lint = (source, options) => new Linter().verify(source, [{
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    plugins: { import: plugin }, rules: { 'import/no-internal-modules': ['error', options] },
  }]);
  assert.equal(lint("import x from 'package/private/file.js';", { forbid: ['package/private/**'] }).length, 1);
  assert.equal(lint("import x from 'package/public/file.js';", { forbid: ['package/private/**'] }).length, 0);
  assert.equal(lint("import x from 'package/public/file.js';", { allow: ['package/public/**'] }).length, 0);
});
