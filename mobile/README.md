# BeCore Tickets apps

Packaged customer applications for Android and iPhone. Android release identity and version are maintained in `android/release.json`. Application ID: `com.becoreops.tickets`; store registration remains pending.

## Included

- Locally packaged React screens for The Drop and event details, using the website's shared event palettes and public catalogue.
- Full, consistently sized posters; event-specific copy, dress code, perks, countdown and native sharing.
- Loading/error/retry states, a seven-day public catalogue cache, connection/resume refresh and safe customer link routing.
- Native Android back handling and a `becoretickets://event/:slug` development entry link. No verified domain association is claimed.
- My Nights and The Buzz open the existing secure browser flow. Checkout does too when sales are available. No native authentication, private offline tickets or native push yet.

Production engineering applies from the first distributed build. Store submission still requires the incomplete native journeys below. The apps do not copy web cookies, place session tokens in JavaScript storage, or embed the production site as their root page.

## Build

Node 22+ is required. The client lockfile is independent of the server application.

```sh
cd mobile
npm ci
npm test
npm run sync
```

Android: Java 21 and Android SDK/build-tools 36.0.0. Use the **Android release** workflow for signed APK/AAB distribution; [signing setup](android/SIGNING.md) documents activation, recovery and update checks. Releases fail without the permanent signing credentials. Development builds use a separate `.dev` app ID and are never delivered as customer releases.

iOS: [iPhone release preparation and signing](ios/RELEASE.md). macOS with Xcode 26+, then `npm run ios`. The project uses Swift Package Manager. A simulator build does not need distribution signing; a physical iPhone/TestFlight build needs the Apple team, registered bundle ID and provisioning. Signing values are intentionally absent.

The **Native app builds** GitHub workflow runs client behavior tests, Android compilation/lint and iPhone Release simulator launch and unsigned hardware archiving on the exact candidate commit. PR runs preserve an explicitly unsigned Android validation artifact, simulator app and browser evidence. Installable APKs come only from the separate signed release workflow, which also publishes durable GitHub Releases with a signature/version manifest.

Run the browser suite with `npx playwright install --with-deps chromium webkit` followed by `npm run test:browser`. It exercises the packaged production assets at 320px and standard phone sizes, including offline retry, event colours, full posters and browser handoff. It does not substitute for testing native plugins on devices.

## Icons

Icons and launch screens derive from the approved BeCore Tickets web icon. Regenerate from this directory using:

```sh
npx @capacitor/assets@3.0.5 generate --assetPath assets --ios --android --iconBackgroundColor '#25192f' --iconBackgroundColorDark '#25192f' --splashBackgroundColor '#25192f' --splashBackgroundColorDark '#25192f'
```

## Next acceptance gate

Native secure sign-in → My Nights → entry pass → background/resume on physical iPhone and Android, followed by payment return, APNs/FCM, camera-backed Flashes, account deletion and store review. See [launch plan](../docs/mobile/launch-plan.md).

References: [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup), [packaged assets](https://capacitorjs.com/docs/config), [GitHub macOS build environment](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md).

Shared app/mobile-web screens and remaining session boundaries: [customer continuity](../docs/mobile/shared-customer-screens.md).
