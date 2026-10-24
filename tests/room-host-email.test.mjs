import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import ts from 'typescript';

const helpersSource = await readFile(new URL('../lib/customer-email.ts', import.meta.url), 'utf8');
const source = await readFile(new URL('../lib/room-host-email.ts', import.meta.url), 'utf8');
const helpersModule = { exports: {} };
runInNewContext(transformSync(helpersSource, { loader: 'ts', format: 'cjs' }).code, { URL, module: helpersModule, exports: helpersModule.exports });
const rendererModule = { exports: {} };
runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
  module: rendererModule, exports: rendererModule.exports,
  require(name) {
    assert.equal(name, './customer-email', 'Room email rendering must depend only on the approved local shell.');
    return helpersModule.exports;
  },
});
const { roomHostEmail } = rendererModule.exports;
const fixture = { eventTitle: 'Accra After Hours', hostName: 'The After Hours Team', eventSlug: 'accra-after-hours', messageId: 'preview-host-post-001' };
const actionUrl = 'https://tickets.becoreops.com/room/accra-after-hours?from=host-first-post&message=preview-host-post-001';
const preferencesUrl = 'https://tickets.becoreops.com/room/accra-after-hours?notifications=settings';
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)].map(([, url, label]) => ({ url: url.replaceAll('&amp;', '&'), label }));

test('first-host email preserves the shared approved template and truthful scoped copy', () => {
  const message = roomHostEmail(fixture);
  const announcement = 'The After Hours Team, your host for Accra After Hours, has posted in The Room.';
  assert.deepEqual(Object.keys(message), ['subject', 'html', 'text']);
  assert.equal(message.subject, 'Accra After Hours · Your host has posted');
  assert.equal(message.html, helpersModule.exports.customerEmail({
    title: 'Your host has posted.',
    preheader: announcement,
    body: helpersModule.exports.emailParagraph(`Hi there,<br> ${announcement}`) + helpersModule.exports.emailParagraph('Open The Room to read the message and join the chat.')
      + helpersModule.exports.emailParagraph(`<a href="${preferencesUrl}" style="color:#301d2c;text-decoration:underline;">Manage this event’s notifications</a>.`),
    action: { label: 'Open The Room', url: actionUrl },
    note: 'You’re receiving this because you have a pass for this event.',
  }));
  for (const color of ['#301d2c', '#f8f4ec', '#d6f075']) assert.ok(message.html.includes(color));
  assert.match(message.html, /https:\/\/tickets\.becoreops\.com\/brand\/becore-ticket\.png\?v=5/u);
  assert.match(message.html, /Need a hand\? <a href="mailto:tickets@becoreops\.com"/u);
  assert.doesNotMatch(message.html, /box-shadow|text-shadow|border-radius|<script|<iframe/iu);
  assert.ok(message.text.includes(announcement));
});

test('HTML and plain text carry the same fixed-origin Room action and event-only management link', () => {
  const message = roomHostEmail({ ...fixture, origin: 'https://untrusted.example.invalid', recipient: 'private@example.invalid' });
  const actual = links(message.html);
  assert.deepEqual(actual, [
    { url: preferencesUrl, label: 'Manage this event’s notifications' },
    { url: actionUrl, label: 'Open The Room' },
    { url: 'mailto:tickets@becoreops.com', label: 'tickets@becoreops.com' },
  ]);
  for (const url of [actionUrl, preferencesUrl]) assert.ok(message.text.includes(url));
  assert.doesNotMatch(message.html + message.text, /private@example|untrusted\.example|unsubscribe|marketing|one-click/iu);
});

test('event and public host names are escaped in HTML, literal in text, and normalized in subject', () => {
  const eventTitle = '<img src=x onerror="alert(1)"> & \'night\'';
  const hostName = '<script>alert("x")</script> & Friends';
  const message = roomHostEmail({ ...fixture, eventTitle, hostName });
  assert.doesNotMatch(message.html, /<img src=x|<script>/u);
  assert.match(message.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#039;night&#039;/u);
  assert.match(message.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; Friends/u);
  assert.ok(message.text.includes(eventTitle));
  assert.ok(message.text.includes(hostName));
  const normalized = roomHostEmail({ ...fixture, eventTitle: ' Night\r\nBcc:someone\t\u0000 ', hostName: ' Team\r\nName ' });
  assert.equal(normalized.subject, 'Night Bcc:someone · Your host has posted');
  assert.doesNotMatch(normalized.subject, /[\r\n\u0000]/u);
  assert.ok(normalized.text.includes('Team Name, your host'));
});

test('absent host names use generic wording without exposing identifiers or placeholders', () => {
  for (const hostName of [undefined, null, '', '  \n  ']) {
    const message = roomHostEmail({ ...fixture, hostName });
    assert.ok(message.text.includes('Your host for Accra After Hours has posted in The Room.'));
    assert.doesNotMatch(message.html + message.text, /undefined|null|your host for ,/u);
  }
});

test('opaque message identifiers are URL encoded and never become credentials or markup', () => {
  const messageId = 'post/1?next=https://elsewhere.invalid&token=not-a-token#\"<>é';
  const message = roomHostEmail({ ...fixture, messageId });
  const action = new URL(links(message.html).find(link => link.label === 'Open The Room').url);
  assert.equal(action.origin, 'https://tickets.becoreops.com');
  assert.equal(action.pathname, '/room/accra-after-hours');
  assert.equal(action.searchParams.get('message'), messageId);
  assert.equal(action.searchParams.get('from'), 'host-first-post');
  assert.deepEqual([...action.searchParams.keys()], ['from', 'message']);
  assert.equal(action.hash, '');
  assert.ok(message.text.includes(`${actionUrl.split('&message=')[0]}&message=${encodeURIComponent(messageId)}`));
  assert.doesNotMatch(message.html, /href="https:\/\/elsewhere|<script/u);
});

test('invalid routing inputs fail closed rather than generating misleading or off-site links', () => {
  for (const eventSlug of ['', '.', '..', '../private', 'https://elsewhere.invalid', 'room?token=x', 'a/b', 'two words', 'a'.repeat(81)]) {
    assert.throws(() => roomHostEmail({ ...fixture, eventSlug }), /event slug is invalid/u, eventSlug);
  }
  for (const messageId of ['', '   ', 'a'.repeat(201), 'line\nfeed', '\u0000']) {
    assert.throws(() => roomHostEmail({ ...fixture, messageId }), /message ID is invalid/u);
  }
  for (const eventTitle of ['', ' \r\n\t\u0000 ']) assert.throws(() => roomHostEmail({ ...fixture, eventTitle }), /event title is required/u);
});

test('renderer accepts metadata only, makes no network calls and never includes supplied private chat text', () => {
  const message = roomHostEmail({ ...fixture, chatBody: 'PRIVATE CHAT TEXT', token: 'PRIVATE ACCESS TOKEN', email: 'private@example.invalid' });
  assert.doesNotMatch(message.html + message.text, /PRIVATE CHAT TEXT|PRIVATE ACCESS TOKEN|private@example/u);
  assert.doesNotMatch(source, /\b(?:fetch|crypto|process|env|DB)\b/u);
});

test('email renderer and approved shell typecheck without server or provider dependencies', () => {
  const program = ts.createProgram([fileURLToPath(new URL('../lib/room-host-email.ts', import.meta.url))], {
    noEmit: true, strict: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  });
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
});


test('hosted first-host preview uses exact production HTML with no recipients or outbound delivery', async () => {
  const { renderFirstHostEmailPreview } = await import('../scripts/customer-email-previews.mjs');
  const preview = renderFirstHostEmailPreview();
  assert.equal(preview.html, roomHostEmail(fixture).html);
  assert.equal(preview.text, roomHostEmail(fixture).text);
  assert.equal(preview.subject, roomHostEmail(fixture).subject);
  assert.equal(preview.name, 'first-host-post');
  assert.equal(preview.recipient, undefined);
});
