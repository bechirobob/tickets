# App and mobile website continuity

The packaged client and website render `app/home-screen.tsx`, `app/events/events-screen.tsx`, `app/event/[slug]/event-screen.tsx`, `app/customer-dock.tsx` and the same header disclosure. `styles/customer.css` defines their common cascade. BeCore's Home / The Drop / My Nights navigation, event palettes, posters, facts, countdown, story and public signup actions have one implementation.

The website retains server rendering, metadata, structured event data and protected APIs. The mobile build adapts only links, images, native sharing, safe areas, lifecycle and offline public data. It packages the screens locally; no remote `server.url` or iframe is used. New customer UI changes must update these shared screens and pass both sets of checks. Native CI follows changes in app/, lib/ and styles/ as well as mobile/.

## State boundaries

Public catalogue updates come from the same database. The backwards-compatible `/api/public/events` response adds an explicit public screen projection. Hidden tiers, raw inventory, booking fee configuration and private host/customer records are excluded. Older signed Android clients keep their existing projection. The new app validates and projects every cached field, labels offline data, expires the cache after seven days and disables event signup while stale. The v2 cache contains no login tokens or passes.

Home and Drop filters survive in-session route changes through `app/discovery-state.ts` in both runtimes. The packaged client uses real history paths, restores its browsing position and refreshes on resume/reconnection.

**Signed-in native state is not implemented by this change.** My Nights goes directly to the existing secure browser account flow, without the former placeholder screen. That flow owns tickets, RSVPs, Rooms, notifications and account preferences in the existing backend. Native registration and checkout actions use that flow too. Safari and the app's browser container must not be assumed to share cookies or automatic sign-in. Native account recovery/handoff, Keychain/Keystore credentials, logout/revocation, private offline passes and device testing remain explicit launch work. Do not describe this UI consolidation as completed cross-device session synchronisation.

## Verification and delivery

The Mac screenshot workflow starts the candidate website for PRs and uses the deployed website after a successful release. It captures both runtimes at the same iPhone viewport and checks visible public copy, headings, facts, fonts, colours and dock destinations for equality. Public outage/empty states and secure browser account entrances are captured separately and labelled honestly. Browser tests cover signup handoff, share controls, complete posters, navigation/menu dismissal, retained filters/scroll, reduced motion and stale-data recovery. Worker tests retain the public catalogue privacy contract.

iPhone release identity: 0.1.3 (4), `com.becoreops.tickets`. Apple signing/enrollment and physical-device verification are still pending. Android signing identity and released version are unchanged; this change does not distribute an unsigned APK.
