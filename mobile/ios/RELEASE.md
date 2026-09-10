# iPhone release

Bundle ID: `com.becoreops.tickets`. The company enrolling with Apple owns this
identifier; the reverse-domain spelling does not determine the legal seller name.
The app targets iPhone on iOS 15 and later. `release.json` is the release ledger;
`release.xcconfig` is its checked Xcode configuration. Increase the build number
for every new TestFlight upload. Never reuse a published build number.

## Builds available before enrollment

The Native app builds workflow builds **Release**, boots an iPhone simulator,
launches the packaged client, opens an event link and captures screenshots. It
also archives for real arm64 iPhone hardware without signing. Both bundles are
checked for application/version identity, iPhone targeting, packaged client,
privacy manifest, disabled debugging and iOS 26 SDK/Xcode 26 minimums.

The simulator zip runs only in Apple's simulator. The unsigned hardware archive
is compiler evidence, not an installable IPA. Neither is a substitute for a
physical phone test. Credentials are never provided to PR jobs.

Local macOS commands (from `mobile`):

```sh
npm ci
npm test
python3 -m unittest discover -s tests -p 'test_ios_*.py'
python3 scripts/ios-release.py validate
npm run build
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath ios/output/BeCore-Tickets-unsigned.xcarchive CODE_SIGNING_ALLOWED=NO archive
python3 scripts/ios-release.py verify-app ios/output/BeCore-Tickets-unsigned.xcarchive/Products/Applications/App.app iphoneos
```

## Activate signed distribution after Apple enrollment

The BeCore Tickets company registration in Ghana is in progress. No Apple Team ID,
certificate, provisioning profile or App Store Connect app record has been supplied.
Do not invent them, register under an unrelated company, or use Android signing keys.

1. Enroll the incorporated legal entity in Apple Developer with its D-U-N-S record.
2. Register explicit iOS App ID `com.becoreops.tickets` in that team.
3. Create an Apple Distribution certificate and export its private key as a
   password-protected `.p12`. Create an App Store Connect distribution profile
   for the exact App ID and certificate.
4. In GitHub repository `bechirobob/tickets`, set variable `IOS_TEAM_ID` and
   secrets `IOS_DISTRIBUTION_P12_BASE64`, `IOS_DISTRIBUTION_P12_PASSWORD`, and
   `IOS_PROVISIONING_PROFILE_BASE64`. Encode the two files as single-line base64.
   Supply secret values through stdin/private files, never chat, source code or logs.
   Keep recovery copies in the owner's private credential storage.
5. Run **iPhone release** on `main`. Missing credentials stop the job. The runner
   validates profile type, expiration, team, explicit app ID and matching private
   signing identity before archiving. It verifies the archive and exported IPA.
   Signing uses a disposable isolated keychain, not a disposable app identity.
   Credentials and installed profiles are removed even on failure.
6. Download `BeCore-Tickets-iPhone-signed-<run>`: IPA, source/hash manifest and
   debug symbols. This export is for App Store Connect; it cannot be sideloaded
   like an Android APK. Preserve it and its symbols beyond the 30-day CI retention.
7. Create the app record, upload the IPA using Apple's supported upload tools,
   and wait for processing. App Store Connect API access/upload automation is
   still to configure after enrollment. This workflow does not submit for review.
8. After an accepted upload, record an `ios-v<version>-<build>` tag at its exact
   source commit. Later workflow runs reject versions/builds older than that tag;
   App Store Connect remains the authority for previously uploaded build numbers.

## Privacy and release declarations

The packaged application currently retrieves public event data without customer
credentials and stores only the public catalogue locally. My Nights, notifications,
RSVP and checkout use the existing HTTPS browser journey. The native package has
no tracking or advertising SDK. Privacy manifest declarations describe the native
package; they are not a declaration that the entire ticketing service collects no
data. Review the actual service, browser journeys and dependencies when completing
App Store privacy labels. Do not submit an unverified “Data Not Collected” answer.

`ITSAppUsesNonExemptEncryption = NO` describes this version's use of OS-provided
HTTPS, with no custom encryption implementation. Reassess if cryptographic SDKs
or private offline passes are introduced. No camera/photo/push capabilities or
permission prompts are added until those native features exist.

## Acceptance before TestFlight rollout / App Store review

- Physical iPhone: clean install; long event text; full posters; VoiceOver and
  text scaling; landscape/safe areas; menu dismissal; native sharing/cancellation;
  background/resume; poor connection; cached catalogue and reconnect.
- Browser handoff: sign-in, RSVP, checkout, cancellation/return and ticket recovery.
  Confirm completion with the real payment provider once activated.
- Upgrade from one TestFlight build to a higher build without losing app state.
- Complete native secure sign-in, private ticket access and push before claiming
  those journeys are native. Current browser handoffs remain intentional and visible.
- Final metadata: screenshots of the actual build; support/privacy URLs; age-rating
  questionnaire reflecting event alcohol content; app privacy; review access and
  notes; account deletion wherever account creation is offered; UGC moderation if
  Room/Flashes are exposed. Submit only features that work end to end.
- Apple enrollment, signed export, upload processing, physical testing and App
  Review are separate gates. An unsigned archive establishes none of those.

## Sources

- [Apple SDK minimums](https://developer.apple.com/news/upcoming-requirements/)
- [Apple enrollment](https://developer.apple.com/programs/enroll/)
- [Capacitor iOS privacy manifests](https://capacitorjs.com/docs/ios/privacy-manifest)
- [GitHub macOS signing](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
- [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/)
