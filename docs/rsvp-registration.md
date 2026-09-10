# RSVP and interest registration

Event hosts and assigned operations staff can choose **RSVP**, **Paid registration**, or **Email list only** under **RSVP & guests** in the dedicated Operations page or organiser workspace. RSVP requires a confirmed date and guest capacity. Party size includes the lead guest. Host approval and Room access are independent settings.

Undated published events default to announcements. Existing dated paid events keep their paid ticket mode. Publishing a date does not turn an interest subscription into admission. Subscribers receive an update and must explicitly book or request an RSVP.

Public RSVP submission enters the host approval queue or capacity allocation immediately and shows an on-page acknowledgement. It sends no guest confirmation email and creates no attendee identity. Retries preserve the original guest, party size and consent. Email-list subscriptions and existing access links still require inbox verification; simply opening a link does not consume it. My Nights supports tickets, confirmed RSVPs, approval requests, waitlists and announcements. Email recovery also supports subscribers without tickets.

RSVP allocation and its zero-cost admission bundle are one atomic D1 batch. Capacity counts people, not registrations. Waitlist allocation follows creation time and keeps parties together: a party that does not fit waits until enough places are available. Cancellation voids the party's passes and promotes waiting guests. A used pass prevents cancellation. Rejoining goes to the back of the queue. Free RSVP passes cannot be transferred or submitted for paid-ticket refunds.

Confirmed RSVPs with independently verified email ownership use the existing QR wallet and gate scanner. Unverified RSVP requests reserve capacity when approved but do not issue account passes or unlock The Room. Room access remains disabled unless the host enables it. Interest, approval requests and waitlisted registrations never grant admission or Room access. Existing bookings prevent incompatible mode or capacity changes.

The scheduled Worker processes eligible verified registration state notices and date/booking announcements through the existing transactional email retry queue. Unverified direct RSVP submissions do not trigger guest email. Access links expire after 20 minutes. Production uses its existing email configuration.

Migration: `0036_event_rsvp.sql` creates three additive tables and their indexes. It does not rewrite event prices or existing tickets. Apply it before deploying the Worker; the normal deployment workflow does this. Rolling the application back can leave these additive tables in place.

Verification: Worker integration coverage exercises email ownership, concurrent allocation and token replay, plus-ones, duplicates, approval, Room controls, real QR check-in, cancellation, waitlist promotion, interest announcements and recovery. Dedicated browser checks cover RSVP, undated-event interest, email access and My Nights on desktop Chromium, Android Chromium and iPhone WebKit. The optional mobile catalogue fields preserve compatibility with existing app clients.

## Host workflow

Choose an event, select entry mode, capacity and approval preference, then use **Midnight before the event** for the Accra deadline if needed. **Save & copy link** saves changed settings and checks the actual public route before copying. Clipboard failure leaves the visible link selected. **Guest list** supports name/email search, status filters and bounded pages. Live updates preserve unsaved setup edits. The owner sees organiser actions in Event operations.
