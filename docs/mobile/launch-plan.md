# BeCore Tickets app launch

Status: preparation started, 9 September 2026. No App Store or Google Play build has been submitted. Target both iPhone and Android; keep one BeCore Tickets product identity and the current Cloudflare backend.

## First release

The Drop finds events. My Nights owns tickets, entry passes and each event's Room. The Buzz opens an update at its actual destination. Privacy and Help remain secondary. Staff administration stays on the web; the customer app should not expose a competing operations menu.

Keep the existing event palettes, compact type and navigation. Device-specific work must earn its place: reliable ticket access at the gate, native notification delivery, camera-backed Flashes, proper back navigation, sharing and returning from payment. The first submission must demonstrate these real journeys on devices.

## Architecture decision

Use a packaged customer client with the existing APIs, with Capacitor as the first implementation candidate. The current Vinext/Cloudflare application renders pages on the server, so its build output cannot simply become a static native bundle. Extract the customer screen layer and package it locally; retain protected APIs and staff screens on Cloudflare. Do not ship a configuration that just points `server.url` at the live website: Capacitor documents that option for live reload, not production. [Capacitor configuration](https://capacitorjs.com/docs/config).

Before adopting the runtime, prove one vertical journey: event discovery → email recovery → My Nights → entry pass → background/resume. Reuse current validation and presentation code where compatible. Test cross-origin authentication explicitly; do not put existing web sessions into localStorage or broadly relax CORS. Native credentials need platform secure storage, revocation and an authenticated one-use handoff for browser recovery and payment returns.

## Work sequence and acceptance

| Stage | Work | Acceptance |
| --- | --- | --- |
| 1. Shared foundation | Consistent header disclosures; one destination per navigation group; installed identity/shortcuts; notification link validation | Desktop, mobile Chromium and mobile WebKit checks pass; long updates remain readable |
| 2. Device pilot | Packaged client; secure session handoff; iOS/Android app links; push registration and tap routing; offline ticket refresh/revocation; camera/share/back handling | Real devices recover access, complete a sandbox payment, open the correct pass/Room from cold and warm starts, and recover after losing connectivity |
| 3. Store candidate | Account deletion, moderation review, privacy/data disclosures, permission copy, age rating, reviewer access, store artwork, signed builds | TestFlight and Play internal tests complete; launch checklist has evidence; no credentials or placeholders in submission assets |
| 4. Release | Closed testing where required; final metadata and compliance review; staged rollout with error monitoring | Store approval and real production payment acceptance; rollback/incident ownership documented |

Stage 1 is implemented in the navigation release. Stages 2–4 are pending. No native binaries, native push registration or universal/app-link association files are claimed complete.

## Launch dependencies

- Apple Developer and Google Play account access, organisation identity and signing setup. Availability has not been verified in this workspace.
- A Mac/Xcode build environment for iOS; Android build tooling and physical devices for both platforms.
- Final bundle/application identifiers (proposed `com.becoreops.tickets`), Apple team ID and Android signing certificate fingerprints before publishing domain association files. Do not publish invented identifiers.
- APNs/FCM configuration and platform device-token lifecycle; existing Web Push subscriptions are not native push tokens.
- In-app account-deletion initiation and an accessible web deletion path. The current privacy screen only changes preferences. Define how requests revoke sessions/tokens and remove personal data while preserving any records that must be retained. [Apple deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
- The Room already has reporting, blocking and moderation code. Verify those flows on native devices, including response ownership, before review. Provide usable reviewer access to ticket-gated features. Native quality and user-generated-content review requirements come from [Apple's review guidelines](https://developer.apple.com/app-store/review/guidelines/).
- Keep ticket purchases with the external payment providers: they buy attendance at a real-world event. Apple distinguishes physical goods/services consumed outside the app under section 3.1.3(e). Any separately sold digital Room perks would need a fresh billing review. [Apple purchase rules](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods).
- Determine Google Play account type before promising a date. For personal accounts created after 13 November 2023, Google currently requires at least 12 continuously opted-in closed testers for 14 days before applying for production access. [Google testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

## Routing contract

| Intent | Destination | Recovery |
| --- | --- | --- |
| Browse | `/events` | Public, no sign-in |
| Event | `/event/:slug` | Missing/retired event offers The Drop |
| Tickets | `/my-nights/:slug?view=passes` | Authenticate, preserve destination, then recheck access |
| Event details | `/my-nights/:slug?view=details` | Same event after recovery |
| Room | `/room/:slug` | Ticket entitlement checked by the backend |
| Notifications | `/notifications` | Private inbox recovery |
| Payment return | `/payment/return` | Verify with the backend; never trust a URL as payment proof |

App-link tests must cover cold start, warm start, expired session, expired link, cancelled payment, duplicate payment return and offline resume. External payment/maps links open the system browser and return deliberately. Notification taps must not hijack a staff workspace. Store screenshots and account setup are next-stage deliverables, not generated placeholders.
