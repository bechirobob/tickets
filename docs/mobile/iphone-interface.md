# iPhone interface rules

The September 2026 interface pass targets iOS 0.1.2 (3). It changes the packaged
customer client and the public website. It does not change authentication,
payments or signing credentials.

- Apple devices use the installed system font. Other devices use bundled Inter
  under the included SIL Open Font License. Never bundle Apple font files.
- Keep BeCore's plum/lime discovery identity and the shared event palette rules.
  Every poster remains fully visible inside equally sized discovery frames.
- Use compact toolbars, a three-destination app tab bar, clear text hierarchy and
  at least 44-point touch targets. Secondary navigation stays in one disclosure.
- Keep dates, venues, dress code and perks in aligned, readable rows. Never hide
  event information with line clamps or fixed-height text containers.
- App type uses relative sizes and the Apple preferred body size. Check narrow
  screens with enlarged text as well as the default size.
- Back restores the discovery position. Tapping the current tab returns to the
  top. A short horizontal swipe from the event's left edge returns to The Drop;
  a vertical scroll must not trigger it.
- Shared motion tokens govern press, disclosure and screen transitions.
  Reduced-motion and reduced-transparency preferences have direct fallbacks.
- Earlier supported browsers retain natural card flow when subgrid is absent.

`native-apps.yml` validates the packaged client and builds the simulator and
unsigned hardware archive. `candidate-checks.yml` verifies website journeys on
desktop Chromium, mobile Chromium and mobile WebKit. The layout workflow runs on
macOS for Apple typography and runs again after successful production deployment,
checking the website's revision before capturing it. Capture overlapping scroll
positions so sticky toolbars and tab bars cannot conceal missing screenshot text.

Screenshots are evidence of rendered layouts, not proof of physical-device
behaviour. TestFlight signing/enrollment, native account access, private offline
passes, native push and physical-device payment-return testing remain separate
launch gates. Existing secure browser destinations remain functional.

## Mobile web completion pass, 30 September 2026

The approved pass keeps the public identity and makes the existing mobile web
journeys more app-like before a separate signed native release. It adds safe-area
and visual-keyboard geometry, restrained translucent navigation with opaque
fallbacks, accessible current-tab return, saved discovery position, dismissible
mobile history layers and touch sheet dismissal. RSVP and Room composer drafts
stay in tab memory, scoped to the exact event (and verified attendee for Rooms).
Consent is not cached or copied. Room drafts are not private offline passes.

Related workflow repairs preserve the selected event in host attention items,
RSVP review, Details, Orders, scanner and team acceptance. Scanner status reports
actual service contact, outstanding entries and durable on-device conflict review.
Owner Operations separates delivery exceptions and last successful background work
from website readiness. Manual provider evidence never changes financial totals,
provider state or ticket validity.

Operations styles now load through staff/organizer/scanner layouts. The shared
Room styles remain shared because public Room previews use them; extracting them
blindly would change the public product. On the same build toolchain, the public
base CSS moved from 523,194 to 470,679 uncompressed bytes (94,748 to 85,501 gzip
bytes in a local comparison). These are bundle measurements, not measured network
or Core Web Vitals improvements.

Verification record: the integrated local test gate passed its repository, static
UI, password-client, rendered HTML and 538 Worker tests before the final
rollback-safety correction. Exact-commit three-browser, native build, VPS runtime
and release-operator gates remain required on the final candidate. Local browser
execution is unavailable in this sandbox; no local rendered-browser pass is
claimed. Release and live evidence belong to the implementation PR. Real-device
keyboard/gestures, store signing and real USDC payment-to-wallet settlement remain
separate unverified boundaries. No live event date/time or authored name spelling
was invented during this pass.
