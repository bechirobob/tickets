# Production experience pass — 10 September 2026

Baseline: `ccfb151ea135d2a54be91c790c6d247fc38d9bd5`, Worker `e42c8705-4363-40fe-83e0-2e1b5feacf6c`.

## Findings and changes

| Finding | Remediation | Verification |
| --- | --- | --- |
| RSVP configuration mixed sharing, setup and long guest tools | Dedicated owner/curator workspace; setup, guest list, email and announcement views; persistent link | Authenticated desktop/mobile browser suite |
| Copying required a separate save step | Save & copy checks save success and server readiness; selectable fallback if clipboard access fails | Failed-save retention, real save, clipboard fallback and guest submission browser journeys |
| RSVP dates required manual entry | One-click Accra midnight deadline; current capacity and approval preserved | Shared-link browser flow and existing server deadline gates |
| Guest roster only paged, with no search | Server-side name/email search and status filter before pagination; accurate filtered count | Worker fixture with 55 guests and combined filters |
| Operations exposed every task in one long page | Overview, readiness, issues and approvals; actionable attention list; grouped metrics and contained controls | Route-wide axe checks, overflow checks and view navigation |
| Event story and contact were one paragraph | Shared story/credits/contact component; explicit roles only; `tel:` links | Parsing unit cases and public browser test |
| Guest voice inconsistent | RSVP, wallet, recovery, payment, help, Host, Room and submission copy aligned | Existing journey assertions; no change to admission or payment rules |

## Reference decisions

[Luma guest management](https://help.luma.com/p/managing-your-guest-list) and [expanded guest table](https://help.luma.com/p/expanded-guest-table) support a dedicated guest view, status filtering, guest search and clear actions. [Partiful host help](https://help.partiful.com/en-us/collections/19666489-partiful-for-hosts) reinforces share links and guest deadlines as core host tasks. These patterns inform the workflow; the visuals and tone remain BeCore's.

## Automation and boundaries

Guest activity refreshes every five seconds while visible; Operations every thirty seconds. Live updates preserve unsaved registration edits. Copying changed settings saves and validates before sharing. Owner activity records remain visible. Host approval stays a deliberate choice. No migration, real guest signup, customer email or payment is required for this release. Existing Weekend Braai settings are not reset.

The CI candidate runs the exact branch commit on desktop Chromium, mobile Chromium and mobile WebKit. The PR retains final run links, screenshot review, deployment version and production verification. Rollback uses the baseline commit above and requires no schema reversal.

The RSVP copy action follows [WebKit's async clipboard guidance](https://webkit.org/blog/10855/async-clipboard-api/): start the write on the user's tap, and resolve the text only after saving and server readiness checks. Failed saves never supply clipboard content; the visible field remains a fallback when clipboard access is unavailable. Browser coverage checks initiation before the settings response and the final saved URL.
