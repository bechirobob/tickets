import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Build tooling runs directly as JavaScript.
import { validateIdentity, validateSuccessor, parseSigning, verifyApkReport } from '../scripts/android-release.mjs';
const identity = { applicationId: 'com.becoreops.tickets', versionCode: 2, versionName: '0.1.1', certificateSha256: 'a'.repeat(64) };
test('release identity prevents app replacement, invalid versions and certificate placeholders', () => {
  assert.deepEqual(validateIdentity(identity), identity);
  for (const changes of [{ applicationId: 'com.other.app' }, { versionCode: 1 }, { versionCode: 2100000001 }, { versionCode: 2.5 }, { versionName: 'latest' }, { certificateSha256: '' }]) assert.throws(() => validateIdentity({ ...identity, ...changes }));
});
test('subsequent releases preserve signer and always increase version code', () => {
  assert.doesNotThrow(() => validateSuccessor({ ...identity, versionCode: 3 }, identity));
  assert.throws(() => validateSuccessor(identity, identity));
  assert.throws(() => validateSuccessor({ ...identity, versionCode: 3, certificateSha256: 'b'.repeat(64) }, identity));
});
test('missing or malformed secrets fail without echoing credentials', () => {
  for (const raw of ['', '{', 'null', '{}', JSON.stringify({ format: 1, keystoreBase64: 'secret-not-a-key' })]) assert.throws(() => parseSigning(raw), error => !String(error).includes('secret-not-a-key'));
});
test('artifact gate rejects debug builds, changed signer, wrong package and stale versions', () => {
  const report = `Signer #1 certificate SHA-256 digest: ${identity.certificateSha256}\n`;
  const badging = "package: name='com.becoreops.tickets' versionCode='2' versionName='0.1.1'\n";
  assert.doesNotThrow(() => verifyApkReport(report, identity, badging));
  assert.throws(() => verifyApkReport(report.replaceAll('a', 'b'), identity, badging));
  assert.throws(() => verifyApkReport(report, identity, badging + 'application-debuggable\n'));
  assert.throws(() => verifyApkReport(report, identity, badging.replace("versionCode='2'", "versionCode='1'")));
  assert.throws(() => verifyApkReport(report, identity, badging.replace('com.becoreops.tickets', 'com.other.app')));
});
