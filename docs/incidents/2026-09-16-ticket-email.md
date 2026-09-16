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


## Approved free routing and Gmail setup — completed
The owner explicitly authorized moving both tickets@becoreops.com and bechirobob@becoreops.com to free Cloudflare forwarding, destination bechirobob@gmail.com. The owner accepts Gmail third-party Send As as a temporary arrangement until January 2027. This supersedes the earlier pending Dynadot Pro plan. No paid plan was purchased; old stored Dynadot mail was not deleted or imported.

Cloudflare destination 1e226dc891164089bc57e7b4d47fa832 was verified at 2026-09-16T01:19:11.960018Z. Exact enabled forwarding rules:
- tickets@becoreops.com -> bechirobob@gmail.com: e87ac284b0fb471b92ae2337523ee5d0, priority 0.
- bechirobob@becoreops.com -> bechirobob@gmail.com: 21bb8bbbfd774d569bffbbc87c4fc9ad, priority 1.
The catch-all remains disabled.

Migration used the existing CLOUDFLARE_API_TOKEN through GitHub Actions, never the Cloudflare browser dashboard. Initial activation rejected the root domain in its optional subdomain name parameter. The script restored root MX/SPF. Subsequent attempts safely rejected duplicate DKIM records until quoted/split TXT normalization was corrected. Final run 35044547375/job104631445260 succeeded at 2026-09-16T01:33:28Z: Email Routing enabled=true,status=ready. Public Google DNS confirmed root MX route1/route2/route3.mx.cloudflare.net priorities 69/52/86; root SPF is one record with include:_spf.mx.cloudflare.net plus the existing Dynadot authorizations. Cloudflare cf2024-1 DKIM installed. Resend DNS/sending and production Worker unchanged.

Rollback source root mail DNS:
- MX becoreops.com -> webhost.dynadot.com, priority0, TTLauto.
- TXT becoreops.com -> v=spf1 mx include:webhost-mail-out.dynadot.com include:spf.webhost.dynadot.com ~all, TTLauto.
To roll back deliberately, first unlock routing DNS and restore these root records; preserve Resend selectors/subdomains. Do not rerun migration to roll back.

Gmail bechirobob@gmail.com now has two confirmed Send As identities:
- BeCore Tickets <tickets@becoreops.com>
- Benjamin Bob Bechiro <bechirobob@becoreops.com>
Both use smtp.resend.com:587 TLS, username resend. Dedicated sending-only Resend key restricted to becoreops.com named BeCore Gmail SMTP is configured in Gmail and encrypted as GMAIL_SMTP_RESEND_API_KEY in GitHub Actions. Production RESEND_API_KEY was not replaced. No credential values are recorded here.
Reply setting changed and rechecked: Reply from the same address the message was sent to. Existing personal Gmail default sender preserved.

Inbound end-to-end evidence:
- Google confirmation to tickets@becoreops.com reached owner Gmail through cloudflare-email.net, Gmail message1a0a7d99deaff4ef at01:34UTC.
- Google confirmation to bechirobob@becoreops.com reached owner Gmail through Cloudflare, message1a0a7db9b107ff1a at01:36UTC.
- Both incoming messages passed SPF/DKIM/DMARC at Gmail. Both confirmation links completed; Gmail settings lists both active SMTP identities.

Outbound end-to-end tests from Gmail to owner Gmail:
- BeCore Tickets — Gmail sender test: Gmail1a0a7dd4b683c50a; Resend d48732ca-564a-48a6-a245-4e0749b253cf, delivered.
- BeCore personal email — Gmail sender test: Gmail1a0a7dd9c0705257; Resend bcbed806-4030-43ab-a879-6704bb215e99, delivered.
Resend Emails page confirmed both delivered alongside the recovered paid ticket receipt. No messages sent to third parties.

Ops workflow restored to original read-only status in commit eb51545d67c900d922cf0c904d804dda4e65b270, blob2207b32b2e4c5528dac38c3e6fe98d0991569c1a. Migration script remains on ops branch for audit evidence; avoid rerunning without reading current configuration.

Gmail mobile handoff: use existing Google account bechirobob@gmail.com, refresh inbox, Compose > From dropdown to choose either BeCore address. These are forwarding/send-as identities within Gmail, not standalone IMAP accounts. The user's actual phone UI has not been inspected. Historical Dynadot mail remains there; only new incoming mail now forwards.
