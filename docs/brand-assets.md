# BeCore identity and member experience

The orange ticket silhouette and ivory B are the identity. The site uses one shared `BrandLogo` component. The symbol is a transparent enamel render; the wordmark remains native HTML type so it stays sharp. Do not replace it with a generic boxed letter.

| Asset | Purpose | Optimised size |
| --- | --- | --- |
| `public/brand/becore-ticket.webp` | Shared header and footer mark | 239 × 256; 7.7 KB |
| `public/atmospheres/the-room.webp` | Private Room and its iPhone previews | 1440 × 960; 55.3 KB |
| `public/atmospheres/behind-the-night.webp` | Hosts, organiser introduction and member recovery atmosphere | 1100 × 733; about 48 KB |

The logo render was edited from the existing Apple touch icon. Direction: preserve the orange ticket, semicircular notches and white B; remove the outer dark square; render orange enamel with a fine warm-metal bevel, slightly raised ivory B and shallow extrusion; remain almost frontal and readable at 40 pixels; transparent alpha, no glow, floor, text or extra emblem. Generation mode: referenced-image edit. App icons use the same render on aubergine with mask-safe padding; the SVG favicon embeds the same transparent render as the 64-pixel PNG. The ICO contains 16, 32, 48 and 64-pixel sizes. Browser icon URLs use revision 4 to replace the earlier flat silhouette.

The Room background was generated as a dark listening-lounge material study: oxblood velvet, smoked reeded glass, burgundy leather and a quiet aubergine centre. The backstage photograph was generated as a generic Accra-inspired music-party scene, centred on a DJ's hands and mixing desk. These are decorative atmosphere, not photographs or claims about any particular venue, Host or guest.

My Nights and The Buzz share account navigation, typography and plum surfaces. The Room remains visually distinct. Full message text, Host attribution, unread state and recovery actions take priority over decoration. Checkout and QR codes retain calm, readable surfaces.

The isolated browser fixtures exercise Room replies, pinned announcements and notification dialogs without a live attendee connection. Member fixtures verify service failures, marking notifications and routes to tickets. They block service workers and intercept attendee APIs and Room sockets so verification cannot send customer messages.

Rollback baseline: GitHub `8aa5f6c5b71e7d1ba6631710f16ac2d3fa935f15`, Worker `92e30ddb-aa6c-4a25-8c9d-e830707c7130`. No database migration or environment secret is introduced by this change.

Conversation refinement: reactions use a non-modal native popover anchored to the selected bubble, available through its action button, double-click or a 450 ms touch-and-hold. Reaction counts stay attached to their message and update from the existing socket acknowledgement. Replies quote the original message above the composer. Desktop Enter sends; Shift+Enter and touch-keyboard Enter retain newlines. The live and preview composers share `RoomComposeContent`, `RoomReaction` and conversation material tokens. No CSS shadows, coloured focus halos or button sheen are permitted; keyboard focus is neutral and visible.

Homepage phone direction: the arrival phone is attendee conversation only (five relatable planning messages). The second phone holds the Host update and inside-the-night features. Do not put Host announcements back into the first phone.
