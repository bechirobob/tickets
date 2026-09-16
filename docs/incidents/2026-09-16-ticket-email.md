# Ticket email activation — 16 September 2026

## User request
Fix transactional email, create tickets@becoreops.com, and make the mailbox usable in the Gmail mobile app. The user authorized setup. No new paid mailbox subscription has been purchased.

## Sender configuration
Resend account bechirobob verified becoreops.com. Sending is enabled; Resend receiving is disabled to preserve the existing Dynadot root MX. Cloudflare API DNS setup run 35039446983 succeeded. Added resend._domainkey TXT and DNS-only rsend/send CNAMEs using the exact records shown by Resend. Existing root MX webhost.dynadot.com and Dynadot SPF are unchanged.

A sending-only API key scoped to becoreops.com is in GitHub Actions and the production Worker as RESEND_API_KEY. The first unused key was deleted after its transfer did not persist. Its replacement and RESEND_WEBHOOK_SECRET were verified in both stores; installation run 35041914135/job 104623409628 passed. No secret values are recorded here.

Resend webhook https://tickets.becoreops.com/api/email/webhook listens for sent, delivered, delivery_delayed, bounced, complained, failed, and suppressed. Signing credential installed before retrying the receipt.

## Release
PR149 changes EMAIL_FROM to BeCore Tickets <tickets@becoreops.com> and aligns VAPID_SUBJECT. The existing rendered configuration assertion was updated after it caught the old sender expectation. Candidate 759bdb322c735fecce7a57aa9ae2ea9c8922b4a7 passed desktop Chromium, mobile Chromium, and mobile WebKit (run35041048503). Merge/release SHA08d37a73857a9609df8ef107d7b92bc82217a6c7 deployed successfully in run35041721104/job104622824919 with315 Worker tests and production smoke checks. Worker version at deploy b0fc8ff7-948d-4e44-8e98-1c74232c3703; post-secret version af061cd8-7e77-4c33-bb15-cd8a6cdd7e44 was verified directly at /api/version with the same release SHA. Unsigned email webhook POST returned401.

## Paid receipt recovery
Scoped retry script checks the exact owner order BCT-MU3B2WQ1-4D0A93, GHS1 paid status, valid receipt recovery grant, missing-configuration failure, and production sender bindings. Retry scheduled at2026-09-16T00:55:44Z (run35042004342/job104623675651). Standard retries run every5minutes. Resend confirmed delivery to the original owner recipient bechirobob@gmail.com at approximately01:01UTC. Subject: BeCore payment check: payment confirmed and tickets ready. Provider email id1f26e7b6-e1b9-4fb2-878f-2f3d1e6c1d48. Production D1 confirmed delivery_events.status=delivered and failure_reason=NULL at2026-09-16T01:01:44Z (run35042418031/job104624912421), proving signed webhook reconciliation. Paid order and one issued ticket preserved. User has not yet claimed the ticket. No new payment, refund, or extra ticket issued. Ops workflow restored to read-only status.

## Mailbox and Gmail access — pending
Authenticated Dynadot account Benjamin Bob Bechiro. Existing becoreops.com email hosting is Free, created20July2026, with1.62MB existing mail. Preserve that mail and any existing address. Hosting detail displays Please renew your hosting. Free service lacks SMTP/IMAP; Pro is required for direct Gmail app integration.

A Pro Email Upgrade is prepared in Dynadot cart: USD25.23 for307days, expiring20July2027, calculated atUSD30/year. Nothing purchased. User cost approval is needed before checkout.

Dynadot account dashboard works. Its separate webmail.dynadot.com panel is blocked by a Cloudflare human-verification page; reported through browser botDetection. Do not repeatedly retry or bypass it. Mailbox creation has not been verified.

Once Pro and mailbox are active, use provider-verified settings: Gmail app Add another account > Other > Personal(IMAP); username tickets@becoreops.com; incoming webhost.dynadot.com:993 SSL; outgoing webhost.dynadot.com:587 STARTTLS. Mailbox/app password must use secure handling. Do not expose credentials or claim the user's phone is configured. Test inbound mail and reply after account creation.

Official references: https://www.dynadot.com/email ; https://www.dynadot.com/help/question/basic-email-outlook ; https://support.google.com/mail/answer/6078445

## Owner decision: Cloudflare alternative
The owner declined Dynadot's paid upgrade and asked to use Cloudflare for email. The unpurchased upgrade was removed; Dynadot cart confirmed empty. Do not purchase or re-propose this upgrade as approved.

Cloudflare Email Routing can forward tickets@becoreops.com to the owner's Gmail for free, while the verified Resend integration continues sending receipts. Routing alone does not provide a separate IMAP mailbox or branded Gmail replies. Google's third-party Send As feature is being retired in January2027, so do not present that workaround as durable. No incoming MX changes have been made: existing Dynadot mail addresses must be identified/preserved before moving root-domain mail routing.
