import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function validateIdentity(value) {
  if (value.applicationId !== 'com.becoreops.tickets') throw new Error('The installed application ID must remain com.becoreops.tickets.');
  if (!Number.isSafeInteger(value.versionCode) || value.versionCode < 2 || value.versionCode > 2100000000) throw new Error('Invalid Android versionCode.');
  if (!/^\d+\.\d+\.\d+$/.test(value.versionName)) throw new Error('Use a numeric major.minor.patch versionName.');
  if (!/^[a-f0-9]{64}$/.test(value.certificateSha256)) throw new Error('Pin the permanent signing certificate SHA-256.');
  return value;
}
export function validateSuccessor(current, previous) {
  validateIdentity(current); validateIdentity(previous);
  if (current.certificateSha256 !== previous.certificateSha256) throw new Error('Signing certificate changed: existing installs cannot update.');
  if (current.versionCode <= previous.versionCode) throw new Error('Increase versionCode for every distributed release.');
}
export function parseSigning(raw) {
  let secret;
  try { secret = JSON.parse(raw); } catch { throw new Error('ANDROID_RELEASE_SIGNING must contain the signing backup JSON.'); }
  if (!secret || secret.format !== 1 || typeof secret.keystoreBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret.keystoreBase64)) throw new Error('Invalid signing backup.');
  for (const field of ['storePassword', 'keyPassword', 'keyAlias']) {
    if (typeof secret[field] !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(secret[field])) throw new Error(`Invalid signing field: ${field}.`);
  }
  const bytes = Buffer.from(secret.keystoreBase64, 'base64');
  if (bytes.length < 1024 || bytes.length > 32768 || bytes.toString('base64') !== secret.keystoreBase64) throw new Error('Invalid keystore encoding or size.');
  return { ...secret, bytes };
}
function command(program, args, env = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${program} failed; signing values have been withheld.`);
  return result.stdout;
}
export function verifyApkReport(report, identity, badging) {
  const certs = [...report.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)$/gm)];
  if (certs.length !== 1 || certs[0][1].toLowerCase() !== identity.certificateSha256) throw new Error('APK signer does not match the permanent certificate.');
  const pkg = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
  if (!pkg || pkg[1] !== identity.applicationId || Number(pkg[2]) !== identity.versionCode || pkg[3] !== identity.versionName) throw new Error('APK identity/version does not match release.json.');
  if (/^application-debuggable/m.test(badging)) throw new Error('Debuggable APKs cannot be distributed.');
}

function main() {
  const action = process.argv[2];
  const identity = validateIdentity(JSON.parse(readFileSync(join(mobile, 'android/release.json'), 'utf8')));
  if (action === 'validate') {
    const previous = process.argv[3];
    if (previous) validateSuccessor(identity, JSON.parse(readFileSync(previous, 'utf8')));
    console.log(`Android ${identity.versionName} (${identity.versionCode}): release identity valid.`);
  } else if (action === 'prepare') {
    const destination = process.argv[3];
    if (!destination || !process.env.ANDROID_RELEASE_SIGNING) throw new Error('Permanent signing credentials are not configured. Add ANDROID_RELEASE_SIGNING in repository Actions secrets.');
    const secret = parseSigning(process.env.ANDROID_RELEASE_SIGNING);
    const directory = resolve(destination);
    mkdirSync(directory, { recursive: false, mode: 0o700 });
    const storeFile = join(directory, 'release.p12');
    try {
      writeFileSync(storeFile, secret.bytes, { mode: 0o600, flag: 'wx' });
      const pem = command('keytool', ['-exportcert', '-rfc', '-keystore', storeFile, '-alias', secret.keyAlias, '-storepass:env', 'BECORE_STORE_PASSWORD'], { BECORE_STORE_PASSWORD: secret.storePassword });
      const fingerprint = new X509Certificate(pem).fingerprint256.replaceAll(':', '').toLowerCase();
      if (fingerprint !== identity.certificateSha256) throw new Error('Signing backup does not match the pinned certificate.');
      const path = join(directory, 'signing.json');
      writeFileSync(path, JSON.stringify({ storeFile, storePassword: secret.storePassword, keyPassword: secret.keyPassword, keyAlias: secret.keyAlias }), { mode: 0o600, flag: 'wx' });
      if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `ANDROID_SIGNING_FILE=${path}\n`);
      console.log('Permanent signing certificate verified; release credentials prepared.');
    } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  } else if (action === 'verify') {
    const apk = resolve(process.argv[3]);
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk || !existsSync(apk)) throw new Error('Android SDK and built APK are required.');
    const buildTools = join(sdk, 'build-tools', '36.0.0');
    const report = command(join(buildTools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
    const badging = command(join(buildTools, 'aapt'), ['dump', 'badging', apk]);
    verifyApkReport(report, identity, badging);
    const bundle = resolve(process.argv[4]);
    const bundleVerification = command('jarsigner', ['-verify', bundle]);
    if (!/jar verified\./.test(bundleVerification) || /jar is unsigned|unsigned entries/i.test(bundleVerification)) throw new Error('Android App Bundle signature verification failed.');
    const bundleCertificate = new X509Certificate(command('keytool', ['-printcert', '-rfc', '-jarfile', bundle]));
    if (bundleCertificate.fingerprint256.replaceAll(':', '').toLowerCase() !== identity.certificateSha256) throw new Error('Android App Bundle signer does not match the permanent certificate.');
    const manifest = { ...identity, bundleSha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'), sha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), sourceCommit: process.env.GITHUB_SHA || null };
    writeFileSync(join(dirname(apk), 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Verified non-debuggable signed APK ${identity.versionName} (${identity.versionCode}).`);
  } else throw new Error('Expected validate, prepare or verify.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
