import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../app/support-email.tsx', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs' });
const componentModule = { exports: {} };
runInNewContext(compiled.code, { module: componentModule, exports: componentModule.exports, require: createRequire(import.meta.url) });
const { default: SupportEmail, SUPPORT_EMAIL } = componentModule.exports;

test('support email SSR emits the documented comments around the fixed public address', () => {
  assert.equal(SUPPORT_EMAIL, 'tickets@becoreops.com');
  assert.equal(renderToStaticMarkup(createElement(SupportEmail)), '<span><!--email_off-->tickets@becoreops.com<!--/email_off--></span>');
});

test('support email SSR protects the entire fixed mailto anchor and accepts no arbitrary content', () => {
  const rendered = renderToStaticMarkup(createElement(SupportEmail, { linked: true, html: '<script>unexpected</script>' }, 'another@example.invalid'));
  assert.equal(rendered, '<span><!--email_off--><a href="mailto:tickets@becoreops.com">tickets@becoreops.com</a><!--/email_off--></span>');
});

test('Help protects its plain-text recovery address and contact link; Terms shares the same component', async () => {
  const [help, terms] = await Promise.all([
    readFile(new URL('../app/help/help-centre.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/terms/page.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(help, /step\.split\(SUPPORT_EMAIL\)/u);
  assert.match(help, /<SupportEmail \/>/u);
  assert.match(help, /<SupportEmail linked \/>/u);
  assert.match(terms, /<SupportEmail linked \/>/u);
  assert.doesNotMatch(help + terms, /href="mailto:tickets@becoreops\.com"/u);
});
