# Installed PWA resume resilience, 23 October 2026

Baseline: `4c5f395b75837725beb990e27261e3ad367c1314`.

## Findings and bounded correction

The viewport controller accepted zero measurements while backgrounded and only
listened for resize, scroll and focus. A restored document with no resize event
could keep a stale `--app-viewport-height`, which sizes mobile menus and Room
sheets. The extracted controller now rejects hidden/nonfinite/nonpositive
measurements and remeasures on visibility and pageshow, once immediately and once
on the next frame. It preserves keyboard and pinch-zoom behavior, cancels pending
frames, and never reloads a route or changes content, storage, cookies or tickets.

Optional install UI now tolerates inaccessible local storage and rejects failed
service-worker registration without an unhandled promise. There is a custom root
error recovery screen independent of route components and external styles. Its
buttons act only after user interaction. Reload explicitly warns about unsent
changes, and users can open My Nights or the existing static offline ticket page.
Inline styling is permitted by the existing production `style-src-attr` policy;
no CSP expansion was made. Native browser focus indication remains enabled.

The framework already supplied a generic global error fallback. This change
improves that fallback, not proof that root errors caused the reported screen.
The service worker does not cache ordinary app HTML or JavaScript, so inspection
did not establish an app-version/cache mismatch. No worker cache purge, session
reset, automatic reload, diagnostic data transmission or background polling was
added. No attempt is made to keep iOS running continually in the background.

## Verification and limitations

Deterministic tests execute the actual viewport controller through background,
zero/invalid geometry, foreground, BFCache-style pageshow, keyboard/pinch states,
repeated resumes, cleanup and remount. They preserve healthy/loading/empty route
content and unsent text. Optional storage/worker failures and explicit recovery
actions are covered. The installed Vinext error boundary renders the custom
fallback from a real error state in Node. This is not proof that a final production
build wires the global-error module or that a physical iPhone recovers.

The two authored browser tests cover the served app's lifecycle geometry and the
recovery UI under production CSP. They have not yet been executed against the final candidate. Root-error browser
UI is an isolated rendering fixture, not an end-to-end forced production root
exception.

Production build and full typecheck have not completed successfully. Neither is
a passing gate; a verified exact-candidate build artifact is still required.

Before release: complete exact-commit production build and typecheck, confirm
custom global-error inclusion in the compiled client/server output, run desktop
and mobile WebKit browser suites, and check the static offline link on both hosts.
Then install the candidate on a physical iPhone and test normal/long background,
lock/unlock, memory eviction, offline return, deployment while suspended and
return during a partially completed form. Verify session, saved tickets, draft
handling and scroll/navigation without restarting a payment. Obtain a screenshot
and current URL if the color-only screen returns. iOS compositor/process failures
cannot be established or ruled out by synthetic DOM lifecycle events.

## Follow-on: full Room height and screenshot correlation

Further review found a second, independent measurement effect in RoomClient.
It accepted zero/hidden `visualViewport.height` into `--room-height`; the Room
root uses that height with `overflow:hidden`. That combination can collapse the
whole Room, not only its menus. The Room controller now preserves the last valid
positive size, remeasures on visibility/pageshow and the next frame, and removes
listeners/frames when the status effect is replaced. Existing keyboard sizes,
pinch-zoom exclusion and conditional near-bottom scrolling are preserved. Drafts,
access checks, network connections and route state are untouched.

The recurrence screenshot has a uniform bright magenta content area with no app
controls. Its route and runtime state are not visible. Source review found five
allowlisted event palettes, four fixed home scene themes, local artwork washes,
a plum full-screen intro, dark menu/dialog backdrops and bounded photo overlays.
No intended whole-root hide-on-resume or arbitrary root color generation was
found. Scroll reveal affects a specific home section, not the whole document.
The Room zero-height state can cause whole-surface loss, but does not establish
the screenshot's color or cause. Literal color mismatch cannot rule out image,
computed-style or compositor behavior; neither the screenshot nor this read-only
review proves a browser-process fault. Physical-device evidence is still needed.
