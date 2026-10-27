# Yorke Way owner signup notifications

New early-access signups capture currently opted-in owner devices atomically with consent and the subscriber welcome. Repeated submissions, withdrawn addresses and later device opt-ins do not backfill alerts. Hosts and other staff are excluded.

Notifications use the existing owner device setting in Account settings. On iOS, open the installed Home Screen app, sign in and enable notifications. A device must still have an active owner session and unchanged consent when delivery is attempted; signing out disables delivery until notifications are enabled after signing in again.

The alert contains no subscriber name or address. It links to the authenticated owner-only audience list at /admin/yorkeway-audience. Owner email is never sent or used as a fallback. The existing subscriber welcome email is unchanged.

Pending outbox rows use the existing delivery queue and five-minute recovery task. A lease prevents concurrent delivery; retries stop after three attempts or 24 hours. Notification tags are stable per outbox row. As with existing push alerts, an ambiguous provider response can be retried: provider acceptance is not proof that an OS displayed a notification. Device consent and role/session eligibility are checked again after encryption, before sending. Expired endpoints are revoked only for the captured consent version.

Tests use isolated database rows and a mocked push provider. Do not submit synthetic production signups, replay old alerts or send test messages without explicit authority.
