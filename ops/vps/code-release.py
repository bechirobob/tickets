#!/usr/bin/env python3
"""Explicit Tickets VPS release with narrowly reviewed database changes.

The CI verifier binds successful main-runtime and browser runs to exact Git trees.
The host transaction runs under the existing deployment lock, keeps private rollback
snapshots, and never edits the private credential bridge or original handover fields.
"""
import argparse
import copy
from contextlib import ExitStack, closing
import fcntl
import hashlib
import json
import os
import pwd
from pathlib import Path, PurePosixPath
import re
import signal
import sqlite3
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

SHA = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"[a-f0-9]{64}\Z")
NUMBER = re.compile(r"[1-9][0-9]*\Z")
HOST = "tickets.becoreops.com"
SERVICE = "becore-tickets.service"
ORIGINAL_TRANSFER_REVISION = "8a46eeaae8296ab588104ea2406f5287c08e5fb6"
ROUTES = (("/", 200), ("/events", 200), ("/api/public/events", 200),
          ("/api/version", 200), ("/api/admin/events", 403))
# Keep the one-hour safety margin unless the exact retention policy and stable
# topology prove continued protection across every deployment/rollback snapshot.
RETENTION_SAFE_AGE = 2 * 86400 - 3600
RETENTION_MAX_ENTRIES = 128
RETENTION_HASHES = {
    "retention.py": "2df470525d55bc8d69a3c45402e28a12a9b17dfa66f2eb477789cb207a043134",
    "becore-tickets-retention.service": "89a312bbe7c96886530c05f0a253dbc388dd5bcb3696bbb79e11489aef84379b",
    "becore-tickets-retention.timer": "94d560a6cbe162529ee750e7fb67d987c5dbd62fe5a898f1476efb97bbfc1699",
}


def retention_identity(info, directory=False):
    fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid")
    if not directory:
        fields += ("st_size", "st_mtime_ns", "st_ctime_ns", "st_nlink")
    return tuple(getattr(info, field) for field in fields)

# Only individually reviewed blobs below may extend the application/runtime or
# create additive tables, plus one exact owner-requested public host label fix.
# Handover, routing, service units and arbitrary scripts remain outside this
# operator. Existing customer rows are never rewritten.
APPLICATION_FILES = {
    "app/api/payments/initialize/route.ts", "app/checkout/[slug]/checkout-form.tsx",
    "app/checkout/[slug]/page.tsx", "app/globals.css", "lib/seevplus.ts",
    "app/checkout-preview/page.tsx", "app/checkout-preview/preview.css",
    "app/api/payments/preview/route.ts", "lib/checkout-preview.ts", "lib/retired-checkout.ts",
    "cloudflare-env.d.ts", ".dev.vars.example", "README.md",
    "scripts/browser-worker.mjs", "scripts/prepare-seev-browser-fixture.mjs",
    "playwright.seev-crypto.config.ts", "package.json", "package-lock.json",
    "ops/vps/code-release.py", "ops/vps/test_code_release.py",
    ".github/workflows/tickets-code-release.yml",
    ".github/workflows/tickets-release-operator-checks.yml", "mobile/package-lock.json",
    ".github/workflows/candidate-checks.yml", ".github/workflows/tickets-backup.yml",
    ".github/workflows/tickets-vps-diagnostics.yml",
}
# Exact reviewed application outputs for the app-experience increment. This is
# deliberately a blob manifest, never an app/**, runtime/** or db/** wildcard.
# Operator transport may advance while the already-verified application stays pinned.
# These pins validate staged operator bytes; they do not expand application approval.
REVIEWED_OPERATOR_BLOBS = {'ops/vps/runtime_release.py': '043e310a41ff28d23adc20383c88566b181232a6', 'ops/vps/test_runtime_release.py': '210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14', 'ops/vps/public_runtime_guard.py': '9a9739f1bd88cbd02dc420001efa3de5b85e3538', 'ops/vps/test_public_runtime_guard.py': 'eb1fd8a6909c7c0634326da1d35c7a4606fbebe7'}

# The independently staged control baseline retains these older test/producer
# files; the application candidate must still match REVIEWED_APPLICATION_BLOBS.
REVIEWED_CONTROL_BLOBS = {
    ".github/workflows/vps-runtime.yml": "06d83690ed40675dae9f5e423cfcc73b3022fc1f",
    "ops/vps/test_runtime_packaging.py": "c7bb8a5bdb6a17c547a29d1289d15bdce4a57228",
    "tests/test_audit_release_source.py": "9d987c3d720d119d1bc3834d04af20a1e8efdc6c",
}
EMAIL_RELEASE_BASELINE = "4ec84f8645e237596129669205565eb214b6e09e"
RESOURCE_RELEASE_BASELINE = "5e1b1aada332d8ce4986c26291594a929aa95d53"

REVIEWED_APPLICATION_BLOBS = {
    "app/admin/operations/organizer-activity.tsx": "c4ad962d9b1d3d9d13817f88c7673a6fda850aea",
    "docs/reliability/event-capacity.md": "4bca03f5553f6363de9c34db808bebe4a3936bae",
    "lib/flashes.ts": "94c8df484d3872ff60d2ff46ebc093edd82d280b",
    "tests/flashes.test.ts": "694627fbedeafaa80e0e6cb61513450b667b2142",
    "tests/organizer-activity-polling.test.mjs": "6cd0bf5c0b30953f8b9eb917c646b6a49e010527",
    "tests/room-abuse-boundaries.test.ts": "df61c41a01867ceebf123216e16e6c10f7c2bd3d",
    "tests/the-room.test.ts": "9431b1eb7231a2e36382d351441c1b3034366096",
    "tests/vps-operations.test.mjs": "a8fe59356a29502889fd2af41f3338225582f556",
    "tests/d1-recovery-privacy.test.mjs": "a88e879d0fdb6f00160a58fcd1cb077631e70fbf",
    ".github/workflows/d1-recovery-rehearsal.yml": "aea42d1acb19d54cbe9beba2962aed6c98ac3312",
    "tests/e2e/operations.spec.ts": "ed96abb5806f4c1464a36a3608fa9d19fd4cd406",
    "tests/webhook-signatures.test.ts": "3645102ec5e8bc978ce9735ab34ef6e06e568bd7",
    "tests/test_audit_release_source.py": "6516f3f4b8582d3874ceda34e1fc3e3b799fec8d",
    "tests/test_audit_release_dependencies.py": "6983998bf40fc1cb424e6dafbb7ba35e5653336d",
    "tests/support-email-rendering.test.mjs": "e36cd295c753c5a28d5056a9ef33794d4c3216b4",
    "tests/scanner-session-client.test.mjs": "3d2665434fbb95d2329dc8370c57368e153ce16b",
    "tests/scanner-manifest.test.ts": "caa44fd148e41523f73219ffda5bf50c6efcfad7",
    "tests/public-catalogue.test.ts": "0eb2322754693cd8c62d433e6f0ccf25954e635a",
    "tests/organizer-scale-audit.test.ts": "a4be4dcfb4d5c4a104724b95bfc4687b7a75dd80",
    "tests/mobile-ui.test.mjs": "e5d555bfb255df96eb84aa1c73dc5c392b686d2f",
    "tests/gate-checkin.test.ts": "c0a046f6a8b5b68f380487890d614ef4c915c187",
    "tests/e2e/room-identity.spec.ts": "abab7debc8ff8acfcbe1fea21d2b109b845cd647",
    "scripts/verify-audit-release-source.py": "129d7bdbd2d631ad385a9edd7be4ea9895f173cf",
    "scripts/audit-release-manifest.json": "bcb787e744f9fc5fc201e8068d553c1543b35b86",
    "scripts/audit-release-dependencies.py": "47c7951e8db95ac666680bd2bf32fde3f1748c8e",
    "ops/vps/test_release_approval.py": "48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f",
    "ops/vps/test_code_release.py": "1c5031c9814796eefca72e9161c0c94869101862",
    "lib/scanner-manifest.ts": "028a2afad115457be51346042067dcf82b07b453",
    "lib/rsvp-analytics.ts": "fde1d556cacef67729a338d85773f0336a85486d",
    "app/privacy/page.tsx": "199d44965922d56d9d1f53947ecaf0aa72a8dc0a",
    "app/hosts/[slug]/page.tsx": "04228bb8dd93a831d1a608b0b42c59340ed9a86d",
    "app/api/organizer/analytics/route.ts": "411aac48caa2686c4480ddca4eee8221586ac996",
    ".github/scripts/verify-audit-control.py": "87cd21e095c76efc9e607484b8c0836db9bc58b5",
    "ops/vps/test_release_source.py": "ec8a7a5bbbe585941583f50624823b85ec51e586",
    "scripts/checkbox-hotfix-audit-policy.json": "7447247befa4b9ef0a274b27352afdce690e9e1e",
    "ops/vps/test_runtime_workflow_contract.py": "eef0b25e667f6be123c0ed6c5bca774158d390d8",
    "tests/repository-boundaries.test.mjs": "afba870d14a247872286ed7006cb31184a6eb465",
    "tests/preview-data-inventory.test.mjs": "35f897420e6afe6b50c4bfa8aedd6eeeb370283d",
    "scripts/inspect-preview-data.mjs": "e6c8e9f07262a8088d6daca199e69a6f24c46af5",
    "scripts/inspect-vps-handoff.mjs": "88c049b7357ee319222580d0de63fd079c07ab98",
    ".github/workflows/tickets-handover.yml": "5bef3d7019966a548ef4ae515a0309d9ff6e2847",
    "ops/vps/test_public_runtime_guard.py": "eb1fd8a6909c7c0634326da1d35c7a4606fbebe7",
    "ops/vps/public_runtime_guard.py": "9a9739f1bd88cbd02dc420001efa3de5b85e3538",
    "tests/test_caption_source.py": "6871fcc1ab410acaa74d8bd953ac9e0e61f4f670",
    "scripts/caption-source-manifest.json": "1b178a1a371ae047f8bf26498d249e272c11497d",
    "scripts/verify-caption-source.py": "fa474c5d8cfaad8df53e77004c063e1511ed0b68",
    ".github/scripts/verify-caption-control.py": "19366f37243794bba916dd6cff0b7731aaec8f1c",
    ".github/backup/backup_release.py": "64330f28dd1561fa591efd6582704285348af1ea",
    ".github/backup/test_backup_release.py": "cd805866b06b0a70ab3bf384db19990d96a0dffd",
    ".github/workflows/backup-transport-checks.yml": "7e32458428475121554f43c8a3f646e70d11161e",
    ".github/workflows/deploy.yml": "e90f3ab46d499cfe6a03f859452046ca3a026993",
    ".github/workflows/tickets-backup.yml": "d26451d3b3c4bb7df29be854a71878b76416fb0e",
    "ops/vps/test_runtime_packaging.py": "6f215f441ff1d9b92b3c870a6f438a54e5ccc1a1",
    ".github/workflows/tickets-code-release.yml": "808e8014f7af281b3370e411be1f6a3808d2e88b",
    "scripts/audit-analytics.mjs": "e8da0ec9f7ef0e9c857c60b059ebaabbc1710baf",
    "playwright.config.ts": "458baa39707043948474dae29bd5341c7ea5a883",
    "ops/vps/test_candidate_evidence.py": "f63544c3ea061f75db1f544c85cddaae109a0f4e",
    "ops/vps/test_runtime_release.py": "210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14",
    "ops/vps/candidate_evidence.py": "d65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba",
    "ops/vps/runtime_release.py": "043e310a41ff28d23adc20383c88566b181232a6",
    ".github/workflows/tickets-release-operator-checks.yml": "e1674c3407ac586aeaf67a2166a9ad32c7cd5bef",
    ".github/workflows/vps-runtime.yml": "3041cf9b68ba250429e8f58e5404d10b2f9330a0",
    ".github/workflows/browser-audit.yml": "3f99ab138e84a9dbd9c0b0cf36a4c5e5300b16a3",
    ".github/workflows/candidate-checks.yml": "dc127e63338b3ac2f8498a2114fe7a465c64344b",
    ".github/workflows/dependency-security.yml": "dc3be8220217d4c6db65549d4e179374cd2b5fda",
    ".github/workflows/full-audit-capacity.yml": "67ea27fb202cf216596bd27d73e51515f656b19c",
    ".github/workflows/tickets-readiness-audit.yml": "f47378c33914b0005ec15598fb0f9110d6882c6d",
    "README.md": "d104e3598aadc56d2d410dedf7c25b95570bc90c",
    "app/access-polish.css": "d565de3c7a828d9c415421a2ec954128cdf0fad6",
    "app/account/privacy/privacy-settings.tsx": "b524f8c52b370bff99c6eadd09b9e44a567f3151",
    "app/active-night-experience.tsx": "7627990fbd1f6fbb15a340ae1c01a7421164a5e8",
    "app/admin/layout.tsx": "d66e9b510543e73deb36c7d56b39dac83b60afa2",
    "app/admin/login/login-form.tsx": "ee7957582f7e959106766fb4b418f6524766d386",
    "app/admin/operations/event-operations-hub.tsx": "5f76745b78170bcaa8b4b59a8a41d4acd3ab4c83",
    "app/admin/orders/order-operations.tsx": "4595067c2c8c9eebd2c824d711ab9b80357d5e26",
    "app/admin/orders/page.tsx": "358e1bc0a8b75d8e2036ff0217e03e3d8a690f61",
    "app/admin/orders/provider-case-form.tsx": "d4070f19c7ff040b80b5b898720a2b6f4821ae94",
    "app/admin/orders/provider-tracking.css": "94b8fc95e2d3c314039913f4a32fe7f834adcd9b",
    "app/admin/recover/recovery-form.tsx": "ff13d13d262994352f6075fc939ffbecffa23cf9",
    "app/api/admin/accounts/route.ts": "39d1045033f62f4adf3d3bb9923ab7eb582209fb",
    "app/api/admin/audience/route.ts": "afd964f61a4562b9645bbbe6dc80c3ca73e0721e",
    "app/api/admin/bootstrap/route.ts": "eee09caf675f70c541fc44be3d439dae252279fb",
    "app/api/admin/campaigns/route.ts": "ab71777a32bee7da2587fef31c349fd255926ada",
    "app/api/admin/check-in/route.ts": "30cc38853eb7025a07ceb4f8b85b0fe1b2e640a4",
    "app/api/admin/door/route.ts": "daa101c2705f7840713d999ebd28dfc59c548f49",
    "app/api/admin/events/removal/route.ts": "b96e133d328b61ab595e44a01b835b6c110d6c15",
    "app/api/admin/events/route.ts": "9ce5f1ad64d193390c43102c3de112aaae1375d4",
    "app/api/admin/host-applications/route.ts": "42eec212b69a889c142c342b8fd1d5770b2687fd",
    "app/api/admin/operations/route.ts": "3bb93ada96792a026e88ce23758a74c679a974dc",
    "app/api/admin/orders/route.ts": "445a090d14b9899721901ec067a88393e2b2de89",
    "app/api/admin/organizer-activity/route.ts": "55e329829de87408906533f878872c9b9e3b3a4b",
    "app/api/admin/organizer-invitations/route.ts": "d09f93e647bfc0cbbb964652fc42dde1956b99bc",
    "app/api/admin/passkeys/route.ts": "45400f1c39e84a30385bba9447096c3af12783f9",
    "app/api/admin/promoters/route.ts": "691f389e6acfd5c123c34e1559047a22e5b5020c",
    "app/api/admin/recovery/route.ts": "9f5835d36613c643125f066cd55b66dba3a857f5",
    "app/api/admin/registrations/route.ts": "4620df0aaf3ac2167a45d2af5a204fa5ee3ca52f",
    "app/api/admin/rooms/route.ts": "c6205c1e216d3dc27c7cfdcf3144fc3ad4070d65",
    "app/api/admin/session/route.ts": "8e068ea9a269991b3a2d30b621ad35684cb33723",
    "app/api/admin/submissions/route.ts": "9449f177f04e05d1c3d4dff1564072b11e288010",
    "app/api/admin/support/route.ts": "4f43a1e69eb7cf7c1a3f3922b5cbf67afd7b3471",
    "app/api/analytics/route.ts": "b4ff36aba06b9fbd5f56bbbcbb0572388832dd8d",
    "app/api/announcements/unsubscribe/route.ts": "df474780f499a18c561f2a957253b7dc9a01aecb",
    "app/api/config/booking-fee/route.ts": "1ed72177a2a34fbfb20124965f95da977492e886",
    "app/api/customer/experience/[slug]/route.ts": "160798eefef97900258aedcbd06e2c0e075fc475",
    "app/api/customer/notifications/preferences/[slug]/route.ts": "609e4daac5e8d070c897ac90d75fca6e51e386d5",
    "app/api/customer/notifications/route.ts": "02de8003b110c8add50f2d75d024a44e15164e5d",
    "app/api/customer/notifications/subscription/route.ts": "0caa626c7e4280f9996f4b31b2a4e973fd541d09",
    "app/api/customer/notifications/test/route.ts": "9c19d117ecae64463ae5d2391b2429ae965e283d",
    "app/api/customer/preferences/route.ts": "a37a2b56facb1c370f6c43280ddceb8e771094cb",
    "app/api/customer/privacy/route.ts": "627451c277db3d9f1a6c4f07ea5b7ecc9165b712",
    "app/api/customer/recovery/claim/route.ts": "382a3980cb5008ac9c5b039ed85c5154d33f1e99",
    "app/api/customer/recovery/route.ts": "10bb37768f07aa33c092939ce7924a00ca572a01",
    "app/api/customer/registrations/route.ts": "975428e5c4b3d8da9931a8cceaaae01efbbe8b80",
    "app/api/customer/returns/route.ts": "2a7a3b5b5b44a7e3b21ec51d667ae5c9b2513911",
    "app/api/customer/session/route.ts": "b20f8da2dc415e02b0005c33dccbff1c1d969ba6",
    "app/api/customer/support/[slug]/route.ts": "dffd32322c1e870878fb5b8915f03b313d1d26c7",
    "app/api/customer/transfers/claim/route.ts": "a7180053b01388293d0d344788876a3bb875bab5",
    "app/api/customer/transfers/route.ts": "1059a16f04eb7be618431ae2b354c805950083c1",
    "app/api/email/webhook/route.ts": "41d92572f62ef1526e52bdd69f97577b78c21c66",
    "app/api/host-applications/confirm/route.ts": "7931324a2f6af90cd327a437512ffe61f02f8fdf",
    "app/api/host-applications/route.ts": "8674d37bd4187de02526eeb39e7d88d09cb01b83",
    "app/api/media/[id]/route.ts": "0a2abe456d7a0fc4d6b4d32d036fbff12a51e02f",
    "app/api/organizer/activate/route.ts": "241596207d77a14eb3878c449252fb419febda62",
    "app/api/organizer/assistant/route.ts": "a6f27a7d6e9bbcb535fb4394e83d41a6a0a225bd",
    "app/api/organizer/business/route.ts": "b38ea5b0afc3e21713fb658890370e2f88f64472",
    "app/api/organizer/reports/route.ts": "9ce231e9df04ca00c6cd80c2011185e250622481",
    "app/api/organizer/team/accept/route.ts": "6726cc0bf08a38878540f4dd54c83c8e0e6c7648",
    "app/api/organizer/workspace/route.ts": "27e4f7dc7ce6c33b7fc19695614462f31f7a0ec4",
    "app/api/payments/initialize/route.ts": "cfc6959b3470d9527db619c9839467cd39260d99",
    "app/api/payments/quote/route.ts": "9b483e873c82a3c2dccddfba55fa455a06c1386d",
    "app/api/payments/seevplus/webhook/route.ts": "bfe1b94c32768cf5689c823195f0fd1e45064d68",
    "app/api/payments/webhook/route.ts": "9197d6f67bcd7d172e2d344c744ba77012efda3f",
    "app/api/promoter/route.ts": "9037908c9b60c828b79136674289b9fe48e221e2",
    "app/api/public/events/route.ts": "7893a675d91939964c96808f30b87d1a71aeb26a",
    "app/api/registrations/claim/route.ts": "9a8c644ab2997d7ab4aa531d8fb9628b5bb5ab7c",
    "app/api/registrations/route.ts": "26d98c17de234463f16d08ec63a9c5d91f2dc1be",
    "app/api/rooms/[slug]/block/route.ts": "c539eaf68f271bebc5bb0c5a125fbf71bd67c2af",
    "app/api/rooms/[slug]/flashes/[id]/report/route.ts": "67afcc73600e25a221bc39960d84d19d3027257d",
    "app/api/rooms/[slug]/flashes/[id]/route.ts": "2f38f44cd8f938c38190ca8c4707402877ea6635",
    "app/api/rooms/[slug]/flashes/route.ts": "5810834ccc987c3ba329db3e9399bab445da0bfa",
    "app/api/rooms/[slug]/report/route.ts": "c7ac4e96365c1ad32320ffb8f47e451bc07aa837",
    "app/api/rooms/[slug]/vip/route.ts": "cfde6eff9677c70bd92e25c612119ad1203850c7",
    "app/api/submissions/route.ts": "b756b05cc321fcc6cfa6680a9981d4b037b940a2",
    "app/api/waitlist/route.ts": "0c11daf732b8ab7924816537c8f43ebb3d1226db",
    "app/api/wallet/apple/v1/devices/[deviceLibraryId]/registrations/[passTypeIdentifier]/[serialNumber]/route.ts": "53d429c88170cea0cb376c25d8dbdb84febc3abc",
    "app/api/wallet/apple/v1/log/route.ts": "3fbfc4213812e6066d3d44177762f4ee7a5ff567",
    "app/customer-dock.tsx": "18a4264821dd0af9700f88edc046a109ef458ab0",
    "app/discovery-back-link.tsx": "1b4ca8d4348b1a940c18b1aa9327a8a764b4c631",
    "app/discovery.css": "1a7f0dd172987dcc84c156dac0685237cbcb1e94",
    "app/event-explorer.tsx": "27c001bd0ba7742b251a7f03252c3dbaf5b2a3fe",
    "app/event/[slug]/event-screen.tsx": "3700cc0de1f68a63912d9caf428d48908ee266e4",
    "app/event/[slug]/page.tsx": "cc0bb5b17c3f7bae00c02a2b82c065cc8b991387",
    "app/globals.css": "4ac15d8e4cc0a372123c4309443fd056c74fef92",
    "app/help/help-centre.tsx": "ab497ef8bce6a41b168d31d9b94fc1a8dc4b4e97",
    "app/home-screen.tsx": "b629019108100f15889edaccd6ac1ee21d4e436d",
    "app/hosts/page.tsx": "f5d2b1129968ba51dc95a6208a408e60f200b05b",
    "app/iphone-interface.css": "3dd3b6b529819123cbc6fa9e71f48a95b193cb1d",
    "app/layout.tsx": "e2b08c91b28ba40311d18723796d9c7e035db2ae",
    "app/mobile-app-frame.tsx": "33559c6475f4b025e821b33c13d55a5b062391e9",
    "app/mobile-navigation.tsx": "cc9e7844b263a473f590b749de26c9c4d91d0773",
    "app/my-nights/[slug]/night-hub.tsx": "ffda3dff3c3fa47e4b3805873298a36681dbb487",
    "app/my-nights/my-nights-client.tsx": "f337d0fe7a5837ecb0447689dc92f5322aefab8d",
    "app/organizer/activate/activation-form.tsx": "bb4014c48d2f84e7e7d865f85bf744cccc05bc65",
    "app/organizer/analytics/organizer-analytics.tsx": "c89f3ca78804491b5fec4048d7aa049b9146b011",
    "app/organizer/join/confirm/confirm-application.tsx": "6aa1f5de46680858a77c69673d032ec24630d512",
    "app/organizer/layout.tsx": "64f7c8b3f26dc0b06ad9fe7dbe6a729d5477fa99",
    "app/organizer/team/accept/accept-invitation.tsx": "f629b25c9bf1dd0440a036a54777f04a20ba5c34",
    "app/organizer/workspace/host-start.tsx": "5bbea7dfe02494f50630a4fec30d0ee26fe02185",
    "app/organizer/workspace/organizer-suite.tsx": "862a58d8943098467ae3f8bfb026d3ce4201eea8",
    "app/organizer/workspace/page.tsx": "13657322abdb8645e203ac6e1b3ea982de2332f3",
    "app/organizer/workspace/suite-promote.tsx": "3cf32f511abc810e8758346a929f011ec55f99c5",
    "app/organizer/workspace/suite-records.tsx": "418120b13234eee93fd9f43d9225a3557035555c",
    "app/payment-footer.tsx": "bd75bc7b041ebe776877a668a6417a787f020e98",
    "app/promoter/promoter-portal.tsx": "a3a61075a0d532c1f027cb05f723c6f88e8dbf0c",
    "app/public-browsing-memory.ts": "00d86692aaae040fb6932429220166fc5f48a304",
    "app/registration-form.tsx": "b797f6cf18ec325cff23ea5f33c59067b9055ae8",
    "app/registration-manager.tsx": "cd0b22d16d2ff9bd45adbd917744a3248e2cb04e",
    "app/room-demo.css": "c3d871ed75945a72df7fb32f7c13c962ee4876de",
    "app/room-overlay.tsx": "97d273e63be52e8154925512524d25062237d69b",
    "app/room-preview-carousel.tsx": "c77a4021be9ea6c29b6a8215e49326f2522e9491",
    "app/room/[slug]/room-client.tsx": "043000a1a4d51ea07acd170046f4898894a3945e",
    "app/rsvp/[slug]/page.tsx": "40ba4869d74f15e722834a9e682bc0867e2b054a",
    "app/rsvp/access/page.tsx": "38bfb0e70087a3e07fc2cd0d1995e10eaa2fcb22",
    "app/scan/layout.tsx": "d66e9b510543e73deb36c7d56b39dac83b60afa2",
    "app/scan/page.tsx": "345bc4e0eea838c4ae89ad87f24e6d90e6881716",
    "app/scan/scanner.tsx": "1a1605c9297f782f61a2dfcc1c955796f7f04c74",
    "app/segmented-control.css": "b4b85d7656046b56447728a292b2f70e30127c14",
    "app/segmented-control.tsx": "d68e0038b37928467b25f62780a91ffd61b82eac",
    "app/support-email.tsx": "8a33cb8253de5cad772974c3684bc44409f757f1",
    "app/terms/page.tsx": "419f0978b0e03084cc99738a6404c3f132f93bef",
    "app/use-header-panel.ts": "24a3e6e3fb54ed67b28c348d77f1b92e60310448",
    "app/use-layer-history.ts": "8f6421c896a29e90ff1f2bd5742f677c6543a2d2",
    "app/use-room-demo.ts": "7ea2ec4191b5f5b9dff10cdfa2925a69514a434f",
    "app/workspace-chrome.tsx": "aee4d182363215c729e840aeebc3f3c47efcb908",
    "app/workspace.css": "8c3881d31c50a13246219e74262c27b542e36880",
    "db/schema.ts": "0edec94f9c2b304fd0930dfc099a4c0ec9a81e78",
    "lib/admin-session.ts": "57fa1b554bf27a8aa3759871017b721e682488df",
    "lib/background-health.ts": "4793c1cd2a5204371e75495d9d1b218f24a0a092",
    "lib/customer-screen.ts": "9546a787d811e4a8351e16e30693639c26743b26",
    "lib/email-delivery.ts": "5c047c09cc05fe4260e91e59d90b7afaa4037e3b",
    "lib/event-guest.ts": "376bf08ff8b52898a4bbc3ab913ea0350134d1db",
    "lib/operational-finance.ts": "7e910e7765074c174695ca32338dee0fd9ae0681",
    "lib/operations-exceptions.ts": "ad4ba837129ba67ffa08745bdb3ff6ea4c838800",
    "lib/organizer-team.ts": "0214111d285e2bb19ee95af1934df68307126919",
    "lib/payment-operations.ts": "91ece2502c7422141c40d9c15ac5c1c69f93f541",
    "lib/provider-operation-tracking.ts": "63288d84fa93f0a97ee01909a68a654272151cbb",
    "lib/registration-draft.ts": "633cdb6e22cb28a1c8002fab96da0bf9fe6eb91b",
    "lib/registration-guidance.ts": "16bf24b5c2c23fa18e1dd16d14563cbed33164b2",
    "lib/request-body.ts": "3a948295f1551a837bd71e6cb45b46548db38c27",
    "lib/scanner-sync.ts": "68d45f670f1cf1d3a26c9ff10c5fbdbf21bb8243",
    "mobile/src/adapters/navigation.tsx": "475edbb849c70e265e5fbdff6931511b40138f52",
    "mobile/src/screen-catalogue.ts": "3c7030e0374696f31af397e7970be77173418194",
    "mobile/tests/app.spec.ts": "30b9a4d88b7f424d4cc95a00b452a81df6cc30b1",
    "mobile/tests/screen-catalogue.test.ts": "2fa5352cac4af250d6ac5a85cf880b0630020d61",
    "mobile/tsconfig.json": "be7802b84428c49a3ddeb14b79373b8cdae64234",
    "mobile/vite.config.ts": "985e6a0bab112aeb54e470a7bd6a34bdeccf0b5e",
    "ops/vps/audit-readiness.py": "69c7dff10fc2b8d1046b84e0a43dbdb4dacb3ecf",
    "ops/vps/test_audit_readiness.py": "086ab0cb48aa88ce934daefb54d60486925d36f8",
    "public/devices/iphone-titanium-front.svg": "9b3995ea6e27f358d03816d603f96466fa8e9acd",
    "runtime/vps/queue.mjs": "22b48966ba3f3a25271425dcb846137fd611f96d",
    "runtime/vps/server.mjs": "bdbea3652bed999a03adfba96df5fcb56dd07c6c",
    "scripts/capture-iphone-layouts.mjs": "4abbb15794097eed900e009c2af956e06b96c340",
    "scripts/iphone-layout-evidence.mjs": "42daec5963ef6da3f1394fe499c79ba53c647a4d",
    "scripts/verify-vps-runtime.mjs": "b44c381a413967d246027d1e8b3573a5f301ccf1",
    "styles/customer.css": "c6d3cc402fcb37287444c9ac75777424ceeac891",
    "styles/workspace.css": "a3e99468e1ad940dfdea923fd535d7421570a2bc",
    "worker/background.ts": "b266dec887de9f00a426ff78ab79ff9bb3af6a3b",
    "worker/security-response.ts": "3d9d92746405583edcd173694d763c868a1b09fd",
    "worker/the-room.ts": "baf738dba9c08cc1390fa6863f2ac5603c04e83e",
    "scripts/audit-checkbox-hotfix.py": "5313d8cdc4076b36d434fe8017cc0e7b4824e876",
    "tests/test_checkbox_hotfix_audit.py": "421ec5fd992b1ba258e357ff4a65f6c3a647d2ce",
    ".github/workflows/booking-consent-previews.yml": "457e562c72109975dfb2d8951230661728861003",
    ".github/workflows/customer-email-previews.yml": "30f85c7bb917a1cb16362d4cfb54fbf2daabca3f",
    ".gitignore": "49c444a761e44c4281baa50238bb18db76405fa7",
    ".npmrc": "c7d351733b3be766847fabaa08cad86a2e746c5c",
    "app/account/privacy/platform-announcements.tsx": "ed5267f34069712533db3ab0aefa78e3ae2f1ee6",
    "app/admin/platform-audience/page.tsx": "ee49f268e4e921da8ae4e99992f80f3d5b0a0f37",
    "app/admin/platform-audience/platform-audience.tsx": "4e1d18c1c5b1f214108055137e3ba739064e056f",
    "app/api/admin/platform-audience/route.ts": "1d7e2c70284e866ece245084f8e70638a6072207",
    "app/api/customer/platform-announcements/route.ts": "e5e739a55196c670deaf7b0bb63893410c936b24",
    "app/api/platform-announcements/unsubscribe/route.ts": "dda4cbf7155d8e38b7ac2d2a601c2ded4e0ca0e2",
    "app/api/platform-announcements/verification/route.ts": "3925d4a3fd992f367f8225f36bd744b6a40f37c2",
    "app/booking-consent.css": "1c0cdd4081d3a6b05dff7e5b909693ba675f5720",
    "app/checkout/[slug]/checkout-form.tsx": "24706bdce798c20926c17e83aeeba485b43f1bb6",
    "app/my-nights/access/page.tsx": "5efa8d87c33e90d72a2364dc94fefff1a27de7e7",
    "app/platform-announcements/unsubscribe/page.tsx": "82bcea344cc03168d3c644ea6ebc34b1a1678fc8",
    "docs/brand-assets.md": "afc5650c6d7a87fbd95388016806b7574f7cb3dc",
    "docs/operations/platform-announcements.md": "62aca09986bd153474a10aaba76e98f1a91c7ed0",
    "eslint.config.mjs": "8e06e124d56d8660b8447b53affeede9c5aec056",
    "lib/customer-email.ts": "206ebfe7f4b8d2dea1ac24b52a62c478a454e246",
    "lib/platform-announcements.ts": "ab09b51f3d547f1451ab7527d85b1d774d5c4c84",
    "lib/policies.ts": "3c9e0b06c569aa8cbb15e0f45a138ca6058a7a3a",
    "lib/preview-cleanup.ts": "dd10b3277598ee7e36f9d5ba4340ec07c231af30",
    "lib/registrations.ts": "67f84900329822eec9466d04ec904e5b5fc7f588",
    "lib/staff-roles.ts": "337c567907f545f0ebf96f840858db02789486aa",
    "playwright.customer-email.config.ts": "88ed1994c64a7253637b9b230620a474e48315e0",
    "public/events/on-the-guest-list-email.jpg": "39c0317539861395953c6c43b4a23ce6851b03f1",
    "runtime/vps/package.json": "e37de887cb29595c07fa90025cb314e978222baa",
    "scripts/build-vps.mjs": "8e4ee60ccaec223f54fd00b6e7a968d706c32f6f",
    "scripts/customer-email-previews.mjs": "afbba02f4a1db052ad830bee1d11c7f6fb2c12a7",
    "scripts/prepare-vps-runtime.mjs": "aa0df8e663887c0db9883a5db744bafbfc7de339",
    "scripts/rehearse-d1-recovery.sh": "f77442363c6bcb271f8e23408755582210b70c81",
    "scripts/vps-runtime-dependencies.mjs": "9dd795c716f196dc61ee7c87db7699bba0fba2e3",
    "tests/customer-email-rendering.test.mjs": "75fbf0237c570d3c75cd4d5ac3db5c18a9f5f601",
    "tests/e2e/analytics-fixture.ts": "26397e2efb63c5871702f686b3fe9b8e4319196b",
    "tests/e2e/booking-consent.ts": "5ec8a675b127a634f27847033c81f5e41957f9d1",
    "tests/e2e/customer-feedback.spec.ts": "28c355219aa8a55e51b429072bff8b031fc3f62e",
    "tests/e2e/guest-clarity.spec.ts": "0601d471b36e783eaa5f2f5bd59d6f279822ac8b",
    "tests/e2e/platform-announcements.spec.ts": "3eae4c200424d882188085a3eed616c10ac7bb46",
    "tests/e2e/private-link-recovery.spec.ts": "e29c198e1d2f0849a638ac624da40552c317a35c",
    "tests/e2e/registration.spec.ts": "2b8f31cdacbab4c8bc29b5459df32b459a5d6f53",
    "tests/e2e/seevplus-checkout.spec.ts": "036e3cb69226bc2b2c8495e85aa18aba98a974a9",
    "tests/email-preview/customer-email.spec.ts": "2259c6dafc53fd38f67a71d950837008b5e39de6",
    "tests/platform-announcements.test.ts": "634c4fee9dc9e7a8facb1933fa8d3ccaaa9d3a19",
    "tests/preview-cleanup.test.ts": "a74cb6ed1b7b66296576a17634ed3ab89f1465e3",
    "tests/registrations.test.ts": "f9e27478b8f1302ff52f9af75f5f7d196a62a2c5",
    "tests/rendered-html.test.mjs": "969c4a6a232f9a62707c94cb67a418aea15bfecd",
    "tests/seevplus.test.ts": "07f1d32312cbd5f97c96ab2998a5aa5e9e84c025",
    "tests/tooling-glob.test.mjs": "dd453061a87de6b8e8469a7d9dd5a97a962d9caf",
    "tests/vps-runtime-packaging.test.mjs": "e280c7dd5b08639a64643fc3eeeeb9f51706a45e",
    "vendor/README.md": "25c88308f0eb356ff1e1a9d390879910ce384739",
    "vendor/eslint-plugin-next/BECORE-PROVENANCE.json": "ead4bc5a6b6d78ba3dc52f6c46183e85162cbf5c",
    "vendor/eslint-plugin-next/LICENSE": "5948ee9bd0de5064423688a2967ab3111c2658ed",
    "vendor/eslint-plugin-next/README.md": "8daceafdd86646b0e128291ae9d8715abb8455d4",
    "vendor/eslint-plugin-next/dist/index.d.ts": "1a5cf5c133e410c7c971773b09cf607c0c21181a",
    "vendor/eslint-plugin-next/dist/index.js": "43f23e94acb482573729da47d6483435f9148790",
    "vendor/eslint-plugin-next/dist/rules/google-font-display.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/google-font-display.js": "340a72229970050d2beafff07d4c40a21af5bf78",
    "vendor/eslint-plugin-next/dist/rules/google-font-preconnect.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/google-font-preconnect.js": "45bb27299f7f46b6a3020b18edc143732d71361d",
    "vendor/eslint-plugin-next/dist/rules/inline-script-id.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/inline-script-id.js": "f18388dd55694bc577b28ee38836daac6c25beff",
    "vendor/eslint-plugin-next/dist/rules/next-script-for-ga.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/next-script-for-ga.js": "42e6be9d98f98727aee94e65137f73eb56790e91",
    "vendor/eslint-plugin-next/dist/rules/no-assign-module-variable.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-assign-module-variable.js": "832af471fa7e8d2aa77870037f883de0f2d4739f",
    "vendor/eslint-plugin-next/dist/rules/no-async-client-component.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-async-client-component.js": "c3e7912ca2b1273854ebd6d2877e48c89328b1be",
    "vendor/eslint-plugin-next/dist/rules/no-before-interactive-script-outside-document.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-before-interactive-script-outside-document.js": "ec25e1ba0ab02308372c150f828a24c2f5e37bed",
    "vendor/eslint-plugin-next/dist/rules/no-css-tags.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-css-tags.js": "a8a65de3c3dca99c08dc3689dc2d9a0b4bcb5457",
    "vendor/eslint-plugin-next/dist/rules/no-document-import-in-page.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-document-import-in-page.js": "f0c30ea619b34fa2bba01fb9bb87a4e8e21958d3",
    "vendor/eslint-plugin-next/dist/rules/no-duplicate-head.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-duplicate-head.js": "059498a31b48e40738bc2c49793d9297adfb5829",
    "vendor/eslint-plugin-next/dist/rules/no-head-element.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-head-element.js": "da9dc8af59e27327a46e3453900ee3f652378106",
    "vendor/eslint-plugin-next/dist/rules/no-head-import-in-document.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-head-import-in-document.js": "3d7403b725791e3c30334494ecb164a0144cbfa8",
    "vendor/eslint-plugin-next/dist/rules/no-html-link-for-pages.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-html-link-for-pages.js": "521a0d9f72117dfa317f12a8b9bea3727bf85cc8",
    "vendor/eslint-plugin-next/dist/rules/no-img-element.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-img-element.js": "59390e79cf8662af0f33dff48b45e0b83166d5aa",
    "vendor/eslint-plugin-next/dist/rules/no-location-assign-relative-destination.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-location-assign-relative-destination.js": "6d66c02f76301a6c80025573d3d6e8911fe2f848",
    "vendor/eslint-plugin-next/dist/rules/no-page-custom-font.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-page-custom-font.js": "8fee398e99e9554cd7da208d7d59cdd0d7db7811",
    "vendor/eslint-plugin-next/dist/rules/no-script-component-in-head.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-script-component-in-head.js": "60129ccc9882ec38053b6b85124a012fe5e218bc",
    "vendor/eslint-plugin-next/dist/rules/no-styled-jsx-in-document.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-styled-jsx-in-document.js": "00b944bb8a8072c12031308a00c3c1ed6f29837b",
    "vendor/eslint-plugin-next/dist/rules/no-sync-scripts.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-sync-scripts.js": "4f0bad5ac84b7a1ff94cdfbfacca5b02cbf33f29",
    "vendor/eslint-plugin-next/dist/rules/no-title-in-document-head.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-title-in-document-head.js": "b766e9b2eeff85d31a4526f69fb0dc1a7e4d7a66",
    "vendor/eslint-plugin-next/dist/rules/no-typos.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-typos.js": "0eded8e676814d57529c895f248f799f9970455f",
    "vendor/eslint-plugin-next/dist/rules/no-unwanted-polyfillio.d.ts": "fe15a8f7f5f821cf3d98e14da3e801905d01e8bb",
    "vendor/eslint-plugin-next/dist/rules/no-unwanted-polyfillio.js": "a69b998ad3085759cea9d7856a4e19530c181a4e",
    "vendor/eslint-plugin-next/dist/utils/define-rule.d.ts": "5b86095100e40b5423ee7cac8f0699061d74a37e",
    "vendor/eslint-plugin-next/dist/utils/define-rule.js": "19b376203c38d05ff1488ef8e4a0144395bdacd6",
    "vendor/eslint-plugin-next/dist/utils/get-root-dirs.d.ts": "870f30593029d190d0f2f62eb55714fe30c2d347",
    "vendor/eslint-plugin-next/dist/utils/get-root-dirs.js": "b42bbc67aa65b22318aeab3038c4e7e91f04622e",
    "vendor/eslint-plugin-next/dist/utils/node-attributes.d.ts": "fe7bae2e8f03584b6813e693010b524f338fc6ae",
    "vendor/eslint-plugin-next/dist/utils/node-attributes.js": "b1f1e6778583c2953cda4185f9754a1cd61ad9aa",
    "vendor/eslint-plugin-next/dist/utils/url.d.ts": "66c9e29743294c340a4bf6b78b53e1a1770bc629",
    "vendor/eslint-plugin-next/dist/utils/url.js": "d1cf29604c4606085e68495ba6d8b1b289fe4506",
    "vendor/eslint-plugin-next/package.json": "35af124dbddd097052d62c1627b50847466e10e0",
    "vendor/tooling-glob/adapter-factory.cjs": "1b25c4dede88f65b2bbe90e97ccc40dc1c75330f",
    "vendor/tooling-glob/index.cjs": "b52c1fe44d40b6f182db46bce87121034b04cb7a",
    "vendor/tooling-glob/package.json": "74fc954227e19a0ba259b063805c798a4092b07c",
    "vendor/vite-plugin-dynamic-import/BECORE-PROVENANCE.json": "0c25dc58edae8342fd91e6195130f01be5e790ed",
    "vendor/vite-plugin-dynamic-import/LICENSE": "d86fcc01951d83a3755fa116a2948b20bfcd06c5",
    "vendor/vite-plugin-dynamic-import/README.md": "d7924deef8e094f19afd6f05c646a6db902f7707",
    "vendor/vite-plugin-dynamic-import/README.zh-CN.md": "6d54dd0646c0a8ea48731e6ba9b3b0f9a4115e71",
    "vendor/vite-plugin-dynamic-import/dist/dynamic-import-to-glob.d.ts": "2b8426f32237884754d5664b40766077758ad639",
    "vendor/vite-plugin-dynamic-import/dist/index.d.ts": "f4be1ccce3bce882aaabdc329c5050e8eefd844b",
    "vendor/vite-plugin-dynamic-import/dist/index.js": "3886f9b34b30facc74c1869fddcc2e715dca45a6",
    "vendor/vite-plugin-dynamic-import/dist/index.mjs": "d13ea6382c6e9761a21801c27a12c86784997624",
    "vendor/vite-plugin-dynamic-import/dist/resolve.d.ts": "341f016c3f4275ac7d8f9d2dcc4a1c77384d78ea",
    "vendor/vite-plugin-dynamic-import/dist/types.d.ts": "a67b7c67f5fcb8e8070ca5e13512fabb31932599",
    "vendor/vite-plugin-dynamic-import/dist/utils.d.ts": "2a077c9dd869dfc676281b226933a24e90d59c44",
    "vendor/vite-plugin-dynamic-import/package.json": "f58737d07a2ba5b613d350921a3d44b519669d35",
    "playwright.seev.config.ts": "1eeacbb76fc58a3d9aa6d1566e1c8870ad2484e5",
    "scripts/prepare-seev-browser-fixture.mjs": "46dfe0aa8f609bc810e128ec006d1c3f3a3c9442",
    "tests/e2e/checkout-quantity.spec.ts": "63118dc45063fdc9d214d1c677846fa47dde0c22",
}
STAFF_OWNER_GUARD_PATH = "drizzle/0060_staff_owner_integrity.sql"
HOST_VERIFICATION_PATH = "drizzle/0059_kofi_bills_verified_host.sql"
# Confirmed in the immutable pre-failure backup and generated from the original
# handover writerGuardStatements(['hosts']). Never remove or disable these guards.
HOST_WRITER_GUARDS = {
    "_bct_guard_hosts_delete": "444b3676092af1ff98b1385bf801469f846cd7453f8b8fb4cda2b45bdc3c9a11",
    "_bct_guard_hosts_insert": "d1735171feb3d6a70de76224d2ad2c8417ce5a64e03e271a406fefba695c4571",
    "_bct_guard_hosts_update": "993741626e1e5f828e1dd1c681fed62e180645e837e0bcf95fa709bdbd7285ce",
}
HOST_WRITER_CONTROL_SCHEMA = "612caa86b3f0bf636dab09beb9c9bdd8b3fa042cc7ed5917dce0fef9c849f591"
REVIEWED_MIGRATIONS = {
    "drizzle/0061_platform_announcement_consent.sql": {
            "blob": "3f0eea14b46ce9bdd7927a1049bfa23ac430f276",
            "sha256": "9bef21dd670e7a87c23e2388538e0ec83fb6fb083d3201df986c0ad13127fbd1",
            "schemaSha256": "0d270a49611676b6608d97aec0adea41a8245947afd861febe2306a10be9b0fd",
            "tables": [
                    "platform_announcement_choices",
                    "platform_announcement_subscriptions",
                    "platform_announcement_unsubscribe_tokens",
                    "platform_announcement_verifications"
            ]
    },
    STAFF_OWNER_GUARD_PATH: {
        "blob": "72a0d09ba331f2e8463782ef016ba16c50a5d471",
        "sha256": "0b790e43fdde094e465f88218fda35d222bbbba8b8f81aaa9e15eeb60737118a",
        "schemaSha256": "3b79658f26d1f08041f51ed864867798771dbb60cd8456699f3451da4f057f2b",
        "tables": [],
        "triggers": {
            "staff_last_active_owner_update_guard": "staff_accounts"
        }
    },
    "drizzle/0057_background_job_health.sql": {
        "blob": "d364b92ad1ab40981729f7fcd5cce862adc8138e",
        "sha256": "8cb7462bfbd7d6f4bdd4e1f8570486b392b8f22018986f6904d818d5e5687293",
        "schemaSha256": "4a8083c4b452cc9840acc9c7de7a7a21bd722044f1cec8429a45b19bcb9fed56",
        "tables": [
            "background_job_health"
        ]
    },
    "drizzle/0058_provider_operations_tracking.sql": {
        "blob": "0b14dbd4ced9acd9111a72dd6aceeb54aae492c4",
        "sha256": "6b26e900ab82b3bcdb2505e2271e83814b41903a31bf6f1cb86737bccfa6a151",
        "schemaSha256": "effd6b20bd1c75692334c6eef40132c784216ea8b7abaa67a140a6073de91c6a",
        "tables": [
            "provider_operation_records"
        ],
        "triggers": {
            "provider_refund_reservation_guard": "payment_refunds"
        }
    },
    HOST_VERIFICATION_PATH: {
        "kind": "kofi-bills-public-verification",
        "blob": "0f3409624ac689c4b0d3ef8cb1c21244283974a2",
        "sha256": "51791db6eb79061c8074c8ff96a0b225aecaca96e30ae21214c7711e7c40564d",
    },
}
BROWSERS = {"desktop-chromium", "mobile-chromium", "mobile-webkit"}
RUNTIME_VERIFY_STEPS = {
    "Verify installed audited dependencies",
    "Stage trusted audit verifier",
    "Verify exact source ancestry before executing checkout code",
    "Verify approved dependency audit",
    "Prepare verified runtime without development dependencies",
    "Publish verified public runtime release",
}
RUNTIME_HANDOFF_STEPS = {
    "Stage trusted audit verifier",
    "Verify exact source ancestry before executing checkout code",
    "Inspect current data and private connection readiness",
}
CANDIDATE_CORE_STEPS = {
    "Verify installed audited dependencies",
    "Stage trusted audit verifier",
    "Check out exact candidate", "Set up Node.js", "Install locked dependencies",
    "Verify exact source ancestry before executing checkout code",
    "Install browsers for event-page verification",
    "Verify exact candidate source", "Audit dependencies", "Lint application",
    "Check application types", "Verify unit tests and rendered production build",
    "Check database schema", "Validate the deployable Worker without publishing",
    "Package verified browser build", "Verify candidate evidence transport",
}
CANDIDATE_BROWSER_STEPS = {
    "Verify and restore the exact candidate build",
    "Prepare isolated event fixtures", "Verify every browser journey before release",
    "Capture natural Room entry before the full browser suite",
    "Preserve natural Room entry evidence immediately",
    "Preserve required Operations visual evidence immediately",
    "Verify keyboard navigation focus without retries",
    "Verify optional SeevPlus checkout on desktop and mobile",
    "Verify opt-in USDC checkout without provider traffic",
    "Verify RSVP and interest registration on desktop and mobile",
    "Verify owner Operations workflows on desktop and mobile",
    "Verify host report fixture recovery without retries",
}


class ReleaseError(RuntimeError):
    """An intentionally non-secret operational failure."""


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key rejected.")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError) as exc:
        raise ReleaseError("Invalid JSON document.") from exc


def digest_file(path):
    result = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def atomic_write(path, data, mode=0o600):
    """Replace rather than follow a link; fsync both file and containing directory."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=".code-release-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def write_json(path, value):
    atomic_write(path, (json.dumps(value, sort_keys=True) + "\n").encode())


def replace_link(path, target):
    fd, temporary = tempfile.mkstemp(prefix=".code-release-link-", dir=path.parent)
    os.close(fd)
    os.unlink(temporary)
    try:
        os.symlink(target, temporary)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def configuration(raw):
    values = strict_json(raw)
    require(isinstance(values, dict) and all(isinstance(v, str) for v in values.values()),
            "Runtime configuration must be an object containing only strings.")
    return values


def enable_crypto_bytes(raw):
    """Change only the selected JSON value's bytes; preserve all other bytes."""
    values = configuration(raw)
    text = raw.decode("utf-8")
    decoder = json.JSONDecoder()
    index = text.index("{") + 1
    while True:
        while text[index].isspace():
            index += 1
        if text[index] == "}":
            addition = ("," if values else "") + '"SEEV_CRYPTO_ENABLED":"true"'
            result = text[:index] + addition + text[index:]
            break
        key, index = decoder.raw_decode(text, index)
        while text[index].isspace():
            index += 1
        require(text[index] == ":", "Invalid configuration separator.")
        index += 1
        while text[index].isspace():
            index += 1
        start = index
        _, index = decoder.raw_decode(text, index)
        if key == "SEEV_CRYPTO_ENABLED":
            result = text[:start] + '"true"' + text[index:]
            break
        while text[index].isspace():
            index += 1
        if text[index] == ",":
            index += 1
    expected = dict(values, SEEV_CRYPTO_ENABLED="true")
    require(configuration(result.encode()) == expected, "Configuration edit was not isolated.")
    return result.encode()


def release_override(raw, previous, candidate):
    """Accept the known scanner unit shape and preserve its comments/formatting."""
    old, new = str(previous), str(candidate)
    expected = ["[Service]", "WorkingDirectory=" + old, "ExecStart=",
                "ExecStart=/usr/bin/flock --nonblock /var/lib/becore-tickets/instance.lock "
                + old + "/bin/node " + old + "/server.mjs"]
    try:
        text = raw.decode("utf-8")
    except UnicodeError as exc:
        raise ReleaseError("Unexpected scanner override encoding.") from exc
    directives = [line.strip() for line in text.splitlines()
                  if line.strip() and not line.lstrip().startswith(("#", ";"))]
    require(directives == expected and text.count(old) == 3,
            "Scanner override has unvetted directives or release paths.")
    return text.replace(old, new).encode()


def git_environment():
    # Candidate-controlled replacement refs, alternate repositories or config must
    # never influence immutable source, ancestry, mode or tree verification.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")
    return env


def git(*args):
    return subprocess.check_output(["git", "--no-replace-objects", *args], text=True,
                                   stderr=subprocess.DEVNULL, env=git_environment(), timeout=60).strip()


def verify_trusted_operator(source):
    """Keep activation bound to an independently selected, merged operator."""
    baseline = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(SHA.fullmatch(baseline) and SHA.fullmatch(source),
            "An immutable trusted baseline and source are required.")
    require(baseline != source, "Source cannot be its own trusted control baseline.")
    operator = Path(__file__).absolute()
    require(operator.is_file() and not operator.is_symlink(), "Trusted operator must be a regular file.")
    trusted_bytes = subprocess.check_output([
        "git", "--no-replace-objects", "show", baseline + ":ops/vps/code-release.py"
    ], stderr=subprocess.DEVNULL, env=git_environment(), timeout=60)
    require(operator.read_bytes() == trusted_bytes, "Operator bytes differ from the trusted baseline.")
    for descendant in ("origin/main", source):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", baseline, descendant],
                       check=True, env=git_environment(), timeout=60)


def verify_approved_source(source):
    baseline = os.environ.get("BECORE_TRUSTED_BASE", "")
    root = Path.cwd()
    path = "scripts/verify-audit-release-source.py"
    require(SHA.fullmatch(baseline), "Exact trusted audit baseline required.")
    entry = git("ls-tree", baseline, "--", path)
    require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(path), entry),
            "Approved source verifier must be a regular trusted blob.")
    raw = subprocess.check_output(["git", "--no-replace-objects", "show", baseline + ":" + path],
                                  env=git_environment(), timeout=60)
    with tempfile.TemporaryDirectory(prefix="tickets-approved-source-") as directory:
        script = Path(directory) / "verify-audit-release-source.py"
        script.write_bytes(raw)
        namespace = {"__name__": "trusted_audit_source", "__file__": str(script)}
        exec(compile(raw, str(script), "exec"), namespace)
        return namespace["verify_source"](root, baseline, source)


def verify_dependency_audit(directory, source):
    """Revalidate private raw evidence immediately before its host transfer."""
    directory = Path(directory)
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700, "Unsafe private audit directory.")
    records = {}
    for name in ("npm-audit.json", "npm-audit.stderr", "receipt.json", "preinstall-receipt.json"):
        path = directory / name
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 8 * 1024 ** 2,
                "Unsafe private audit evidence.")
        records[name] = path.read_bytes()
    receipt = strict_json(records["receipt.json"])
    anchor = os.environ.get("BECORE_PREINSTALL_RECEIPT_SHA256", "")
    require(DIGEST.fullmatch(anchor) and hashlib.sha256(records["preinstall-receipt.json"]).hexdigest() == anchor,
            "Pre-install audit receipt differs from its independently captured digest.")
    preinstall = strict_json(records["preinstall-receipt.json"])
    require(type(preinstall) is dict and preinstall.get("phase") == "preinstall-complete"
            and receipt == {**preinstall, "phase": "complete", "preinstallReceiptSha256": anchor},
            "Final audit receipt differs from the independently captured pre-install evidence.")
    baseline = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(set(receipt) == {"schema", "candidate", "trustedBaseline", "status", "phase", "npmExitCode",
                             "reportSha256", "stderrSha256", "capturedAt", "packageSha256", "lockSha256", "preinstallReceiptSha256"}
            and type(receipt["schema"]) is int and receipt["schema"] == 1 and receipt["candidate"] == source
            and receipt["preinstallReceiptSha256"] == anchor
            and receipt["packageSha256"] == digest_file(Path("package.json"))
            and receipt["lockSha256"] == digest_file(Path("package-lock.json"))
            and receipt["trustedBaseline"] == baseline and receipt["phase"] == "complete"
            and receipt["status"] in ("clean", "known-advisory-exception")
            and receipt["reportSha256"] == hashlib.sha256(records["npm-audit.json"]).hexdigest()
            and receipt["stderrSha256"] == hashlib.sha256(records["npm-audit.stderr"]).hexdigest(),
            "Audit receipt differs from its exact private raw evidence.")
    wrapper = Path(__file__).resolve().parents[2] / "scripts/audit-release-dependencies.py"
    raw = wrapper.read_bytes()
    expected = subprocess.check_output(["git", "--no-replace-objects", "show",
                                        baseline + ":scripts/audit-release-dependencies.py"],
                                       env=git_environment(), timeout=60)
    require(raw == expected and not wrapper.is_symlink(), "Audit validator is not the reviewed operator copy.")
    namespace = {"__name__": "trusted_audit_dependencies", "__file__": str(wrapper)}
    exec(compile(raw, str(wrapper), "exec"), namespace)
    result = namespace["evaluate_report"](Path.cwd(), baseline, source, records["npm-audit.json"],
                                          receipt["npmExitCode"], records["npm-audit.stderr"])
    require(result == receipt["status"], "Audit result changed during final verification.")
    return {"reportSha256": receipt["reportSha256"], "status": result,
            "npmExitCode": receipt["npmExitCode"], "size": len(records["npm-audit.json"])}


def verify_changed_modes(expected, source):
    """No implicit deletion, symlink, submodule or executable-mode permission."""
    raw = git("diff", "--raw", "--no-abbrev", "--no-renames", "-z", expected, source)
    if not raw:
        return
    parts = raw.split("\0")
    require(parts[-1] == "" and len(parts) % 2 == 1, "Malformed source change records.")
    for header, name in zip(parts[:-1:2], parts[1::2]):
        record = re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AM])", header)
        require(record is not None and bool(name), "Unreviewed source deletion or type change.")
        before_mode, after_mode, before_blob, _, status = record.groups()
        require(after_mode in {"100644", "100755"}, "Source must remain regular files.")
        if status == "A":
            require(before_mode == "000000" and before_blob == "0" * 40 and after_mode == "100644",
                    "New executable or nonregular source needs explicit review.")
        else:
            require(before_mode == after_mode, "Source file mode changed without review.")


def vetted_changes(expected, source):
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, source], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=git_environment(), timeout=60)
    verify_changed_modes(expected, source)
    changed = git("diff", "--name-only", expected, source).splitlines()
    for name in changed:
        if name == "ops/vps/code-release.py":
            # verify_trusted_operator already bound these executing bytes to the
            # independently selected merged control commit. No self-hash or
            # generic allowlisted candidate operator may expand that authority.
            trusted = Path(__file__).read_bytes()
            blob = hashlib.sha1(b"blob " + str(len(trusted)).encode() + b"\0" + trusted).hexdigest()
            require(git("rev-parse", source + ":" + name) == blob,
                    "Candidate operator differs from independently trusted staged source.")
            continue
        if name in REVIEWED_APPLICATION_BLOBS or name in REVIEWED_MIGRATIONS:
            reviewed = REVIEWED_APPLICATION_BLOBS.get(name) or REVIEWED_MIGRATIONS[name]["blob"]
            require(git("rev-parse", source + ":" + name) == reviewed,
                    "Application or additive schema differs from reviewed source: " + name)
            continue
        require(name in APPLICATION_FILES or name.startswith(("docs/", "tests/"))
                or name == "worker/handover.ts", "Unvetted source path: " + name)
    if "worker/handover.ts" in changed:
        before = git("show", expected + ":worker/handover.ts")
        after = git("show", source + ":worker/handover.ts")
        original = "'SEEV_ENABLED', 'SEEV_ENVIRONMENT',"
        require(before.count(original) == 1 and after == before.replace(
            original, "'SEEV_ENABLED', 'SEEV_CRYPTO_ENABLED', 'SEEV_ENVIRONMENT',"),
            "Only the vetted crypto configuration-name addition is permitted.")
    # Security-response changes require their exact entry in the reviewed blob
    # manifest above; there is no broad header-policy or path-pattern exception.
    if "mobile/package-lock.json" in changed:
        if expected == EMAIL_RELEASE_BASELINE:
            require(git("rev-parse", expected + ":mobile/package-lock.json")
                    == "49254a20c8b66fa1fd584e00b13b04e8539cab58"
                    and git("rev-parse", source + ":mobile/package-lock.json")
                    == "ebae7283d0906a9cb42b374b78a90986e7fcdcac",
                    "Mobile dependencies differ from the exact reviewed email release transition.")
        else:
            before = strict_json(git("show", expected + ":mobile/package-lock.json"))
            after = strict_json(git("show", source + ":mobile/package-lock.json"))
            package = before["packages"]["node_modules/brace-expansion"]
            require(package.get("version") == "5.0.9"
                    and package.get("resolved") == "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz"
                    and package.get("integrity") == "sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==",
                    "Mobile security patch baseline changed.")
            package.update(version="5.0.12",
                           resolved="https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz",
                           integrity="sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ==")
            require(before == after, "Only the reviewed mobile brace-expansion lock update may change.")
    # Next 16.3.6 security remediation, including npm's reviewed lock metadata.
    # Pin both complete inputs and outputs: scripts, other dependency versions,
    # and every unrelated byte must match this reviewed patch exactly.
    root_dependency_patch = {
        "package.json": ("f5b97ad99e9f3c5c74abfde84ed87b03577b1a24",
                         "dc6e4e1cfa53b05beb3b5f70c7a5d07dd5e07b23"),
        "package-lock.json": ("3916f840669463f8ac586dc25d715456a5d9d0b8",
                              "759d34af76287e214f03def74be98ddefb33780a"),
    }
    if expected == EMAIL_RELEASE_BASELINE:
        # Source registrations are separately byte-pinned above. This exact pair
        # additionally binds every root script, dependency and lock metadata byte.
        root_dependency_patch = {
            "package.json": ("dc6e4e1cfa53b05beb3b5f70c7a5d07dd5e07b23",
                             "83f5e03b9fbbdf10f050c8dd24d06ed1ff59260b"),
            "package-lock.json": ("759d34af76287e214f03def74be98ddefb33780a",
                                  "cc161d4ef33ca9affdf1c6649071cb4bf27b71dc"),
        }
    elif expected == RESOURCE_RELEASE_BASELINE:
        # Next 16.3.8 changes only this exact reviewed pair from the active release.
        root_dependency_patch = {
            "package.json": ("83f5e03b9fbbdf10f050c8dd24d06ed1ff59260b",
                             "91d44944a682f992880c44785d7b14eda9204c18"),
            "package-lock.json": ("cc161d4ef33ca9affdf1c6649071cb4bf27b71dc",
                                  "47a4eaca5743b768598462d8b66a2ef49a442b4e"),
        }
    if root_dependency_patch.keys() & set(changed):
        require(root_dependency_patch.keys() <= set(changed),
                "The reviewed root dependency patch requires both package files.")
        for name, (baseline, reviewed) in root_dependency_patch.items():
            require(git("rev-parse", expected + ":" + name) == baseline
                    and git("rev-parse", source + ":" + name) == reviewed,
                    "Root dependency files differ from the reviewed security patch: " + name)
    return changed


def verify_run(run, *, workflow, source=None, repository):
    require(run.get("status") == "completed" and run.get("conclusion") == "success",
            "Required workflow has not succeeded.")
    require(run.get("path") == ".github/workflows/" + workflow,
            "Unexpected workflow identity.")
    require(run.get("repository", {}).get("full_name") == repository
            and run.get("head_repository", {}).get("full_name") == repository,
            "Workflow repository identity mismatch.")
    require(SHA.fullmatch(run.get("head_sha", "")), "Workflow SHA missing.")
    require(type(run.get("id")) is int and run["id"] > 0
            and type(run.get("run_attempt")) is int and run["run_attempt"] > 0,
            "Exact workflow run and attempt identities required.")
    if source:
        require(run["head_sha"] == source and run.get("head_branch") == "main"
                and run.get("event") == "push", "Runtime must verify exact main source.")
    else:
        require(run.get("event") in ("pull_request", "workflow_dispatch"),
                "Unexpected browser workflow event.")


def require_steps(job, required):
    for name in required:
        matching = [step for step in job.get("steps", []) if step.get("name") == name]
        require(len(matching) == 1 and matching[0].get("conclusion") == "success"
                and matching[0].get("status") == "completed",
                "Required checks were skipped, failed or duplicated: " + name)


def verify_jobs(runtime_jobs, candidate_jobs):
    require(len(runtime_jobs) == 2
            and all(job.get("conclusion") == "success" for job in runtime_jobs),
            "Runtime contains a failed, skipped or unexpected job.")
    require({job.get("name") for job in runtime_jobs} == {"verify", "handoff"},
            "Runtime verification jobs missing.")
    require_steps(next(job for job in runtime_jobs if job["name"] == "verify"), RUNTIME_VERIFY_STEPS)
    require_steps(next(job for job in runtime_jobs if job["name"] == "handoff"), RUNTIME_HANDOFF_STEPS)
    # Build once, then restore those exact bytes before each isolated browser.
    # No inter-job artifact/cache is a substitute for this same-build contract.
    require(len(candidate_jobs) == 1 and candidate_jobs[0].get("name") == "verify"
            and candidate_jobs[0].get("conclusion") == "success",
            "Single-job candidate verification missing or incomplete.")
    required = CANDIDATE_CORE_STEPS | {
        name + " (" + browser + ")"
        for browser in BROWSERS for name in CANDIDATE_BROWSER_STEPS
    }
    require_steps(candidate_jobs[0], required)


def verify_job_identity(jobs, run):
    require(isinstance(jobs, list) and bool(jobs), "Workflow jobs are missing.")
    identifiers = []
    for job in jobs:
        require(type(job.get("id")) is int and job["id"] > 0
                and job.get("run_id") == run["id"]
                and type(job.get("run_attempt")) is int
                and job["run_attempt"] == run["run_attempt"]
                and job.get("head_sha") == run["head_sha"]
                and job.get("status") == "completed",
                "Job does not belong to the exact completed workflow attempt.")
        identifiers.append(job["id"])
    require(len(identifiers) == len(set(identifiers)), "Duplicate workflow job identity.")


def verify_runtime_transport(archive, source, source_tree, runtime):
    # Runner-only import: host apply remains a standalone reviewed transaction.
    from runtime_release import verify_local_receipt
    try:
        return verify_local_receipt(archive.parent, source=source, source_tree=source_tree,
                                    run_id=str(runtime["id"]), attempt=str(runtime["run_attempt"]))
    except Exception as exc:
        raise ReleaseError("Runtime release transport evidence mismatch.") from exc


def verify_ci(args):
    require(SHA.fullmatch(args.source) and SHA.fullmatch(args.expected), "Exact SHAs required.")
    require(os.environ.get("GITHUB_REF") == "refs/heads/main", "Dispatch must target main.")
    require(git("rev-parse", "HEAD") == args.source and not git("status", "--porcelain"),
            "Release checkout must be clean and exact.")
    verify_trusted_operator(args.source)
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", args.source, "origin/main"],
                   check=True, env=git_environment(), timeout=60)
    metadata = Path(args.metadata)
    runtime = strict_json((metadata / "runtime.json").read_bytes())
    candidate = strict_json((metadata / "candidate.json").read_bytes())
    verify_run(runtime, workflow="vps-runtime.yml", source=args.source, repository=args.repository)
    verify_run(candidate, workflow="candidate-checks.yml", repository=args.repository)
    require(str(runtime.get("id")) == args.runtime_run and str(candidate.get("id")) == args.candidate_run,
            "Workflow run IDs do not match inputs.")
    runtime_jobs = strict_json((metadata / "runtime-jobs.json").read_bytes())
    candidate_jobs = strict_json((metadata / "candidate-jobs.json").read_bytes())
    verify_job_identity(runtime_jobs, runtime)
    verify_job_identity(candidate_jobs, candidate)
    verify_jobs(runtime_jobs, candidate_jobs)
    source_tree = git("rev-parse", args.source + "^{tree}")
    require(source_tree == git("rev-parse", candidate["head_sha"] + "^{tree}"),
            "Candidate browser source tree differs from runtime source tree.")
    changes = vetted_changes(args.expected, args.source)
    archive = Path(args.archive)
    checksum = (archive.parent / (archive.name + ".sha256")).read_text().strip()
    require(re.fullmatch(r"[a-f0-9]{64}  tickets-vps-runtime\.tar\.gz", checksum),
            "Unexpected artifact checksum format.")
    digest = digest_file(archive)
    require(checksum.split()[0] == digest, "Runtime artifact checksum mismatch.")
    transport = verify_runtime_transport(archive, args.source, source_tree, runtime)
    provenance = {"version": 1, "source": args.source, "expectedActive": args.expected,
                  "sourceTree": source_tree, "candidateTree": source_tree,
                  "candidateSha": candidate["head_sha"], "runtimeRun": args.runtime_run,
                  "candidateRun": args.candidate_run, "archiveSha256": digest,
                  "runtimeAttempt": runtime["run_attempt"], "candidateAttempt": candidate["run_attempt"],
                  "releaseTransport": transport,
                  "repository": args.repository, "ancestryVerified": True,
                  "changedFiles": changes, "migrations": migration_plan(changes)}
    if getattr(args, "audit_directory", None):
        audit = verify_dependency_audit(args.audit_directory, args.source)
        provenance["dependencyAudit"] = audit
        if audit["status"] == "known-advisory-exception":
            approved = verify_approved_source(args.source)
            require(approved["tree"] == source_tree, "Approved source tree differs from CI provenance.")
            provenance["auditRelease"] = {
                "id": AuditReleaseApproval.ID, "approvedAt": AuditReleaseApproval.APPROVED_AT,
                "expiresAt": AuditReleaseApproval.EXPIRES_AT, "source": args.source,
                "sourceTree": source_tree, "expectedActive": AuditReleaseApproval.EXPECTED_ACTIVE}
    write_json(args.output, provenance)
    print("Exact runtime/browser CI, ancestry, source scope and artifact digest verified.")


def schema_rows(database):
    return database.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema "
                            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()


def schema_digest(rows):
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()


def additive_statements(raw, specification):
    """Accept new tables/indexes and the exact reviewed refund rollback guard."""
    require(hashlib.sha256(raw).hexdigest() == specification["sha256"],
            "Additive migration content differs from reviewed source.")
    # The reviewed migrations contain no comment markers in quoted literals.
    text = re.sub(r"--[^\n]*", "", raw.decode("utf-8"))
    statements, pending = [], ""
    for character in text:
        pending += character
        if character == ";" and sqlite3.complete_statement(pending):
            statements.append(pending.strip())
            pending = ""
    require(not pending.strip() and statements, "Incomplete additive migration.")
    tables, triggers = [], []
    reviewed_triggers = specification.get("triggers", {})
    require(isinstance(reviewed_triggers, dict)
            and all(table == "payment_refunds" for table in reviewed_triggers.values()),
            "Only the reviewed refund rollback guard may target an existing table.")
    with closing(sqlite3.connect(":memory:")) as temporary:
        if reviewed_triggers:
            # Schema-only stand-in for validating the exact new guard. This
            # existing table is never created or changed in the live database.
            temporary.execute("CREATE TABLE payment_refunds (order_id TEXT, status TEXT)")
        existing = schema_rows(temporary)
        for statement in statements:
            table = re.match(r"CREATE TABLE (`[a-z][a-z0-9_]*`|[a-z][a-z0-9_]*)\s*\(", statement)
            index = re.match(r"CREATE (?:UNIQUE )?INDEX (?:`[a-z][a-z0-9_]*`|[a-z][a-z0-9_]*) ON (`[a-z][a-z0-9_]*`|[a-z][a-z0-9_]*)\s*\(", statement)
            trigger = re.match(r"CREATE TRIGGER (`[a-z][a-z0-9_]*`|[a-z][a-z0-9_]*)\s+BEFORE INSERT ON (`[a-z][a-z0-9_]*`|[a-z][a-z0-9_]*)(?=\s|$)", statement)
            require(bool(table or index or trigger), "Only reviewed additive schema creation is permitted.")
            if trigger:
                name, target = (part.strip("`") for part in trigger.groups())
                require(reviewed_triggers.get(name) == target,
                        "Migration contains an unreviewed existing-table trigger.")
                triggers.append(name)
            else:
                name = (table or index).group(1).strip("`")
                require(name in specification["tables"], "Migration targets an unreviewed table.")
                if table:
                    tables.append(name)
            temporary.execute(statement)
        rows = [row for row in schema_rows(temporary) if row not in existing]
    require(sorted(tables) == sorted(specification["tables"])
            and sorted(triggers) == sorted(reviewed_triggers)
            and schema_digest(rows) == specification["schemaSha256"],
            "Migration schema differs from the reviewed additive schema.")
    return statements, rows


def migration_plan(changes):
    return [dict(path=name, **copy.deepcopy(REVIEWED_MIGRATIONS[name]))
            for name in sorted(set(changes) & REVIEWED_MIGRATIONS.keys())]


def reviewed_migration(raw, specification):
    if specification.get("path") == STAFF_OWNER_GUARD_PATH:
        # Only this exact additive UPDATE guard is permitted. Do not broaden the
        # general migration grammar or permit arbitrary existing-table triggers.
        expected = dict(path=STAFF_OWNER_GUARD_PATH, **REVIEWED_MIGRATIONS[STAFF_OWNER_GUARD_PATH])
        require(specification == expected and hashlib.sha256(raw).hexdigest() == expected["sha256"]
                and hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == expected["blob"],
                "Staff owner guard differs from the exact reviewed source.")
        with closing(sqlite3.connect(":memory:")) as temporary:
            temporary.execute("CREATE TABLE staff_accounts (id TEXT PRIMARY KEY, role TEXT, status TEXT)")
            before = schema_rows(temporary)
            temporary.execute(raw.decode("utf-8"))
            rows = [row for row in schema_rows(temporary) if row not in before]
        require(len(rows) == 1 and rows[0][0] == "trigger"
                and rows[0][1] == "staff_last_active_owner_update_guard"
                and schema_digest(rows) == expected["schemaSha256"],
                "Staff owner guard schema differs from reviewed source.")
        return [raw.decode("utf-8")], rows
    if specification.get("kind") == "kofi-bills-public-verification":
        expected = dict(path=HOST_VERIFICATION_PATH, **REVIEWED_MIGRATIONS[HOST_VERIFICATION_PATH])
        require(specification == expected and hashlib.sha256(raw).hexdigest() == expected["sha256"]
                and hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == expected["blob"],
                "Host verification migration differs from the exact reviewed source.")
        return [], []
    require("kind" not in specification, "Unreviewed data migration kind.")
    return additive_statements(raw, specification)


def host_writer_state(connection):
    """Recognize the exact preserved handover guards; reject drift or a freeze."""
    require(connection.in_transaction, "Host writer checks require the migration transaction.")
    guards = connection.execute("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='hosts'").fetchall()
    require(len(guards) == len(HOST_WRITER_GUARDS)
            and {name for name, _ in guards} == set(HOST_WRITER_GUARDS)
            and all(isinstance(sql, str) and hashlib.sha256(sql.encode()).hexdigest() == HOST_WRITER_GUARDS[name]
                    for name, sql in guards)
            and not connection.execute("SELECT 1 FROM sqlite_temp_schema WHERE type='trigger' AND tbl_name='hosts'").fetchall(),
            "Host correction refuses unknown, missing or altered hosts triggers.")
    control = connection.execute("SELECT sql FROM sqlite_schema WHERE type='table' AND name='_bct_handover_state'").fetchall()
    require(len(control) == 1 and isinstance(control[0][0], str)
            and hashlib.sha256(control[0][0].encode()).hexdigest() == HOST_WRITER_CONTROL_SCHEMA,
            "Host correction requires the exact handover control schema.")
    state = connection.execute("SELECT id,frozen,transfer_id FROM _bct_handover_state ORDER BY id").fetchall()
    require(len(state) == 1 and state[0][0] == 1 and state[0][1] == 0 and isinstance(state[0][2], str),
            "Host correction requires one existing unfrozen handover control row.")
    return state


def correct_host_verification(connection, raw):
    """One display-only correction under BEGIN IMMEDIATE, never a general DML runner."""
    require(connection.in_transaction, "Host correction requires the migration transaction.")
    definition = connection.execute("SELECT type,sql FROM sqlite_schema WHERE name='hosts'").fetchall()
    require(len(definition) == 1 and definition[0][0] == "table"
            and re.match(r"CREATE TABLE\s", definition[0][1], re.I),
            "Host correction requires the existing ordinary hosts table.")
    writer_before = host_writer_state(connection)
    columns = connection.execute("PRAGMA table_xinfo(hosts)").fetchall()
    require(all(column[6] == 0 for column in columns), "Host correction refuses hidden or generated columns.")
    columns = [column[1] for column in columns]
    require({"id", "slug", "verification_status", "updated_at"} <= set(columns),
            "Host correction columns are missing.")
    before_schema = schema_rows(connection)
    before = connection.execute("SELECT * FROM hosts ORDER BY id").fetchall()
    identity, slug, status, updated = (columns.index(name) for name in
                                       ("id", "slug", "verification_status", "updated_at"))
    targets = [index for index, row in enumerate(before)
               if row[identity] == "host:kofi-bills" or row[slug] == "kofi-bills"]
    require(len(targets) == 1 and before[targets[0]][identity] == "host:kofi-bills"
            and before[targets[0]][slug] == "kofi-bills",
            "Exact existing Kofi Bills host identity is missing or ambiguous.")
    target = targets[0]
    previous = before[target][status]
    require(previous in ("reviewed", "verified"), "Unexpected Kofi Bills verification baseline.")
    expected = list(before)
    changed = previous == "reviewed"
    if changed:
        earliest = connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0]
        changes = connection.total_changes
        def authorize(action, table, column, database, origin):
            if action == sqlite3.SQLITE_UPDATE:
                allowed = (database == "main" and table == "hosts"
                           and column in ("verification_status", "updated_at") and origin is None)
            else:
                allowed = action in (sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT) or (
                    action == sqlite3.SQLITE_FUNCTION and (
                        (column == "current_timestamp" and origin is None)
                        or (column == "raise" and origin == "_bct_guard_hosts_update")))
            return sqlite3.SQLITE_OK if allowed else sqlite3.SQLITE_DENY
        connection.set_authorizer(authorize)
        try:
            cursor = connection.execute(raw.decode("utf-8"))
        finally:
            connection.set_authorizer(None)
        require(cursor.rowcount == 1 and connection.total_changes - changes == 1,
                "Host correction did not change exactly one row.")
        latest = connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0]
    after = connection.execute("SELECT * FROM hosts ORDER BY id").fetchall()
    if changed:
        require(len(after) == len(before), "Host correction changed the host row count.")
        timestamp = after[target][updated]
        require(isinstance(timestamp, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", timestamp)
                and earliest <= timestamp <= latest, "Host correction timestamp is unexpected.")
        row = list(expected[target])
        row[status], row[updated] = "verified", timestamp
        expected[target] = tuple(row)
    require(after == expected and schema_rows(connection) == before_schema,
            "Host correction changed unrelated host values or database schema.")
    require(host_writer_state(connection) == writer_before,
            "Host correction changed preserved handover control values.")
    return {"hostId": "host:kofi-bills", "changed": changed,
            "beforeStatus": previous, "afterStatus": "verified", "preservedOnCodeRollback": True}


def migrate_database(database, staging, migrations):
    """Service-user SQLite transaction. Never restore, replace or delete live data."""
    database, staging = Path(database), Path(staging)
    metadata = database.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1
            and metadata.st_uid == os.geteuid() and stat.S_IMODE(metadata.st_mode) == 0o600,
            "Live database must remain a private service-owned regular file.")
    for suffix in ("-wal", "-shm", "-journal"):
        path = Path(str(database) + suffix)
        if os.path.lexists(path):
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                    and info.st_uid == os.geteuid() and not stat.S_IMODE(info.st_mode) & 0o077,
                    "Unsafe live database sidecar.")
    reviewed, additions, corrections = [], [], []
    for specification, raw in migrations:
        statements, rows = reviewed_migration(raw, specification)
        reviewed.extend(statements)
        additions.extend(rows)
        if specification.get("kind"):
            corrections.append(raw)
    require(not corrections or len(corrections) == len(migrations) == 1,
            "The exact host correction must be the only migration in its release.")
    names = [row[1] for row in additions]
    require(len(names) == len(set(names)), "Additive migration objects overlap.")
    staging.mkdir(mode=0o700)
    backup = staging / "before.sqlite"
    fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    started = time.monotonic()
    def progress(_status, _remaining, _total):
        require(time.monotonic() - started < 120, "Private database backup timed out.")
    with closing(sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=30)) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        needed = connection.execute("PRAGMA page_count").fetchone()[0] * connection.execute("PRAGMA page_size").fetchone()[0]
        require(shutil.disk_usage(database.parent).free > needed + 512 * 1024 * 1024,
                "Insufficient free space for a private migration backup.")
        with closing(sqlite3.connect(backup.as_uri() + "?mode=rw", uri=True)) as saved:
            connection.backup(saved, pages=256, progress=progress, sleep=0.1)
            require(saved.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
                    and saved.execute("PRAGMA foreign_key_check").fetchall() == [],
                    "Private migration backup failed integrity verification.")
        with backup.open("rb") as stream:
            os.fsync(stream.fileno())
        write_json(staging / "result.json", {"phase": "backed-up", "backupSha256": digest_file(backup)})
        connection.execute("BEGIN IMMEDIATE")
        before = schema_rows(connection)
        present = [row for row in before if row[1] in names]
        # Reapplication is a no-op only when every reviewed object matches exactly.
        require(not present or sorted(present) == sorted(additions),
                "Existing additive schema is partial or differs from reviewed source.")
        if not present:
            for statement in reviewed:
                connection.execute(statement)
        correction = correct_host_verification(connection, corrections[0]) if corrections else None
        after = schema_rows(connection)
        require(sorted(row for row in after if row[1] in names) == sorted(additions)
                and [row for row in after if row[1] not in names]
                    == [row for row in before if row[1] not in names],
                "An existing database schema changed during additive migration.")
        require(connection.execute("PRAGMA foreign_key_check").fetchall() == [],
                "Additive migration failed foreign-key verification.")
        connection.commit()
    result = {"phase": "verified", "backupSha256": digest_file(backup),
              "schemaSha256": schema_digest(sorted(additions)),
              "created": bool(additions) and not bool(present), "tablesPreservedOnRollback": True,
              "migrations": [specification for specification, _ in migrations]}
    if correction is not None:
        result["publicHostCorrection"] = correction
    write_json(staging / "result.json", result)
    return result


class NoRouteRedirect(urllib.request.HTTPRedirectHandler):
    """Health and the selected public/privacy probes must answer directly."""
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ReleaseError("Unexpected health/route redirect.")


class System:
    """Small host boundary so rollback behavior can be tested without a host."""
    def run(self, *args):
        return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=90).strip()

    def property(self, name):
        return self.run("systemctl", "show", SERVICE, "--property=" + name, "--value")

    def retention_state(self):
        """Fixed loaded units only; no raw metadata escapes a rejected proof."""
        common = "Id,LoadState,FragmentPath,SourcePath,DropInPaths,NeedDaemonReload,Transient"
        service = "becore-tickets-retention.service"
        specifications = {
            service: common + ",Type,ExecStart,ExecStartPre,ExecStartPost,ExecCondition,ExecStop,ExecStopPost,ExecReload,KillMode,RemainAfterExit,ActiveState,SubState,MainPID,ControlPID",
            "becore-tickets-retention.timer": common + ",Unit",
        }
        result = {}
        for name, properties in specifications.items():
            raw = self.run("systemctl", "show", name, "--no-pager", "--all", "--property=" + properties)
            require(len(raw) <= 16384, "Oversized retention unit metadata.")
            pairs = [line.split("=", 1) for line in raw.splitlines()]
            require(all(len(pair) == 2 for pair in pairs), "Invalid retention unit metadata.")
            values = dict(pairs)
            expected_keys = set(properties.split(","))
            # systemd's special Exec formatter omits empty command arrays even
            # with --all. Only these six documented optional-empty fields may be
            # absent; ExecStart, state/identity fields and unknown keys stay strict.
            optional_empty = ({"ExecStartPre", "ExecStartPost", "ExecCondition", "ExecStop", "ExecStopPost", "ExecReload"}
                              if name == service else set())
            require(len(values) == len(pairs) and set(values) <= expected_keys
                    and expected_keys - set(values) <= optional_empty,
                    "Incomplete retention unit metadata.")
            for key in optional_empty:
                values.setdefault(key, "")
            require(all(values[key] == expected for key, expected in {
                "Id": name, "LoadState": "loaded", "FragmentPath": "/etc/systemd/system/" + name,
                "SourcePath": "", "DropInPaths": "", "NeedDaemonReload": "no", "Transient": "no"}.items()),
                "Retention unit identity is not the exact reviewed installation.")
            result[name] = values
        values = result[service]
        require(all(values[key] == expected for key, expected in {
            "Type": "oneshot", "KillMode": "control-group", "RemainAfterExit": "no",
            "ActiveState": "inactive", "SubState": "dead", "MainPID": "0", "ControlPID": "0"}.items()),
            "Retention cleaner must be inactive with no running process.")
        require(all(values[key] == "" for key in
                    ("ExecStartPre", "ExecStartPost", "ExecCondition", "ExecStop", "ExecStopPost", "ExecReload"))
                and re.fullmatch(r"\{ path=/usr/bin/python3 ; argv\[\]=/usr/bin/python3 /srv/becore-tickets/current/operations/retention\.py ; ignore_errors=no ; [^{}]* \}", values["ExecStart"]),
                "Retention execution differs from the reviewed unit.")
        require(result["becore-tickets-retention.timer"]["Unit"] == service,
                "Retention timer targets an unreviewed service.")
        return result

    def verify_credential_binding(self):
        # LoadCredential is D-Bus a(ss), which systemctl show's generic property
        # printer cannot represent. Inspect the typed value, not unit-file text.
        try:
            value = strict_json(self.run(
                "busctl", "--system", "--timeout=10", "--no-pager", "--json=short",
                "get-property", "org.freedesktop.systemd1",
                "/org/freedesktop/systemd1/unit/becore_2dtickets_2eservice",
                "org.freedesktop.systemd1.Service", "LoadCredential"))
        except (OSError, subprocess.SubprocessError, UnicodeError, ReleaseError) as exc:
            raise ReleaseError("Canonical credential bridge could not be verified.") from exc
        require(value == {"type": "a(ss)", "data": [
            ["runtime.json", "/etc/becore-tickets/runtime.json"]]},
            "Canonical credential bridge binding is unexpected.")

    def verify_database_binding(self):
        pid = self.property("MainPID")
        require(NUMBER.fullmatch(pid), "Tickets service PID missing.")
        entries = (Path("/proc") / pid / "environ").read_bytes().split(b"\0")
        values = [item.split(b"=", 1)[1] for item in entries if item.startswith(b"TICKETS_STATE=")]
        require(values == [b"/var/lib/becore-tickets"],
                "Service is not using the canonical Tickets database directory.")

    def application_gid(self):
        return pwd.getpwnam("becore-tickets").pw_gid

    def restart(self):
        self.run("systemctl", "daemon-reload")
        self.run("systemctl", "restart", SERVICE)

    def request(self, path, public=False):
        base = "https://" + HOST if public else "http://127.0.0.1:3119"
        request = urllib.request.Request(base + path, headers={
            "Host": HOST, "User-Agent": "Mozilla/5.0 (compatible; BeCoreTicketsHealth/1.0)",
            "Cache-Control": "no-cache"})
        try:
            opener = urllib.request.build_opener(NoRouteRedirect())
            response = opener.open(request, timeout=15)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            require(response.geturl() == base + path, "Unexpected health/route redirect.")
            return response.status, response.read(1024 * 1024)

    def application_uid(self):
        return pwd.getpwnam("becore-tickets").pw_uid

    def verify_effective_config(self, expected):
        pid = self.property("MainPID")
        require(NUMBER.fullmatch(pid), "Tickets service PID missing.")
        environ = Path("/proc") / pid / "environ"
        values = dict(item.split(b"=", 1) for item in environ.read_bytes().split(b"\0") if b"=" in item)
        require(values.get(b"TICKETS_CONFIG") == b"/run/becore-tickets-runtime/runtime.json",
                "Service is not using the preserved private credential bridge.")
        effective = Path("/run/becore-tickets-runtime/runtime.json")
        metadata = effective.lstat()
        require(stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode) == 0o600
                and metadata.st_uid == self.application_uid()
                and metadata.st_nlink == 1, "Effective configuration is not private.")
        require(effective.read_bytes() == expected, "Effective configuration differs from canonical configuration.")

    def sleep(self):
        time.sleep(1)


def health(system, revision, public=False):
    status_code, body = system.request("/healthz", public)
    value = strict_json(body)
    require(status_code == 200 and value.get("service") == "becore-tickets"
            and value.get("runtime") == "vps" and value.get("active") is True
            and value.get("revision") == revision, "Unexpected live health identity.")


def ready(system, revision, *, candidate=False):
    for _ in range(30):
        try:
            health(system, revision)
            break
        except Exception:
            system.sleep()
    else:
        raise ReleaseError("Local release readiness failed.")
    health(system, revision, public=True)
    for public in (False, True):
        for route, expected in ROUTES:
            code, body = system.request(route, public)
            require(code == expected, "Route verification failed: " + route)
            if route == "/api/version":
                version = strict_json(body)
                require(version.get("service") == "becore-tickets" and version.get("revision") == revision,
                        "Version route does not identify the active release.")
        if candidate:
            # Deleted routes must answer directly with 404. This is candidate-only:
            # the previous release may still expose its preview during rollback.
            for route in ("/checkout-preview", "/api/payments/preview"):
                code, _ = system.request(route, public)
                require(code == 404, "Retired checkout preview route is still available: " + route)


class AuditReleaseApproval:
    """One durable reservation under the deployment lock, never reusable on retry."""
    ID = "tickets-scanner-session-20261004"
    APPROVED_AT = "2026-10-04T14:50:08Z"
    EXPIRES_AT = "2026-10-05T14:50:08Z"
    EXPECTED_ACTIVE = "d7b1fa5ff01bfb797946dbad3dd47c96cfc9dfd1"
    STATE_NAME = "scanner-session-release-20261004.json"

    def __init__(self, directory, proof, run_id, attempt):
        self.path = directory / self.STATE_NAME
        approval = {"id": self.ID, "approvedAt": self.APPROVED_AT, "expiresAt": self.EXPIRES_AT,
                    "source": proof.get("source"), "sourceTree": proof.get("sourceTree"),
                    "expectedActive": self.EXPECTED_ACTIVE}
        require(SHA.fullmatch(approval["source"] or "")
                and SHA.fullmatch(approval["sourceTree"] or "")
                and proof.get("expectedActive") == self.EXPECTED_ACTIVE
                and proof.get("auditRelease") == approval,
                "Release lacks the exact one-success audit approval.")
        self.binding = {"version": 1, **approval, "runId": run_id, "attempt": attempt}
        self.record = None
        self.persistence_uncertain = False

    @staticmethod
    def now():
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time()))

    def check_window(self):
        now = self.now()
        require(self.APPROVED_AT <= now < self.EXPIRES_AT,
                "The one-success audit approval is outside its UTC window.")
        return now

    def check_directory(self):
        info = self.path.parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) & 0o022 == 0,
                "Audit approval state requires an owned protected directory.")

    def check_available(self):
        self.check_window()
        self.check_directory()
        # Any existing state, including failed, partial or unrecognized evidence,
        # blocks this approval. Recovery never deletes or resets this file.
        require(not os.path.lexists(self.path),
                "Audit approval already has state; inspect privately before any new approval.")

    def read(self):
        self.check_directory()
        fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                    and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600
                    and info.st_size <= 8192, "Unsafe private audit approval state.")
            return strict_json(stream.read(8193))

    def reserve(self):
        self.check_available()
        reserved = {**self.binding, "phase": "reserved", "reservedAt": self.check_window()}
        self.persistence_uncertain = True
        # Exclusive creation leaves blocking evidence even if interrupted mid-write.
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write((json.dumps(reserved, sort_keys=True) + "\n").encode())
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        require(self.read() == reserved, "Audit approval reservation could not be verified.")
        self.record = reserved
        self.persistence_uncertain = False

    def transition(self, phase):
        require(not self.persistence_uncertain and self.record is not None
                and self.record["phase"] == "reserved" and self.read() == self.record,
                "Audit approval reservation drifted or persistence is uncertain.")
        completed = self.check_window() if phase == "consumed" else self.now()
        value = {**self.record, "phase": phase, "completedAt": completed}
        self.persistence_uncertain = True
        write_json(self.path, value)
        require(self.read() == value, "Audit approval completion could not be verified.")
        self.record = value
        self.persistence_uncertain = False

    def consume(self):
        self.transition("consumed")

    def failed(self):
        # A failed write may already have committed consumption. Preserve it as-is.
        if not self.persistence_uncertain and self.record is not None and self.record["phase"] == "reserved":
            self.transition("failed")


class Deployment:
    def __init__(self, *, source, expected, run_id, attempt, archive, provenance,
                 archive_digest, provenance_digest, enable_crypto=False, recover_prepared=None,
                 root=Path("/"), system=None, audit_report=None):
        require(SHA.fullmatch(source) and SHA.fullmatch(expected) and source != expected,
                "Distinct exact release SHAs required.")
        require(NUMBER.fullmatch(run_id) and NUMBER.fullmatch(attempt), "Invalid deployment identity.")
        require(DIGEST.fullmatch(archive_digest) and DIGEST.fullmatch(provenance_digest),
                "Verified artifact and provenance digests required.")
        self.source, self.expected = source, expected
        self.identity = run_id + "-" + attempt
        self.run_id, self.attempt = run_id, attempt
        self.recover_prepared = recover_prepared or None
        require(self.recover_prepared is None or (
            re.fullmatch(r"[1-9][0-9]*-[1-9][0-9]*", self.recover_prepared)
            and self.recover_prepared != self.identity), "Invalid prepared recovery identity.")
        self.archive, self.provenance = Path(archive), Path(provenance)
        self.audit_report = Path(audit_report) if audit_report is not None else None
        self.archive_digest, self.provenance_digest = archive_digest, provenance_digest
        self.enable_crypto = enable_crypto
        self.root, self.system = Path(root), system or System()
        self.home = self.root / "srv/becore-tickets"
        self.releases = self.home / "releases"
        self.release = self.releases / source
        self.old_release = self.releases / expected
        self.journal = self.root / "var/lib/becore-tickets-handover/live-transfer.json"
        self.handoff = self.root / "var/lib/becore-tickets/handoff.json"
        self.config = self.root / "etc/becore-tickets/runtime.json"
        self.override = self.root / "etc/systemd/system/becore-tickets.service.d/scanner-release.conf"
        self.bridge = self.override.parent / "private-configuration.conf"
        self.snapshot = self.journal.parent / ("code-release-" + self.identity)
        self.lock = self.root / "run/lock/becore-tickets-deploy.lock"
        self.migrations = []
        self.migration_result = None
        self._deployment_lock_fd = None
        self._retention_proof = None
        self._candidate_unpacked = False

    def file(self, path, private=False, owner=None):
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == (os.geteuid() if owner is None else owner),
                "Expected owned regular file: " + str(path))
        require(not private or stat.S_IMODE(info.st_mode) == 0o600,
                "Private file must have mode 0600: " + str(path))
        return path.read_bytes()

    def verify_dependency_audit(self):
        require(self.audit_report is not None, "The final private dependency audit is required.")
        raw = self.file(self.audit_report, private=True)
        receipt = self.proof.get("dependencyAudit", {})
        require(type(receipt) is dict and set(receipt) == {"reportSha256", "status", "npmExitCode", "size"}
                and receipt["status"] in ("clean", "known-advisory-exception")
                and type(receipt["npmExitCode"]) is int and receipt["npmExitCode"] in (0, 1)
                and 0 < len(raw) <= 8 * 1024 ** 2 and receipt["size"] == len(raw)
                and receipt["reportSha256"] == hashlib.sha256(raw).hexdigest(),
                "Final private audit differs from verified provenance.")
        return raw

    def manifest(self, release, revision):
        require(release.is_dir() and not release.is_symlink(), "Expected real release directory.")
        value = strict_json(self.file(release / "release.json"))
        require(value.get("revision") == revision and value.get("dirty") is False,
                "Manifest does not identify a clean exact release.")

    def preflight(self):
        for directory in (self.home, self.releases, self.journal.parent, self.override.parent):
            require(directory.is_dir() and not directory.is_symlink(), "Unsafe deployment directory.")
        require((not os.path.lexists(self.release) or self.recover_prepared)
                and not os.path.lexists(self.snapshot),
                "Release or evidence already exists; inspect before retrying.")
        self.file(self.archive)
        require(digest_file(self.archive) == self.archive_digest
                and digest_file(self.provenance) == self.provenance_digest, "Transferred digest mismatch.")
        self.proof = strict_json(self.file(self.provenance))
        require(self.proof.get("version") == 1 and self.proof.get("source") == self.source
                and self.proof.get("expectedActive") == self.expected
                and self.proof.get("archiveSha256") == self.archive_digest
                and self.proof.get("ancestryVerified") is True
                and SHA.fullmatch(self.proof.get("sourceTree", ""))
                and self.proof.get("candidateTree") == self.proof["sourceTree"],
                "Release provenance does not match the transaction.")
        self.audit_raw = self.verify_dependency_audit()
        receipt = self.proof.get("dependencyAudit")
        require(type(receipt) is dict and receipt.get("status") in ("clean", "known-advisory-exception"),
                "Release dependency audit status is missing or unrecognized.")
        self.approval = None
        if receipt["status"] == "known-advisory-exception":
            self.approval = AuditReleaseApproval(self.journal.parent, self.proof, self.run_id, self.attempt)
            self.approval.check_available()
        else:
            require("auditRelease" not in self.proof, "A clean release cannot carry an audit exception grant.")
        changes = self.proof.get("changedFiles", [])
        require(isinstance(changes, list) and all(isinstance(name, str) for name in changes),
                "Release changed-file manifest is invalid.")
        self.migrations = migration_plan(changes)
        require(self.proof.get("migrations", []) == self.migrations,
                "Release migrations differ from the reviewed source manifest.")
        if self.migrations:
            self.system.verify_database_binding()
            state = self.root / "var/lib/becore-tickets"
            info = state.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.system.application_uid()
                    and stat.S_IMODE(info.st_mode) == 0o700,
                    "Canonical database directory is not private and service-owned.")
        self.before = {"journal": self.file(self.journal, private=True),
                       "handoff": self.file(self.handoff, private=True, owner=self.system.application_uid()),
                       "config": self.file(self.config, private=True),
                       "override": self.file(self.override), "bridge": self.file(self.bridge)}
        self.modes = {"override": stat.S_IMODE(self.override.stat().st_mode)}
        self.next_override = release_override(self.before["override"], self.old_release, self.release)
        self.record = strict_json(self.before["journal"])
        require(self.record.get("phase") == "active"
                and self.record.get("activeRevision") == self.expected
                and self.record.get("revision") == ORIGINAL_TRANSFER_REVISION
                and DIGEST.fullmatch(self.record.get("configurationHash", "")),
                "Handover journal is not the expected active transfer.")
        self.manifest(self.old_release, self.expected)
        self.links = {}
        self.rollback_releases = set()
        for name in ("current", "previous"):
            link = self.home / name
            require(link.is_symlink(), "Release pointers must already be symlinks.")
            target = link.resolve(strict=True)
            require(target.parent == self.releases and SHA.fullmatch(target.name),
                    "Release pointer escapes verified releases.")
            self.manifest(target, target.name)
            self.rollback_releases.add(target)
            self.links[name] = os.readlink(link)
            if name == "current":
                require(target == self.old_release, "Current pointer is not the active release.")
        self.retention_safe()
        require(self.system.property("WorkingDirectory") == str(self.old_release),
                "Service working directory drifted.")
        require(self.system.property("ActiveState") == "active", "Tickets service is not active.")
        require(self.system.property("NeedDaemonReload") == "no",
                "Tickets service has a pending or unknown daemon-reload state.")
        self.system.verify_credential_binding()
        config = configuration(self.before["config"])
        require(config.get("ENVIRONMENT") == "production", "Expected production configuration.")
        if self.enable_crypto:
            require(config.get("SEEV_ENABLED") == "true" and config.get("SEEV_ENVIRONMENT") == "production"
                    and bool(config.get("SEEV_CHECKOUT_API_KEY")) and bool(config.get("SEEV_WEBHOOK_SECRET")),
                    "Existing production Seev configuration is not ready.")
        self.system.verify_effective_config(self.before["config"])
        self.next_config = enable_crypto_bytes(self.before["config"]) if self.enable_crypto else self.before["config"]
        health(self.system, self.expected)
        health(self.system, self.expected, public=True)
        if self.recover_prepared:
            self.check_prepared_recovery()

    def check_prepared_recovery(self):
        """Prove an explicitly selected failure never reached live activation."""
        failed = self.journal.parent / ("code-release-" + self.recover_prepared)
        for directory in (failed, self.release):
            info = directory.lstat()
            mode = stat.S_IMODE(info.st_mode)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                    and (mode == 0o700 if directory == failed else
                         mode & 0o700 == 0o700 and mode & ~0o755 == 0),
                    "Prepared recovery requires owned real directories with original modes.")
        require(not any(self.release.iterdir()), "Prepared recovery requires an empty candidate directory.")
        expected_files = {name + ".before" for name in self.before} | {
            "pointers.before.json", "modes.before.json", "provenance.json", "result.json"}
        require({path.name for path in failed.iterdir()} == expected_files,
                "Prepared recovery evidence contains missing or unexpected entries.")
        run_id, attempt = self.recover_prepared.split("-")
        require(strict_json(self.file(failed / "result.json", private=True)) == {
            "version": 1, "phase": "prepared", "runId": run_id, "attempt": attempt,
            "source": self.source, "previous": self.expected,
            "archiveSha256": self.archive_digest, "provenanceSha256": self.provenance_digest,
            "cryptoEnabledRequested": self.enable_crypto, "dataMigration": bool(self.migrations)},
            "Prepared recovery evidence does not match this exact failed transaction.")
        for name, raw in self.before.items():
            require(self.file(failed / (name + ".before"), private=True) == raw,
                    "Prepared recovery snapshot differs from live inputs.")
        require(strict_json(self.file(failed / "pointers.before.json", private=True)) == self.links
                and strict_json(self.file(failed / "modes.before.json", private=True)) == self.modes
                and self.file(failed / "provenance.json", private=True) == self.file(self.provenance),
                "Prepared recovery pointers, modes or provenance do not match.")
        self.preserved()
        for name, path in (("config", self.config), ("journal", self.journal), ("override", self.override)):
            require(self.file(path, private=(name != "override")) == self.before[name],
                    "Live input drifted during prepared recovery.")
        require(all(os.readlink(self.home / name) == target for name, target in self.links.items()),
                "Live pointers drifted during prepared recovery.")
        return failed

    def quarantine_prepared(self):
        # Validate the replacement archive before preserving the empty failed
        # candidate. Never delete/overwrite old evidence or a populated release.
        with tarfile.open(self.archive, "r:gz") as archive:
            self.archive_members(archive)
        failed = self.check_prepared_recovery()
        print(json.dumps({"preparedRecovery": self.recover_prepared, "phase": "prepared",
                          "emptyCandidateConfirmed": True, "originalStateHashesMatch": True}, sort_keys=True))
        self.release.rename(failed / "empty-release.quarantined")
        for directory in (self.releases, failed):
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def retention_file(self, path):
        """Bounded read through owned, non-symlink directory/file descriptors."""
        with ExitStack() as stack:
            directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            stack.callback(os.close, directory)
            checks = []
            for component in path.relative_to(self.root).parts[:-1]:
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                stack.callback(os.close, child)
                info = os.fstat(child)
                require(info.st_uid == os.geteuid() and not stat.S_IMODE(info.st_mode) & 0o7022,
                        "Unsafe retention policy directory.")
                checks.append((directory, component, retention_identity(info, True)))
                directory = child
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            stack.callback(os.close, fd)
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                    and before.st_nlink == 1 and not stat.S_IMODE(before.st_mode) & 0o7022
                    and 0 < before.st_size <= 16384, "Unsafe retention policy file.")
            raw = os.read(fd, 16385)
            require(len(raw) == before.st_size and retention_identity(os.fstat(fd)) == retention_identity(before)
                    and retention_identity(os.stat(path.name, dir_fd=directory, follow_symlinks=False)) == retention_identity(before),
                    "Retention policy changed during observation.")
            require(all(retention_identity(os.stat(name, dir_fd=parent, follow_symlinks=False), True) == expected
                        for parent, name, expected in checks), "Retention policy parent changed.")
            return hashlib.sha256(raw).hexdigest(), retention_identity(before)

    def retention_inventory(self):
        fd = os.open(self.releases, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            require(info.st_uid == os.geteuid() and not stat.S_IMODE(info.st_mode) & 0o7022,
                    "Unsafe retention release directory.")
            inventory = {}
            with os.scandir(fd) as entries:
                for entry in entries:
                    require(len(inventory) < RETENTION_MAX_ENTRIES, "Retention inventory exceeds its reviewed bound.")
                    item = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                    require(SHA.fullmatch(entry.name) and stat.S_ISDIR(item.st_mode)
                            and item.st_uid == os.geteuid() and not stat.S_IMODE(item.st_mode) & 0o7022,
                            "Unsafe or unexpected retention inventory entry.")
                    inventory[entry.name] = (retention_identity(item), item.st_mtime_ns)
        finally:
            os.close(fd)
        require(len({item[1] for item in inventory.values()}) == len(inventory),
                "Tied retention timestamps have no reviewed ordering.")
        pointers = {}
        for name in ("current", "previous"):
            pointer = self.home / name
            item = pointer.lstat()
            require(stat.S_ISLNK(item.st_mode) and item.st_uid == os.geteuid()
                    and os.readlink(pointer) == self.links[name], "Retention pointer identity drifted.")
            pointers[name] = (retention_identity(item), os.readlink(pointer))
        require(retention_identity(self.releases.lstat(), True) == retention_identity(info, True),
                "Retention release directory changed.")
        return inventory, pointers, retention_identity(info, True)

    def retention_candidate(self):
        # Before extraction, bind the policy to the already digest-verified archive.
        # Its root timestamp is preserved by tar; a new directory is not implicitly young.
        if not self._candidate_unpacked:
            require(not os.path.lexists(self.release), "Older rollback proof requires an absent prospective candidate.")
            require(digest_file(self.archive) == self.archive_digest, "Candidate archive changed during retention proof.")
            with tarfile.open(self.archive, "r:gz") as archive:
                members = {str(PurePosixPath(item.name)): item for item in self.archive_members(archive)}
                top = members.get(".")
                require(top is not None and top.isdir() and not top.mode & 0o7022
                        and 0 <= time.time() - top.mtime < RETENTION_SAFE_AGE,
                        "Candidate archive root is outside the safe retention grace.")
                for name, expected in RETENTION_HASHES.items():
                    item = members.get("operations/" + name)
                    require(item is not None and item.isfile() and 0 < item.size <= 16384
                            and not item.mode & 0o7022, "Candidate retention policy is missing or unsafe.")
                    require(hashlib.sha256(archive.extractfile(item).read(16385)).hexdigest() == expected,
                            "Candidate retention policy differs from reviewed bytes.")
            return None
        require(0 <= time.time() - self.release.lstat().st_mtime < RETENTION_SAFE_AGE,
                "Unpacked candidate is outside the safe retention grace.")
        identities = {}
        for name, expected in RETENTION_HASHES.items():
            digest, identity = self.retention_file(self.release / "operations" / name)
            require(digest == expected, "Unpacked candidate retention policy differs from reviewed bytes.")
            identities[name] = identity
        return identities

    def retention_safe(self):
        if self._retention_proof is None and all(target.is_dir() and not target.is_symlink()
                and time.time() - target.stat().st_mtime < RETENTION_SAFE_AGE for target in self.rollback_releases):
            return  # Preserve the original one-hour grace without a policy-dependent exception.
        require(self._deployment_lock_fd is not None,
                "Rollback release is outside the safe retention grace; exclusive proof lock required.")
        try:
            lock = os.fstat(self._deployment_lock_fd)
            named_lock = self.lock.lstat()
            # Existing installer/shell writers legitimately create this empty
            # advisory lock as 0644 and may truncate it before attempting flock.
            # Its protected inode and ownership matter, not readable bits or data timestamps.
            require(all(stat.S_ISREG(item.st_mode) and item.st_uid == os.geteuid() and item.st_nlink == 1
                        and stat.S_IMODE(item.st_mode) & 0o600 == 0o600
                        and not stat.S_IMODE(item.st_mode) & 0o7133 for item in (lock, named_lock))
                    and (lock.st_dev, lock.st_ino) == (named_lock.st_dev, named_lock.st_ino),
                    "Retention proof deployment lock changed.")
            fcntl.flock(self._deployment_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            before = self.retention_inventory()
            inventory, pointers, directory = before
            actual = self._candidate_unpacked
            require((self.source in inventory) == actual, "Retention candidate inventory does not match extraction phase.")
            existing = {name: value for name, value in inventory.items() if name != self.source}
            proof = self._retention_proof
            if proof is not None:
                require(pointers == proof["pointers"] and directory == proof["directory"]
                        and set(existing) <= set(proof["inventory"])
                        and all(value == proof["inventory"][name] for name, value in existing.items()),
                        "Retention inventory, timestamps or identities drifted.")
            require(all(target.name in existing for target in self.rollback_releases), "Rollback release disappeared.")
            order = sorted(inventory, key=lambda name: inventory[name][1], reverse=True)
            if not actual:
                require(len(order) < RETENTION_MAX_ENTRIES, "No bounded slot for the prospective candidate.")
                order.insert(0, self.source)  # Worst-case single rank shift, regardless of archive ordering.
            newest = set(order[:3])
            current, previous = Path(self.links["current"]).name, Path(self.links["previous"]).name
            # The cleaner reads pointers separately. Include the mixed snapshot
            # (candidate, old previous) possible while a rollback restores them.
            states = tuple((left, right) for left in (current, self.source) for right in (previous, current))
            require(all(target.name in newest | set(state)
                        for target in self.rollback_releases for state in states),
                    "Rollback release is not protected through every pointer state.")
            candidate = self.retention_candidate()
            # A pre-existing cleaner may hold an older deletion list. Attest its
            # inactive/dead state after proving topology, then require an identical
            # rescan. A cleaner starting later sees only one of the protected states.
            units = self.system.retention_state()
            policy = {}
            for name, expected in RETENTION_HASHES.items():
                path = (self.old_release / "operations" / name if name == "retention.py"
                        else self.root / "etc/systemd/system" / name)
                digest, identity = self.retention_file(path)
                require(digest == expected, "Installed retention policy differs from reviewed bytes.")
                policy[name] = identity
            require(self.system.retention_state() == units and self.retention_inventory() == before,
                    "Retention state changed across its inactive baseline.")
            if proof is None:
                self._retention_proof = {"inventory": existing, "pointers": pointers, "directory": directory,
                                         "policy": policy, "candidate": None, "candidateFiles": None}
                proof = self._retention_proof
            require(policy == proof["policy"], "Installed retention policy identity changed.")
            if actual:
                if proof["candidate"] is None:
                    proof["candidate"], proof["candidateFiles"] = inventory[self.source], candidate
                require(inventory[self.source] == proof["candidate"] and candidate == proof["candidateFiles"],
                        "Unpacked candidate identity changed after retention proof.")
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, tarfile.TarError) as exc:
            raise ReleaseError("Rollback retention protection could not be verified.") from exc

    def archive_members(self, archive):
        """Validate the whole archive before creating any extraction directory."""
        members = archive.getmembers()
        seen = {}
        for item in members:
            name = PurePosixPath(item.name)
            require(not name.is_absolute() and ".." not in name.parts,
                    "Archive path escapes release.")
            require(str(name) not in seen and (str(name) != "." or item.isdir()),
                    "Archive has a duplicate or invalid root member.")
            require(item.isfile() or item.isdir() or item.issym() or item.islnk(),
                    "Unsafe archive member.")
            if item.islnk():
                target = PurePosixPath(item.linkname)
                require(not target.is_absolute() and ".." not in target.parts
                        and str(target) in seen and seen[str(target)].isfile()
                        and str(target) != "release.json" and item.size == 0,
                        "Archive hardlink must reference an earlier internal regular file.")
            # Preserve data_filter both here and at extraction time. GNU tar
            # deduplicates esbuild as a hardlink to its earlier packaged binary.
            tarfile.data_filter(item, str(self.release))
            seen[str(name)] = item
        for name in seen:
            require(all(str(parent) not in seen or seen[str(parent)].isdir()
                        for parent in PurePosixPath(name).parents),
                    "Archive member has a non-directory parent.")
        return members

    def unpack(self):
        with tarfile.open(self.archive, "r:gz") as archive:
            members = self.archive_members(archive)
            needed = sum(item.size for item in members if item.isfile())
            require(shutil.disk_usage(self.releases).free > needed + 512 * 1024 * 1024,
                    "Insufficient free space for safe release extraction.")
            self.release.mkdir(mode=0o755)
            archive.extractall(self.release, filter="data")
        self.manifest(self.release, self.source)
        require((self.release / "bin/node").is_file() and not (self.release / "bin/node").is_symlink()
                and (self.release / "server.mjs").is_file() and not (self.release / "server.mjs").is_symlink(),
                "Runtime executables missing or unsafe.")
        self.system.run(str(self.release / "bin/node"), "--check", str(self.release / "server.mjs"))
        self._candidate_unpacked = True

    def migrate(self):
        if not self.migrations:
            return
        self.system.verify_database_binding()
        migrations = []
        for specification in self.migrations:
            file = self.release / "migrations" / Path(specification["path"]).name
            raw = self.file(file)
            reviewed_migration(raw, specification)
            migrations.append((specification, raw))
        state = self.root / "var/lib/becore-tickets"
        staging = state / (".code-release-migration-" + self.identity)
        require(not os.path.lexists(staging), "Migration evidence already exists; inspect before retrying.")
        # SQLite must create WAL/SHM files as the existing application identity,
        # never as root. The private backup is moved into root-only evidence.
        child = os.fork()
        if child == 0:
            try:
                if os.geteuid() == 0:
                    os.setgroups([])
                os.setgid(self.system.application_gid())
                os.setuid(self.system.application_uid())
                migrate_database(state / "tickets.sqlite", staging, migrations)
                os._exit(0)
            except BaseException as failure:
                try:
                    if staging.is_dir() and not staging.is_symlink():
                        write_json(staging / "failure.json", {
                            "phase": "failed", "errorType": type(failure).__name__,
                            "reason": str(failure) if isinstance(failure, ReleaseError) else
                                      "SQLite or filesystem operation failed; inspect the preserved backup."})
                except BaseException:
                    pass  # A full disk must not erase the existing backup/evidence.
                os._exit(1)
        interrupted = None
        try:
            _, status = os.waitpid(child, 0)
        except BaseException as failure:
            interrupted = failure
            try:
                os.kill(child, signal.SIGTERM)
            except ProcessLookupError:
                pass
            _, status = os.waitpid(child, 0)
        if os.path.lexists(staging):
            info = staging.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.system.application_uid()
                    and stat.S_IMODE(info.st_mode) == 0o700,
                    "Unsafe private migration evidence directory.")
            staging.rename(self.snapshot / "database")
            for directory in (state, self.snapshot):
                fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        if interrupted is not None:
            raise interrupted
        require(os.waitstatus_to_exitcode(status) == 0, "Additive migration failed; inspect private backup evidence.")
        self.migration_result = strict_json(self.file(
            self.snapshot / "database/result.json", private=True, owner=self.system.application_uid()))
        require(self.migration_result.get("phase") == "verified"
                and self.migration_result.get("migrations") == self.migrations,
                "Additive migration evidence does not match the reviewed source.")
        backup = self.snapshot / "database/before.sqlite"
        info = backup.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and info.st_uid == self.system.application_uid() and stat.S_IMODE(info.st_mode) == 0o600
                and digest_file(backup) == self.migration_result.get("backupSha256"),
                "Private migration backup evidence could not be verified.")

    def evidence(self, phase):
        write_json(self.snapshot / "result.json", {
            "version": 1, "phase": phase, "runId": self.run_id, "attempt": self.attempt,
            "source": self.source, "previous": self.expected,
            "archiveSha256": self.archive_digest, "provenanceSha256": self.provenance_digest,
            "cryptoEnabledRequested": self.enable_crypto, "dataMigration": bool(self.migrations)})

    def preserved(self):
        require(self.file(self.handoff, private=True, owner=self.system.application_uid()) == self.before["handoff"], "Handoff state changed.")
        require(self.file(self.bridge) == self.before["bridge"], "Private credential bridge changed.")

    def transact(self):
        self.preflight()
        if self.recover_prepared:
            self.quarantine_prepared()
        self.snapshot.mkdir(mode=0o700)
        for name, raw in self.before.items():
            atomic_write(self.snapshot / (name + ".before"), raw)
        write_json(self.snapshot / "pointers.before.json", self.links)
        write_json(self.snapshot / "modes.before.json", self.modes)
        atomic_write(self.snapshot / "provenance.json", self.provenance.read_bytes())
        atomic_write(self.snapshot / "npm-audit.json", self.audit_raw)
        require(self.file(self.snapshot / "npm-audit.json", private=True) == self.audit_raw,
                "Private raw audit retention failed.")
        self.evidence("prepared")
        self.unpack()  # no service/configuration changes before archive validation
        self.retention_safe()
        try:
            self.migrate()
        except BaseException:
            self.evidence("migration-failed")
            raise
        if self.approval is not None:
            self.approval.reserve()
        journal_after = None
        try:
            self.evidence("activating")
            self.preserved()
            for name, path in (("config", self.config), ("journal", self.journal), ("override", self.override)):
                require(self.file(path, private=(name != "override")) == self.before[name],
                        "Deployment input drifted before activation.")
            require(all(os.readlink(self.home / name) == target for name, target in self.links.items()),
                    "Release pointers drifted before activation.")
            health(self.system, self.expected)
            health(self.system, self.expected, public=True)
            if self.approval is not None:
                self.approval.check_window()
            self.retention_safe()
            if self.next_config != self.before["config"]:
                atomic_write(self.config, self.next_config)
            atomic_write(self.override, self.next_override, self.modes["override"])
            self.system.restart()
            require(self.system.property("WorkingDirectory") == str(self.release), "Candidate unit did not load.")
            ready(self.system, self.source, candidate=True)
            self.system.verify_effective_config(self.next_config)
            self.preserved()
            require(self.file(self.config, private=True) == self.next_config, "Configuration drifted during release.")
            require(self.file(self.journal, private=True) == self.before["journal"], "Handover journal drifted.")
            # Keep old pointers pinned through health verification, then recheck
            # the original age grace or the attested retention protection proof.
            self.retention_safe()
            if self.approval is not None:
                self.approval.check_window()
            replace_link(self.home / "previous", str(self.old_release))
            replace_link(self.home / "current", str(self.release))
            record = copy.deepcopy(self.record)
            record["activeRevision"] = self.source
            record["lastCodeRelease"] = {
                "runId": self.run_id, "attempt": self.attempt, "previous": self.expected,
                "revision": self.source, "archiveSha256": self.archive_digest,
                "provenanceSha256": self.provenance_digest,
                "cryptoEnabledRequested": self.enable_crypto}
            if self.migrations:
                key = "reviewedDataMigrations" if any(item.get("kind") for item in self.migrations) else "additiveMigrations"
                record["lastCodeRelease"][key] = self.migrations
                record["lastCodeRelease"]["databaseBackupSha256"] = self.migration_result["backupSha256"]
            require(self.file(self.journal, private=True) == self.before["journal"], "Handover journal drifted before commit.")
            journal_after = (json.dumps(record, sort_keys=True) + "\n").encode()
            atomic_write(self.journal, journal_after)
            self.evidence("verified")
            if self.approval is not None:
                self.approval.consume()
            return {"released": self.source, "previous": self.expected, "active": True,
                    "runtime": "vps", "publicVerified": True, "dataMigration": bool(self.migrations),
                    "cryptoEnabledRequested": self.enable_crypto}
        except BaseException as failure:
            try:
                # Restore only bytes/pointers owned by this transaction. An outside
                # update must survive even when it is what caused the release to fail.
                conflicts = []
                for path, original, written, mode in (
                    (self.override, self.before["override"], self.next_override, self.modes["override"]),
                    (self.config, self.before["config"], self.next_config, 0o600),
                    (self.journal, self.before["journal"], journal_after, 0o600),
                ):
                    try:
                        present = self.file(path, private=(path != self.override))
                        if present != original:
                            require(written is not None and present == written, "External file drift preserved.")
                            atomic_write(path, original, mode)
                    except Exception:
                        conflicts.append(path.name)
                for name, written in (("current", str(self.release)), ("previous", str(self.old_release))):
                    try:
                        link = self.home / name
                        require(link.is_symlink(), "External pointer drift preserved.")
                        present = os.readlink(link)
                        if present != self.links[name]:
                            require(present == written, "External pointer drift preserved.")
                            replace_link(link, self.links[name])
                    except Exception:
                        conflicts.append(name)
                require(not conflicts, "External drift preserved; operator review required.")
                self.system.restart()
                require(self.system.property("WorkingDirectory") == str(self.old_release), "Rollback unit did not load.")
                ready(self.system, self.expected)
                self.system.verify_effective_config(self.before["config"])
                self.preserved()
                self.evidence("rolled-back")
                if self.approval is not None:
                    self.approval.failed()
            except BaseException as rollback_failure:
                self.evidence("rollback-needs-attention")
                raise ReleaseError("Rollback verification failed; inspect private release evidence.") from rollback_failure
            raise ReleaseError("Candidate failed; previous release restored and verified.") from failure

    def apply(self):
        require(os.geteuid() == 0, "Root access required.")
        fd = os.open(self.lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "a") as lock:
            require(stat.S_ISREG(os.fstat(lock.fileno()).st_mode), "Deployment lock must be regular.")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise ReleaseError("Another Tickets deployment holds the lock.") from exc
            self._deployment_lock_fd = lock.fileno()
            try:
                return self.transact()
            finally:
                self._deployment_lock_fd = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    operator = commands.add_parser("verify-operator")
    operator.add_argument("--source", required=True)
    verify = commands.add_parser("verify-ci")
    for name in ("source", "expected", "repository", "metadata", "runtime-run", "candidate-run", "archive", "output"):
        verify.add_argument("--" + name, required=True)
    verify.add_argument("--audit-directory")
    apply = commands.add_parser("apply")
    for name in ("source", "expected", "run-id", "attempt", "archive", "provenance", "archive-digest", "provenance-digest"):
        apply.add_argument("--" + name, required=True)
    apply.add_argument("--audit-report", required=True)
    apply.add_argument("--enable-crypto", choices=("true", "false"), default="false")
    apply.add_argument("--recover-prepared", default="",
                       help="Exact failed run-attempt identity; only a proven prepared empty release is quarantined.")
    args = parser.parse_args()
    try:
        if args.command == "verify-operator":
            verify_trusted_operator(args.source)
        elif args.command == "verify-ci":
            verify_ci(args)
        else:
            values = vars(args)
            values.pop("command")
            values["enable_crypto"] = values["enable_crypto"] == "true"
            def interrupted(_number, _frame):
                raise ReleaseError("Release interrupted.")
            signal.signal(signal.SIGTERM, interrupted)
            signal.signal(signal.SIGINT, interrupted)
            print(json.dumps(Deployment(**values).apply(), sort_keys=True))
    except BaseException as exc:
        # Do not print exception chains, commands, systemctl output or config values.
        print(str(exc) if isinstance(exc, ReleaseError) else "Release failed; inspect private evidence.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
