# Tickets workspace integration candidate

Local integration branch `integrate/boardui-workspace-20261101`, based on approved preview commit `14b2b3789b61ed032e20ac772397c637c0fbfc33` and original main `63f2ead2fb3eaae03696f408b12e9e18cfcee265`. This is application source work, not a live rollout or a claim that Tickets is finished. Preview PR #394 and independent PRs #392/#393 are not modified by this branch.

## Real routes and contracts

| Area | Implemented integration | Preserved contract / remaining work |
| --- | --- | --- |
| `/organizer/workspace?area=overview` | Free BoardUI search and pagination over assigned events; removes the first-twelve-only display limit | `/api/organizer/business?section=events&event=all` remains authoritative; client filtering never broadens assignments. Existing host navigation and selected-event URLs retained. |
| Event Guests | BoardUI search, compact table and pager; contextual native record dialog; Close/Escape/mobile Back and trigger-focus restoration | Existing server-side query/status/25-row pagination and counts-first/on-demand personal data. `guest_detail` still controls financial scope, resend access and refund review. Search controls remain mounted while results load, so typing and focus survive slow responses. No duplicate guest mutation API or fake saved state. |
| Host Audience | BoardUI search/pager; contextual guest history | Assigned-event history and event-specific announcement consent unchanged. |
| Owner `/admin/yorkeway-audience` | Compact subscriber list, server search before existing email cursor pagination, accurate matching count, consent-version dialog, loading/error/retry and stale-request protection | Same owner session/password-change check and private no-store response. Same subscribed/suppression predicates. Bound, parameterised literal substring search; withdrawn/suppressed rows excluded. No send, contact sync, edits or permission changes. |
| Event Details, Tickets, Team, Money, Room/VIP, Insights and Requests | Existing forms/actions stay connected, with shared host visual treatment and pager where already used | Their established persistence, role checks and mutation contracts are unchanged. Dedicated interaction redesign and full expanded-state browser verification are still remaining work. |
| Other owner platform screens | Existing shared navigation retained | Orders, event inventory, staff management, support and finance are not claimed as migrated by this increment. |
| Public Yorke signup | No change | Remains distinct from owner audience management and staff invitations. The prior isolated signup reference is not a production redesign. |

The same pinned MIT BoardUI source and notices under `components/boardui` are reused. Production adapters live under `components/workspace`; existing Operations button rules explicitly exclude the integrated adapter so they cannot shrink its touch targets or overflow action cells; production layouts reference `/boardui-pressable.css`. Existing trial routes remain separately under `/boardui-trial`. No dependency changes, global theme replacement, customer-data reads, outgoing messages or production credentials.

## Verification and limitations

Evidence is in `evidence/`. Actual Vinext build and TypeScript checks passed against application source. Existing repository tests: 288 passed; UI tests: 308 passed; focused Worker tests: 67 passed; rendered-build tests: 5 passed (668 total). Lint has zero errors and five unsuppressed warnings: three external stylesheet links (trial plus two protected layouts), one inherited moderation default export and one deliberate image shim in the standalone test harness. Repository and UI tests retain their existing assertions; the finance projection harness only stubs newly imported, unused record-list primitives. Focused Worker tests cover organiser business/invitation behaviour and Yorke authorization/eligibility plus the added literal-search/cursor test. That test uses the existing mocked delivery boundary and cleans up its fixture records; it sends no email.

Browser evidence mounts the real source components with the actual shared styles in a separate loopback-only Vite harness. HTTP responses are fictional, intercepted contracts. It checks desktop 1440×1000 and touch-emulated 390×844/320×740, search, counts-first guest loading, page preservation, repeated modal cycles, focus restoration, retry errors, stale search response rejection, empty state, overflow and axe. This is **not** signed-in browser-to-database verification, CSP validation of compiled protected pages, real Safari, real iPhone or OS keyboard evidence. Those remain explicit gates. The first harness iteration missed parent-layout styles; only final screenshots with the complete styles are retained as review evidence.

Final whole-build JS/CSS totals are 667,243 gzip bytes, including the retained evaluation routes, versus 663,028 for the approved connected trial (+4,215) and the recorded clean baseline 577,482 (+89,761). These are emitted-file totals, not route download cost or a speed claim.

No exact-HEAD hosted release evidence has been produced for this candidate. No release admission inventory, control plane, auth, consent or workflow was weakened.

## Dependency and release sequence

Root lockfile and dependencies are unchanged from the trial. Fresh unwaived audits report root 21 moderate and mobile 4 moderate findings, zero high/critical; both audits exit nonzero. Advisory identities: glob GHSA-3g3m-2fjr-6pw4 and minimatch GHSA-g3hv-75wg-m249, with propagated dependency paths. No waiver.

Read-only inspection confirmed PR #392 is still an unmerged draft at `a17fd73f31a19eba1be725fbbf29e5c798ec0392`. Its bounded dependency fix pins glob 14.0.2 and minimatch 11.0.1; root legacy lint callers use the reviewed private compatibility adapter and mobile has direct overrides. This integration does not copy scanner changes, rewrite its source inventory or claim its fixes are released. The original email screenshot artifact problem and exact-source release checks remain unresolved prerequisites from the parent task.

Safe sequencing:
1. Complete #392's outstanding evidence/review under its own controls; preserve #393's independent recovery work.
2. Rebase/extract this integration onto the approved dependency-corrected base, retaining BoardUI provenance and excluding evaluation-only trial routes from the eventual production change if desired. Review the resulting combined source inventory, not the old inventory.
3. Install the resulting exact lockfiles and rerun unwaived root/mobile audits, build, type/lint, affected Worker/UI tests and the required exact-source hosted browser/release gates. New ancestry invalidates any exact-HEAD claim from this local increment.
4. Verify compiled authenticated owner/organiser flows, event writes and drafts, server-rejected actions, permissions, invitation delivery/acceptance distinctions, consent exclusions, full expanded-state mobile layouts, CSP, assistive technology and real Safari/iPhone. No live invitations or customer records are needed for an isolated test backend.
5. Obtain the separate rollout decision required by the current no-deploy task boundary; then use existing guarded release/rollback and post-deployment revision checks. Do not treat interface approval as bypassing release gates.

## Automatic CI reviewed before committing

`.github/workflows/deploy.yml` deploys on matching `main` pushes and explicit dispatch, with a main-ref guard. Never push this integration to main. New feature-branch commits/pushes do not match that trigger. Native app and iPhone layout workflows run on relevant PR changes; their PR paths build local candidates. Production browser audit and marketing connection follow Deploy to Cloudflare, not this feature branch. Other operational push workflows are restricted to main and/or their specific workflow paths; the only named non-main push trigger inspected is `feat/staff-entry`. No workflow is changed or manually dispatched here. A new PR is not needed for the local verification work.

## Independent iPhone layout review

No hosted URL is verified. The owner can run the source-component harness on their own computer on a trusted private Wi-Fi network:

```sh
npm ci
node scripts/boardui-integration/serve.mjs --lan
```

Use that computer's actual private LAN IP in Safari on the iPhone, port 8795:
- `/organizer/workspace?area=events&event=fixture-night&view=guests`
- `/admin/yorkeway-audience`

The default command without `--lan` binds only to loopback. LAN mode was added for device review but was not started in this environment. It exposes the Vite development server to the local network, so use only a trusted network, no router port forwarding, and stop it after review. This is a source-component fixture, not a production-authenticated preview. All `/api` reads are local fictional responses and all write methods are rejected with 405; unsupported areas show a fixture limitation. Loopback delivery and write rejection are verified in `device-harness.json`. Physical-network connectivity and actual iPhone behaviour are not yet verified.

Check keyboard occlusion/zoom, long rows, page navigation, open/close/back/focus, enlarged text and orientation. A production-like signed-in phone check requires a separately approved isolated HTTPS test environment; no such environment or URL is claimed here.

Library transfer is not retried: previous owner approval remains valid, but the supported helper's pre-upload tool-discovery network failure is unresolved. No Library IDs exist.
