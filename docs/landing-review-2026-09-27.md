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
