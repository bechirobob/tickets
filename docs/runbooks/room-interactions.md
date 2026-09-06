# Room interactions

The Room is a private conversation for ticket holders. Its reactions, Host updates,
concierge and Flashes share its wine and parchment materials. No surrounding
reaction card, coloured shadows or public attendee data belongs in the preview.

## Conversation

- Ellipsis, touch-and-hold or desktop context-click opens a compact reaction rail.
  Arrow keys move between actions. Escape restores focus; outside interaction,
  scrolling and viewport changes dismiss it. Enter and exit are animated, with
  reduced-motion support. Reactions still follow the server acknowledgement.
- Reply, copy, report and block remain attached to the selected message.
- The newest pinned Host update appears once above the stream. Other Host updates
  are expandable single-line notices. The first homepage phone is attendee chat;
  only the second phone includes a Host update.
- Concierge and Room preferences use native dialogs with contained focus, a right
  sheet on desktop and bottom sheet on mobile. A failed concierge send preserves
  the draft. Failure to refresh history after sending never reverses success.

## Flashes

An unopened Flash is a small shutter marker, never a thumbnail. The inbox groups
unopened and all Flashes. Photographs appear only in the immersive viewer.

Each recipient gets one server-enforced viewing session, up to ten seconds.
The sender may preview their own photo again. Closing, leaving the tab, expiry,
reporting or removal clears the displayed Blob URL. Screenshots remain possible;
this is temporary viewing, not screenshot prevention or end-to-end encryption.

- Migration `0025_flash_view_sessions.sql` adds only `room_flash_views`, uniquely
  keyed by Flash and guest. Existing migration snapshots had omitted two manually
  added tables; the new snapshot includes them without recreating those tables.
- `POST /api/rooms/:slug/flashes/:id` takes a client UUID `viewId`. The first claim
  fixes the deadline. Retrying that nonce can resume the same unexpired session;
  another nonce cannot reset a recipient's view. A sender's new nonce starts a
  fresh owner preview.
- Image `GET` requires the session nonce, the same signed-in attendee, an active
  ticket, an open Room and media that is neither expired, blocked nor reported.
  All image responses remain private and uncached.
- `PATCH` with the same nonce closes only that guest's session. The deadline still
  bounds access if a close request is lost. Opening is remembered across refreshes.
- Receipts are purged with expired/deleted media. Image deletion and automated
  safety moderation retain their existing enforcement.
- The camera opens live capture only, stops all tracks on close, and discards a
  stream if permission arrives after dismissal. Switching lenses cancels the old
  request. Failed reports preserve context and can be retried.

## Verification and release

Worker tests cover concurrent claims, retry deadlines, cross-guest access,
closure, expiry, owner previews, personal blocks/reports and Room closure.
Isolated browser fixtures cover the actual Room components in desktop Chromium,
mobile Chromium and iPhone WebKit, including recovery, camera cancellation,
compact geometry, keyboard focus, accessibility and screenshots. They intercept
all private API requests and sockets; they never send real attendee messages.

Deploy through the existing candidate and Cloudflare workflows. Apply the additive
migration after capturing the D1 recovery bookmark, then publish the Worker. The
pre-change production reference is `945b89edebcebdb17a2a0e17199863f6638a5f59`
(Worker `52955139-ffb4-4763-aabc-2d63c01517f5`). Already-open older Room clients need
refreshing to use the new viewing protocol. Prefer a forward correction or
containment for a Flash incident: rolling back the Worker to the old GET handler
would also roll back per-guest view-once enforcement. Never roll the database back
just to undo this additive table.
