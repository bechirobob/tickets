# Android release identity

`release.json` owns the permanent application ID, public signing certificate fingerprint and Android version. Its private key is never in this repository. The encrypted PKCS#12 key, passwords and alias are backed up in the owner's signing setup archive; restore the same backup, never generate a replacement when a runner is lost.

## One-time activation

1. In repository **Settings → Secrets and variables → Actions → New repository secret**, name the secret `ANDROID_RELEASE_SIGNING`.
2. Paste the complete JSON from `BeCore-Tickets-Android-signing-secret.json` in the private signing setup archive. Save it. Do not add it as a repository file or variable.
3. Run **Actions → Android release → Run workflow**, with `main` selected. The release job validates the backed-up certificate before building. Missing or mismatched credentials stop the job; there is no debug fallback.

Alternatively, the archive's `activate.sh` uses an authenticated GitHub CLI to upload that one secret and dispatch the workflow. The archive is the recovery backup and must remain private. Repository secrets cannot be downloaded for backup.

## Every release

Increment `versionCode` and `versionName` in `release.json`; update release notes. Keep the app ID and certificate unchanged. PR checks compile/lint the non-debuggable release configuration without secrets and label its artifact **unsigned validation**, not an installable release. Development builds use `.dev` so they cannot overwrite the customer app.

The manual release workflow runs only on `main`, independently runs client/security/browser checks, builds signed APK/AAB, verifies APK signature, application ID, version and non-debuggable flag, and publishes a permanent GitHub Release tied to the exact commit. It rejects a previously published tag and a version code no newer than the previous release. Temporary signing files are removed even after a failure. Private signing credentials are never supplied to pull-request jobs.

For local builds, supply the same backup as `ANDROID_RELEASE_SIGNING`, run `node mobile/scripts/android-release.mjs prepare /private/new-directory`, then set `ANDROID_SIGNING_FILE=/private/new-directory/signing.json` for Gradle. Do not echo the secret. Use Java 21 and Android SDK/build-tools 36.0.0. `-PunsignedReleaseCheck` is for CI compilation only and cannot be combined with signing credentials.

## Update acceptance and recovery

The initial debug APK 0.1.0 has a different certificate. It requires a one-time uninstall before the first permanent release; do not promise data preservation across that uninstall. All permanent releases must keep this certificate. On a physical Android device, install the first signed release, browse and save state, then install a newer signed APK over it using Android's **Update** action. Confirm no uninstall, retained state, correct new version, opening/resuming/sharing, and payment browser return. Record device model, OS and both manifest hashes. Compilation/signature tests are not a substitute for this device check.

Never lower versionCode for rollback. Restore the previous working source and distribute it with a higher versionCode. Keep prior release artifacts and manifests. If GitHub credentials are reset, restore this same key backup as the repository secret. If the signing key is compromised or lost, stop distribution and assess Android's supported key rotation/recovery; never silently generate another identity.

Before enrolling Play App Signing, deliberately retain update compatibility with this signing key (supply the existing app-signing key through Google's supported enrollment flow), and establish a separate upload key. Do not let an unrelated Play signing identity invalidate direct APK updates. No Play enrollment is claimed here. Apple signing remains a separate dependency.

References: [Android signing](https://developer.android.com/studio/publish/app-signing), [versioning](https://developer.android.com/studio/publish/versioning), [APK verification](https://developer.android.com/tools/apksigner).
