# Cuppy event overlay — 28 September 2026

Owner approved the actual event-page mobile preview and authorized deployment.
Base / rollback source: a4670d7289604210e5f5fdae2c3b4e92580f3e6b.
Previous Cloudflare version: 29b44e9e-19a1-435c-b1c9-253060fec8c8.

Scope: only `/event/sun-chasers-labadi`, while its original Guest List flyer is
selected. Add the approved transparent, animated Cuppy at the top-right of the
flyer with a cream-on-plum “Special Guest DJ / Cuppy” tag. Preserve the actual
page's gradient, layout, flyer, registration, content and navigation. Earlier
reconstructed RSVP previews were rejected and are not the implementation.

The 120 KB WebP sprite is the approved photo-based artwork. CSS displays the
first frame before hydration and animates eight poses after visibility checks.
Tap or keyboard-activate the cutout to pause. Reduced motion, hidden tabs and
offscreen placement stop motion. The native shared client bundles this asset.
No schema, customer-data, payment, authentication or provider changes.

Focused browser coverage verifies unchanged flyer/overview/booking bounds,
viewport containment, title clearance, pause/resume and reduced motion at
desktop, tablet, 390px and 320px widths. Candidate and native-client CI remain
required before merging; provider release and live smoke evidence follow.

Next: run exact-head candidate/native/iPhone gates, inspect event screenshots,
merge the approved patch, verify the Cloudflare release and production route.
