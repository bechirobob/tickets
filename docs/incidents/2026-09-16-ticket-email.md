# Ticket email activation — 16 September 2026

## User request
Fix transactional email, create tickets@becoreops.com, and make the mailbox usable in the Gmail mobile app. The user authorized setup. No new paid mailbox subscription has been purchased.

## Sender configuration
Resend account bechirobob verified becoreops.com. Sending is enabled; Resend receiving is disabled to preserve the existing Dynadot root MX. Cloudflare API DNS setup run 35039446983 succeeded. Added resend._domainkey TXT and DNS-only rsend/send CNAMEs using the exact records shown by Resend. Existing root MX webhost.dynadot.com and Dynadot SPF are unchanged.

A sending-only API key scoped to becoreops.com is in GitHub Actions and the production Worker as RESEND_API_KEY. The first unused key was deleted after its transfer did not persist. Its replacement and RESEND_WEBHOOK_SECRET were verified in both stores; installation run 35041914135/job 104623409628 passed. No secret values are recorded here.

Resend webhook https://tickets.becoreops.com/api/email/webhook listens for sent, delivered, delivery_delayed, bounced, complained, failed, and suppressed. Signing credential installed before retrying the receipt.

## Release
PR149 changes EMAIL_FROM to BeCore Tickets <tickets@becoreops.com> and aligns VAPID_SUBJECT. The existing rendered configuration assertion was updated after it caught the old sender expectation. Candidate 759bdb322c735fecce7a57aa9ae2ea9c8922b4a7 passed desktop Chromium, mobile Chromium, and mobile WebKit (run35041048503). Merge/release SHA08d37a73857a9609df8ef107d7b92bc82217a6c7 deployed successfully in run35041721104/job104622824919 with315 Worker tests and production smoke checks. Worker version at deploy b0fc8ff7-948d-4e44-8e98-1c74232c3703; subsequent secret installation creates newer Worker versions without changing release SHA.

## Paid receipt recovery
Scoped retry script checks the exact owner order BCT-MU3B2WQ1-4D0A93, GHS1 paid status, valid receipt recovery grant, missing-configuration failure, and production sender bindings. Retry scheduled at2026-09-16T00:55:44Z (run35042004342/job104623675651). Standard retries run every5minutes. Delivery outcome still requires verification. No new payment, refund, or extra ticket issued. Ops workflow restored to read-only status.

## Mailbox and Gmail access — pending
Authenticated Dynadot account Benjamin Bob Bechiro. Existing becoreops.com email hosting is Free, created20July2026, with1.62MB existing mail. Preserve that mail and any existing address. Hosting detail displays Please renew your hosting. Free service lacks SMTP/IMAP; Pro is required for direct Gmail app integration.

A Pro Email Upgrade is prepared in Dynadot cart: USD25.23 for307days, expiring20July2027, calculated atUSD30/year. Nothing purchased. User cost approval is needed before checkout.

Dynadot account dashboard works. Its separate webmail.dynadot.com panel is blocked by a Cloudflare human-verification page; reported through browser botDetection. Do not repeatedly retry or bypass it. Mailbox creation has not been verified.

Once Pro and mailbox are active, use provider-verified settings: Gmail app Add another account > Other > Personal(IMAP); username tickets@becoreops.com; incoming webhost.dynadot.com:993 SSL; outgoing webhost.dynadot.com:587 STARTTLS. Mailbox/app password must use secure handling. Do not expose credentials or claim the user's phone is configured. Test inbound mail and reply after account creation.

Official references: https://www.dynadot.com/email ; https://www.dynadot.com/help/question/basic-email-outlook ; https://support.google.com/mail/answer/6078445
