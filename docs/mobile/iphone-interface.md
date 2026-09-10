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
