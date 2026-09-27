# Landing design review — 27 September 2026

Status: proposed, awaiting owner visual approval. Do not merge or deploy yet.
Base: 710dc6204b88584bb1bce5f6c47aa0bca4de6794.
Branch: design/landing-review-20260927.

Scope: use the Guest List poster portrait at the top of its hero; present a single homepage result with the complete flyer beside its details on desktop and stacked on mobile. The crop is tied to this exact artwork, not all future posters. The directory and multi-event layout retain their existing design. Payments, logos, footer, Room and organiser section are unchanged.

Verification: TypeScript, targeted ESLint, production build and diff whitespace checks pass. Rendered component checks confirm one-result spotlight, unchanged directory/multiple-result selection and byte-identical footer markup. The offline preview script parses. Browser visual verification remains pending: this session blocked local file navigation. Do not call the design visually approved or browser-tested.

Review artifact: BeCore-Tickets-Landing-Preview.html, Library libfile_77462ad86b24819184732e41350fa0c1. Contains Current/Proposed and Desktop/Mobile switches, public event data captured on 27 September, real components/CSS with offline framework adapters and embedded assets. This is a design comparison, not a deployed full application. Event links open the live site.

Next: owner opens the HTML comparison and accepts or requests changes. Then run actual desktop/mobile browser review and required candidate release gates before a separately authorized deployment. No production changes have been made.

## Second preview — organiser section
The owner prefers the proposed hero and single-event layout. Those remain unchanged. Additional request: improve the section below The Room, still preview-only.

Prepared a warm paper/plum organiser section retaining the photo and CTAs, with more prominent before/during/after benefit headings. Payment footer is unchanged.

Verification: TypeScript, targeted ESLint, production build, diff check, preview JavaScript syntax and rendered comparisons pass. Accepted hero, Drop and Room markup are identical between previews; footer is byte-identical. Browser visual verification remains pending due to the same local-file restriction.

Review artifact: BeCore-Tickets-Landing-Preview-v2.html; opens at the organiser section and compares Previous preview against Proposed. First preview remains available. Nothing has been merged or deployed.

Next: owner reviews organiser treatment, then browser review and required release checks after approval.

Second preview Library ID: libfile_976d3d77789c81919e689fffe092889f

## Third preview — owner correction
The owner rejected the cream background: the original plum composition was good. Preserve it. The requested improvement is to blend the existing photo into the page and improve its caption.

Removed the editorial variant, restored the original section content and colours. Added only a scoped blended-photo treatment: transparent edge masks, slightly wider desktop image, caption in normal flow with no rectangular overlay, compact mobile treatment. The hero, event layout, Room and payment footer are retained.

Review: BeCore-Tickets-Landing-Preview-v3.html; compares Original section with Proposed and opens at the organiser section. V2 is rejected and must not ship. CSS compilation, preview script syntax, diff whitespace and rendered-markup comparison pass; only the intended photo class differs from the accepted first preview. Browser visual verification remains pending. Next: owner reviews this treatment; no merge or deployment authorized.

Third preview Library ID: libfile_55099056499c8191812e22c128f0c770

## Fourth preview — new composition
The owner rejected the feathered image treatment as unprofessional. Neither the cream design (v2) nor the feathered design (v3) may ship. Keep the original plum palette.

Recomposed the host section: headline and supporting copy/actions share an aligned grid above an edge-to-edge panoramic photo. The caption sits outside the photo on the normal content gutter. Benefits sit beneath, with a clearer title hierarchy. Mobile stacks the introduction and uses a shorter photo crop. Removed all added masks and fades. Original image, text, CTA destinations and payment logos retained.

Artifact: BeCore-Tickets-Landing-Preview-v4.html, compares the original section from the accepted first preview with this proposal. Opens at the organiser section. Typecheck, targeted ESLint, CSS compilation, preview JS syntax, rendered comparison of hero/Drop/Room/footer and diff whitespace checks pass. Browser visual verification is still pending because local-file previews are blocked here.

Next: owner visual review. No production merge or deployment authorized.

Fourth preview Library ID: libfile_60eb2a4625f48191a6aff18a6cdc11f3

## Fifth preview — side-by-side required
The owner rejected the full-width strip (v4) and explicitly requires a side-by-side desktop composition. Preserve plum colours. V2, v3 and v4 are rejected.

Research: visually inspected Soho House https://www.sohohouse.com/en-us/event-spaces, especially its festive-hosting split section: narrow copy beside taller imagery. POSH platform inspection hit a security challenge, and DICE ticketing returned 403; no visual claims are based on those blocked pages.

Proposed adaptation: copy and compact benefit rows in the left column; taller photography fills the right column and reaches the section's right edge. Caption is in normal flow below the photo. Mobile stacks naturally. Existing photograph, copy, destinations, plum palette and the accepted first-preview hero/Drop/Room/footer remain. No feathering, white background or panoramic strip.

Review artifact: BeCore-Tickets-Landing-Preview-v5.html. Typecheck, targeted ESLint, CSS compilation, preview script syntax, scope checks and diff whitespace pass. Actual preview browser visual verification remains pending due to local-file restriction. User should compare Original section / Proposed on desktop and mobile. No production merge or deployment authorized.

Fifth preview Library ID: libfile_3f42811fa6f88191b981b8b030e0d070

## Release authorized — 27 September, 19:48 Africa/Malabo
The owner selected the fifth preview and explicitly authorized combining all accepted changes and pushing with full discretion. Release scope: the first preview hero crop and single-event layout plus the fifth preview side-by-side host section. Payment logos and footer remain unchanged. Rejected intermediate treatments are absent.

Next: exact-head candidate browser, native app and iPhone-layout gates; inspect screenshots; merge only after successful required checks; verify Cloudflare deployment and live revision. Last known-good production source: 710dc6204b88584bb1bce5f6c47aa0bca4de6794. No data/schema change in this release.
