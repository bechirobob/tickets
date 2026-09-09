# Navigation audit — September 2026

Scope: customer discovery, event pages, My Nights, tickets, notifications, privacy/recovery, organizer submission/workspace/analytics, staff navigation and installed-app entry points. Preserve the Room's separate notification-settings surface and all server authorization. Baseline: commit 0d6674e96ec530fdc243d0f76fe14fe912742236, Worker e05308bb-0055-4a37-b466-7e85cddce4bd.

| Finding | Severity | Correction |
| --- | --- | --- |
| Bell used a modal overlay, blocked the page and could not toggle from its trigger | Medium | Non-modal anchored dropdown using the shared header disclosure hook; toggle, Escape/X, outside click, focus departure, route-change close, reduced motion |
| Header panels could compete and used different dismissal rules | Medium | One open header panel at a time, with restored keyboard focus only for explicit dismissal |
| Mobile primary navigation repeated in the hamburger; desktop home links repeated in the same header | Low | Keep primary routes in the dock/desktop row and complementary destinations in the menu |
| Night header and tab bar repeated the same Room destination | Low | Keep Room in the Night tabs and the bell at the far right |
| Account header and tabs repeated My Nights; locked privacy/wallet paths split recovery | Low | Account label in header, mobile account tabs use the dock's My Nights; privacy uses the main recovery route; remove redundant wallet detour |
| Desktop staff navigation omitted organizer destinations available in the mobile selector | Medium | Add authorized organizer destinations to desktop; retain responsive sidebar/selector exclusivity |
| Submission header sent “Back to events” to Home and omitted the standard menu | Low | Shared menu plus one organizer sign-in action |
| Organizer analytics had a second workspace route among data filters | Low | Workspace switching remains in the header; filters contain data controls |
| Menu labels could ellipsize and tall panels could leave the viewport | Medium | Full wrapping labels, bounded scrolling, keyboard and visibility regression coverage |
| Notification tap trusted arbitrary destinations and reused staff windows | Medium | Same-origin customer destinations only, safe inbox fallback, preserve staff windows and await navigation before focus |
| Immediate release check raced edge propagation | Low | Bounded exact-revision retry, then verify public routes and unsigned webhook rejection |

Visual language follows the agreed warm translucent header surface, compact rows, embedded X, no shadow and restrained entry/exit. Non-modal navigation should allow normal tab movement and Escape return; [WAI disclosure guidance](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/).

Verification: local lint/types, repository/UI tests; exact-head candidate workflow runs full automated tests, build, dependency audit, Worker validation, role journeys and desktop/mobile browser projects. New browser coverage checks menu destination uniqueness and visibility across six representative pages, plus bell toggle/exclusivity/focus departure. Existing public route/role/navigation/Room tests remain release gates. Post-release runtime checks and workflow evidence are recorded in the PR.

App launch preparation and remaining external requirements: [launch plan](../mobile/launch-plan.md). Installed web identity/shortcuts are updated; native builds and store submission remain pending. Live authenticated production journeys are limited by available sessions; isolated browser fixtures test their interaction states without mutating customer data.

Rollback: restore the baseline Worker; this release has no database migration. The service worker cache version changes only the shell cache, not private offline ticket storage.
