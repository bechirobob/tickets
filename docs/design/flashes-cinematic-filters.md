# Flashes cinematic still-photo looks

## Contract

Original, Noir, 35mm, After Hours and Chrome grade captured stills locally. There are no face effects, reshaping, stickers, borders, remote image processors, new dependencies or services. Soft Flash diffusion is excluded pending measured device evidence. No server, moderation, consent, expiry, one-look or access-control behavior changes.

- Original and strength zero reuse the ungraded capture's existing JPEG bytes.
- The same deterministic sRGB pixel kernel powers the compact thumbnail strip and selected full-size export. Thumbnails show the full-strength direction; the main preview shows the selected strength.
- Strength is bounded to 0–100. Grain is deterministic and does not move when the photo is re-rendered.
- A full-size encoded Blob is previewed, and that exact Blob's bytes become the upload File. Send is unavailable until its image has loaded, consent is checked and comparison is off. Server-side WebP recompression means the subsequently stored image is not promised to be pixel-identical.
- Holding the photo compares the Original; a separate keyboard/screen-reader-operable button toggles the same comparison. Pointer cancellation clears temporary comparison.
- Capture uses the visible camera element's current cover crop and preserves the existing front-camera mirror. It does not capture a wider sensor frame than the user saw. Dimensions retain the existing 1600-pixel maximum edge without upscaling.
- Work is debounced 100 ms and yields every 32,768 pixels. Changes, retakes and close abort stale render jobs; their completion cannot become an upload. Scratch canvases are released and Blob URLs revoked.
- Both editor and existing Flash viewer explicitly set image containment to override the framework’s inline cover default, keeping the saved frame visible without a second crop.
- After capture the editor keeps the complete saved frame visible above the controls, with a scrollable thumbnail strip. Compact landscape places controls alongside the photo.

## Evidence and remaining gate

The focused Node tests exercise the actual grading functions and camera component event/effect ordering, including source invariance, strength endpoints, deterministic chunked grain, cropped/mirrored capture, stale completion, retry, repeated selection, exact preview/upload Blob parity, consent, retake and close cleanup. They do not establish native browser rendering or hardware camera performance.

`tests/e2e/flash-camera.spec.ts` supplies isolated real-browser journeys for Chromium desktop/mobile and WebKit mobile. It mocks camera sensor input, not the renderer, so canvas encoding, image decode, upload bytes, layout, accessibility and pointer behavior remain real. Coverage includes a 320×568 viewport and 844×390 landscape. Mobile Chromium uses real browser-protocol touch-start/cancel; WebKit’s available harness covers a real tap and mouse-hold/synthetic cancellation, not native held-touch capture. These require an environment capable of launching the configured browsers; local browser execution is currently blocked by the environment. A physical iPhone Safari/PWA check remains separate from emulation, especially front/rear cameras, orientation, resume, low light, repeated retakes and memory pressure.

`scripts/preview-flash-filters.mjs` makes a repeatable code-output contact sheet from a provided image and explicit crop. The first artifact uses only the Original panel of an existing fictional visual study. It invokes the actual pixel kernel and Sharp JPEG encoding, not browser canvas encoding. The artifact is neither a production UI screenshot nor device-performance evidence.

Do not merge or deploy until the exact candidate has independent source review and the browser gate has passed. Keep this branch separate from the navigation/opening-scene release. Rebase onto the verified main revision after that release rather than carrying its release-control edits here.
