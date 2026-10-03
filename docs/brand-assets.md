# BeCore identity and member experience

The orange ticket silhouette and ivory B are the identity. The site uses one shared `BrandLogo` component. The symbol is a transparent enamel render; the wordmark remains native HTML type so it stays sharp. Do not replace it with a generic boxed letter.

| Asset | Purpose | Optimised size |
| --- | --- | --- |
| `public/brand/becore-ticket.webp` | Shared header and footer mark | 239 × 256; 7.7 KB |
| `public/atmospheres/the-room.webp` | Private Room and its iPhone previews | 1440 × 960; 55.3 KB |
| `public/atmospheres/behind-the-night.webp` | Hosts, organiser introduction and member recovery atmosphere | 1100 × 733; about 48 KB |

The logo render was edited from the existing Apple touch icon. Direction: preserve the orange ticket, semicircular notches and white B; remove the outer dark square; render orange enamel with a fine warm-metal bevel, slightly raised ivory B and shallow extrusion; remain almost frontal and readable at 40 pixels; transparent alpha, no glow, floor, text or extra emblem. Generation mode: referenced-image edit. App icons use the same render on aubergine with mask-safe padding; the SVG favicon embeds the same transparent render as the 64-pixel PNG. The ICO contains 16, 32, 48 and 64-pixel sizes. Browser, Apple touch, install-manifest and social-card URLs use revision 5 to replace the earlier flat silhouette.

The Room background was generated as a dark listening-lounge material study: oxblood velvet, smoked reeded glass, burgundy leather and a quiet aubergine centre. The backstage photograph was generated as a generic Accra-inspired music-party scene, centred on a DJ's hands and mixing desk. These are decorative atmosphere, not photographs or claims about any particular venue, Host or guest.

My Nights and The Buzz share account navigation, typography and plum surfaces. The Room remains visually distinct. Full message text, Host attribution, unread state and recovery actions take priority over decoration. Checkout and QR codes retain calm, readable surfaces.

The isolated browser fixtures exercise Room replies, pinned announcements and notification dialogs without a live attendee connection. Member fixtures verify service failures, marking notifications and routes to tickets. They block service workers and intercept attendee APIs and Room sockets so verification cannot send customer messages.

Rollback baseline: GitHub `8aa5f6c5b71e7d1ba6631710f16ac2d3fa935f15`, Worker `92e30ddb-aa6c-4a25-8c9d-e830707c7130`. No database migration or environment secret is introduced by this change.

Conversation refinement: reactions use a non-modal native popover anchored to the selected bubble, available through its action button, double-click or a 450 ms touch-and-hold. Reaction counts stay attached to their message and update from the existing socket acknowledgement. Replies quote the original message above the composer. Desktop Enter sends; Shift+Enter and touch-keyboard Enter retain newlines. The live and preview composers share `RoomComposeContent`, `RoomReaction` and conversation material tokens. No CSS shadows, coloured focus halos or button sheen are permitted; keyboard focus is neutral and visible.

Homepage phone direction: the arrival phone is attendee conversation only (five relatable planning messages). The second phone holds the Host update and inside-the-night features. Do not put Host announcements back into the first phone.


Brand consistency pass (September 2026): staff sign-in, recovery, bootstrap, account security, Help, Terms and page recovery now use `BrandLogo`. Offline passes use the approved mark cached with shell v6. Email headers use `lib/email-brand.ts` with a PNG rendition for mail-client compatibility; RSVP, host alerts, announcements, receipts, recovery, transfers and support share it. The social card embeds the approved render rather than the retired flat boxed B. Run `node scripts/refresh-brand-assets.mjs` to refresh the email PNG and social-card PNG/SVG from the WebP source. Existing favicon, Apple touch, PWA, Android/iOS launcher and native splash images were visually checked and already contain the same rendered identity. No native binary release is needed for this web-only correction; installed native icons were already current.

## Room showcase iPhone 15 Pro frame (2026-10-03)

The Room showcase uses Mobile FIRST's licensed transparent iPhone 15 Pro raster,
not the previous hand-drawn SVG or an AI-generated device. The live conversation,
status glyphs and reduced-motion behavior remain HTML; the frame is a stationary
foreground overlay. Its physical camera and sensor details are preserved. A black
software Dynamic Island backing joins the two physical cutouts; no second camera
is drawn. The asset is not an Apple endorsement or an Apple-supplied marketing
asset.

- Source: https://www.webmobilefirst.com/en/mockups/apple-iphone-15-pro-2023/
- Original PNG: https://www.webmobilefirst.com/img/mockups/mockup-apple-iphone-15-pro-2023-transparent.png
- Terms: https://www.webmobilefirst.com/en/license-agreement/
- Retrieved: 2026-10-03; free standard asset, no purchase, signup or checkbox.
- Asset: `public/devices/iphone-15-pro-frame.png`, unchanged 391 × 800 RGBA PNG.
- SHA-256: `5001ad92f4733a593bd7bb50b362e17542d034c29f0f972943e6aa40978862fd`.
- Source page's asset-specific terms permit personal/commercial use and
  modification/cropping, do not require attribution, and prohibit resale or
  redistribution of the standalone file. Use solely as an integrated device frame
  in the Tickets showcase, not a download, reusable template or asset offering.
- The free source is 391 px wide. At the 268 CSS-pixel presentation it retains
  approximately 1.46 source pixels per CSS pixel; it is not a full 2×/3× raster.
  A higher-resolution source requires separate purchase approval. Do not upscale
  this file and describe it as extra detail.
- Screen mask measured from the alpha aperture: left 18, top 14, right 374,
  bottom 787 px; approximately 50 px display corner radius. Overlay remains at
  native aspect ratio, with no synthesized rails, glow or extra lens.

Apple's own marketing bezel route was not selected: its marketing artwork
agreement scopes use to apps available on the App Store while the licensee is in
Apple Developer Program. This website showcase must not silently assume that
eligibility. Reference: https://developer.apple.com/app-store/marketing/guidelines/.
