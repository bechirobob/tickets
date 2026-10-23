#!/usr/bin/env python3
"""Explicit Tickets VPS release with narrowly reviewed database changes.

The CI verifier binds successful main-runtime and browser runs to exact Git trees.
The host transaction runs under the existing deployment lock, keeps private rollback
snapshots, and never edits the private credential bridge or original handover fields.
"""
import argparse
import builtins
import copy
from contextlib import ExitStack, closing
from datetime import datetime, timezone
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
import types
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
# perform the exact reviewed additive/schema transitions and public corrections.
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
    "public/sw.js": "5e59b045ded41b5e6033fea174993349d5742373",
    "lib/organizer-rsvp-push.ts": "f843394ca5c7c4f9d823aa37e78ecb4f25585126",
    "lib/event-audience.ts": "fb8e73aee376426e9b58abb02dc6dc8ba85e3892",
    "app/organizer/workspace/suite.css": "427038c93ca19550c65e7cbafe4eb95c5ad250c7",
    "app/organizer/workspace/host-rsvp-alerts.tsx": "eac1f7be6fa0a3515dc87549b0cdd1fc6b870832",
    "app/api/organizer/notifications/subscription/route.ts": "1326df418932f18b8007e3410232a725f105f7eb",
    ".github/workflows/native-apps.yml": "426a9b8219d3f2ca73d3ad0de93b9a7d73ab3c89",
    "ops/vps/test_pink_edition.py": "be26c898ac1e19f7f737dbe5112c5e40b6e90c68",
    "tests/preview-events.test.ts": "2b209daa6b801aa82d642b2c30ce307c38586929",
    "tests/guest-experience.test.ts": "3b34f2afea56fc64c445595f4e2e6c70e6d943e0",
    "tests/event-copy.test.ts": "039fb82e0afad0ca0b4defe63de62fb19a336cb3",
    "tests/e2e/host-profile.spec.ts": "f06375db38ea245da55096aed7ed6f5fb658b48e",
    "tests/e2e/event-details.spec.ts": "76775953efa8ef1a4358e6a25acdf26a53c14736",
    "tests/e2e/cuppy-guest.spec.ts": "eed6faa0bc527217cba95a9d3f53163a6638bd1f",
    "scripts/prepare-registration-browser-fixture.mjs": "75b999087d6be1c3d38e82532fc675c1e541aeec",
    "public/events/on-the-guest-list-20261025.webp": "72e1f93f21289f16ff62de525d7ace61cea05219",
    "public/events/on-the-guest-list-20261025-email.jpg": "f62f1cfeaf6e2d91974acb38c9171352905101ab",
    "app/event/[slug]/event-story.tsx": "240ab3fdc28ec358307446aa773e8f01e89bef07",
    "tests/cloudflare-image-budget.test.mjs": "6b67fac15bc5e620ddd666ff85bbe20299c4e276",
    "tests/cloudflare-notification-metering.test.mjs": "0b226d1cce9c255c92c49f62fee3aee0296041ae",
    "tests/notification-read-budget.test.ts": "c7d44367f67124f70f3c10c26d6c84a7d8f8a9e8",
    "worker/index.ts": "620c06554292d8a8236d35349462f53371ab7415",
    "app/admin/operations/organizer-activity.tsx": "c4ad962d9b1d3d9d13817f88c7673a6fda850aea",
    "docs/reliability/event-capacity.md": "e52c861a5ce2465610aafc58d9c37ffdd2fb1fc6",
    "lib/flashes.ts": "94c8df484d3872ff60d2ff46ebc093edd82d280b",
    "tests/flashes.test.ts": "694627fbedeafaa80e0e6cb61513450b667b2142",
    "tests/organizer-activity-polling.test.mjs": "6cd0bf5c0b30953f8b9eb917c646b6a49e010527",
    "tests/room-abuse-boundaries.test.ts": "df61c41a01867ceebf123216e16e6c10f7c2bd3d",
    "tests/the-room.test.ts": "9431b1eb7231a2e36382d351441c1b3034366096",
    "tests/vps-operations.test.mjs": "a8fe59356a29502889fd2af41f3338225582f556",
    "tests/d1-recovery-privacy.test.mjs": "a88e879d0fdb6f00160a58fcd1cb077631e70fbf",
    ".github/workflows/d1-recovery-rehearsal.yml": "aea42d1acb19d54cbe9beba2962aed6c98ac3312",
    "tests/e2e/operations.spec.ts": "08e358438752ec391e41bfa3eea6e4774974fc3c",
    "tests/webhook-signatures.test.ts": "3645102ec5e8bc978ce9735ab34ef6e06e568bd7",
    "tests/test_audit_release_source.py": "6516f3f4b8582d3874ceda34e1fc3e3b799fec8d",
    "tests/test_audit_release_dependencies.py": "6983998bf40fc1cb424e6dafbb7ba35e5653336d",
    "tests/support-email-rendering.test.mjs": "e36cd295c753c5a28d5056a9ef33794d4c3216b4",
    "tests/scanner-session-client.test.mjs": "3d2665434fbb95d2329dc8370c57368e153ce16b",
    "tests/scanner-manifest.test.ts": "caa44fd148e41523f73219ffda5bf50c6efcfad7",
    "tests/public-catalogue.test.ts": "a4d09f4656c00b6cb1ff5635ec341179fd1fe4d7",
    "tests/organizer-scale-audit.test.ts": "a4be4dcfb4d5c4a104724b95bfc4687b7a75dd80",
    "tests/mobile-ui.test.mjs": "e5d555bfb255df96eb84aa1c73dc5c392b686d2f",
    "tests/gate-checkin.test.ts": "c0a046f6a8b5b68f380487890d614ef4c915c187",
    "tests/e2e/room-identity.spec.ts": "abab7debc8ff8acfcbe1fea21d2b109b845cd647",
    "scripts/verify-audit-release-source.py": "129d7bdbd2d631ad385a9edd7be4ea9895f173cf",
    "scripts/audit-release-manifest.json": "bcb787e744f9fc5fc201e8068d553c1543b35b86",
    "scripts/audit-release-dependencies.py": "47c7951e8db95ac666680bd2bf32fde3f1748c8e",
    "ops/vps/test_release_approval.py": "48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f",
    "ops/vps/test_code_release.py": "55a69859771dfcb4a29be699efbedbc387cfc4c4",
    "lib/scanner-manifest.ts": "028a2afad115457be51346042067dcf82b07b453",
    "lib/rsvp-analytics.ts": "fde1d556cacef67729a338d85773f0336a85486d",
    "app/privacy/page.tsx": "199d44965922d56d9d1f53947ecaf0aa72a8dc0a",
    "app/hosts/[slug]/page.tsx": "04228bb8dd93a831d1a608b0b42c59340ed9a86d",
    "app/api/organizer/analytics/route.ts": "411aac48caa2686c4480ddca4eee8221586ac996",
    ".github/scripts/verify-audit-control.py": "87cd21e095c76efc9e607484b8c0836db9bc58b5",
    "ops/vps/test_release_source.py": "ec8a7a5bbbe585941583f50624823b85ec51e586",
    "scripts/checkbox-hotfix-audit-policy.json": "7447247befa4b9ef0a274b27352afdce690e9e1e",
    "ops/vps/test_runtime_workflow_contract.py": "eef0b25e667f6be123c0ed6c5bca774158d390d8",
    "tests/repository-boundaries.test.mjs": "cf49012d4db8fef0273603b3ffbadd5a422341cd",
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
    "app/api/customer/notifications/route.ts": "6712aa29c24593ee65650c2c0e1a2e52e1636462",
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
    "app/event/[slug]/event-screen.tsx": "dda8eb43f6d32ca4e567567a859e40f225593fcc",
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
    "app/organizer/workspace/organizer-suite.tsx": "fbe4e78c876ce03a3bc36c26ce97087ab24931a5",
    "app/organizer/workspace/page.tsx": "b92e80fb99297cab5cfb100bf62e85f8948c2bfa",
    "app/organizer/workspace/suite-promote.tsx": "3cf32f511abc810e8758346a929f011ec55f99c5",
    "app/organizer/workspace/suite-records.tsx": "418120b13234eee93fd9f43d9225a3557035555c",
    "app/payment-footer.tsx": "bd75bc7b041ebe776877a668a6417a787f020e98",
    "app/promoter/promoter-portal.tsx": "a3a61075a0d532c1f027cb05f723c6f88e8dbf0c",
    "app/public-browsing-memory.ts": "00d86692aaae040fb6932429220166fc5f48a304",
    "app/registration-form.tsx": "118e80b64e67626ce479f60d3ab862003fa137a7",
    "app/registration-manager.tsx": "388a488887b5d0b52a5a77b536904659dc311d32",
    "app/room-demo.css": "c3d871ed75945a72df7fb32f7c13c962ee4876de",
    "app/room-overlay.tsx": "97d273e63be52e8154925512524d25062237d69b",
    "app/room-preview-carousel.tsx": "c77a4021be9ea6c29b6a8215e49326f2522e9491",
    "app/room/[slug]/room-client.tsx": "043000a1a4d51ea07acd170046f4898894a3945e",
    "app/rsvp/[slug]/page.tsx": "b745284eb452b1e0dc5234d474eb018ac9b8012b",
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
    "db/schema.ts": "bcd304ce4bf518e2b71d707e36a1438c6a65ee04",
    "lib/admin-session.ts": "57fa1b554bf27a8aa3759871017b721e682488df",
    "lib/background-health.ts": "4793c1cd2a5204371e75495d9d1b218f24a0a092",
    "lib/customer-screen.ts": "9546a787d811e4a8351e16e30693639c26743b26",
    "lib/email-delivery.ts": "dcad73b8a824af75949a8b02cba9977d00b182f8",
    "lib/transactional-email.ts": "6d7ea0dda0b1b0538e07be352b0b7ae39de1d8ce",
    "lib/event-guest.ts": "376bf08ff8b52898a4bbc3ab913ea0350134d1db",
    "lib/operational-finance.ts": "7e910e7765074c174695ca32338dee0fd9ae0681",
    "lib/operations-exceptions.ts": "ad4ba837129ba67ffa08745bdb3ff6ea4c838800",
    "lib/organizer-team.ts": "0214111d285e2bb19ee95af1934df68307126919",
    "lib/payment-operations.ts": "d8701182ced11abcbae5b3590a4d6db203ee45b7",
    "lib/provider-operation-tracking.ts": "63288d84fa93f0a97ee01909a68a654272151cbb",
    "lib/registration-draft.ts": "633cdb6e22cb28a1c8002fab96da0bf9fe6eb91b",
    "lib/registration-guidance.ts": "7db692341537e327b2af9eaeb5329d60f6294d27",
    "lib/request-body.ts": "3a948295f1551a837bd71e6cb45b46548db38c27",
    "lib/scanner-sync.ts": "68d45f670f1cf1d3a26c9ff10c5fbdbf21bb8243",
    "mobile/src/adapters/navigation.tsx": "475edbb849c70e265e5fbdff6931511b40138f52",
    "mobile/src/screen-catalogue.ts": "3c7030e0374696f31af397e7970be77173418194",
    "mobile/tests/app.spec.ts": "81c1a99ab072e86b6b2d18769820fc6f317eeadf",
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
    "worker/background.ts": "d5683c2699242330cec52fe5962614e33e635bdb",
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
    "lib/customer-email.ts": "31622bd55a37b546dc4cc72ccd1cc36ad9a48ee6",
    "lib/platform-announcements.ts": "ab09b51f3d547f1451ab7527d85b1d774d5c4c84",
    "lib/policies.ts": "3c9e0b06c569aa8cbb15e0f45a138ca6058a7a3a",
    "lib/preview-cleanup.ts": "dd10b3277598ee7e36f9d5ba4340ec07c231af30",
    "lib/registrations.ts": "8b35fb96f3655df25e66161442e658be15077fb8",
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
    "tests/e2e/guest-clarity.spec.ts": "04d01ce755a13fe93bcb358377ac818eb7bc439f",
    "tests/e2e/platform-announcements.spec.ts": "3eae4c200424d882188085a3eed616c10ac7bb46",
    "tests/e2e/private-link-recovery.spec.ts": "e29c198e1d2f0849a638ac624da40552c317a35c",
    "tests/e2e/registration.spec.ts": "2b8f31cdacbab4c8bc29b5459df32b459a5d6f53",
    "tests/e2e/seevplus-checkout.spec.ts": "036e3cb69226bc2b2c8495e85aa18aba98a974a9",
    "tests/email-preview/customer-email.spec.ts": "2259c6dafc53fd38f67a71d950837008b5e39de6",
    "tests/platform-announcements.test.ts": "634c4fee9dc9e7a8facb1933fa8d3ccaaa9d3a19",
    "tests/preview-cleanup.test.ts": "a74cb6ed1b7b66296576a17634ed3ab89f1465e3",
    "tests/registrations.test.ts": "155cf4f8374eda7769357a0b60e2ecc275ba82f7",
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
# One exact workspace release; historical application pins remain unchanged.
# The published snapshot is application evidence, never its own control anchor.
WORKSPACE_RELEASE_BASELINE = "379be609c49e8994dbd6b5bf5883c9be733369b1"
WORKSPACE_BASE_TREE = "f02fe2f1b013af5c0ac873e4d9af2eddb47e636a"
WORKSPACE_APP_SNAPSHOT = "b0b1b4534584ab74b20c6923cf1e77bf189fa94d"
WORKSPACE_APP_TREE = "1f2533264b8e48d440ee6bbeeb3c503652e1f659"
WORKSPACE_PACKAGE_BLOBS = ("91d44944a682f992880c44785d7b14eda9204c18",
                           "ee7d351bd660b932e9870b6d542da4426386eca5")
WORKSPACE_LOCK_BLOB = "47a4eaca5743b768598462d8b66a2ef49a442b4e"
WORKSPACE_CONTROL_FILES = {"ops/vps/code-release.py", "ops/vps/test_code_release.py"}
WORKSPACE_MIGRATION_FILES = {
    "drizzle/0065_recoverable_event_archive.sql",
    "drizzle/0066_owner_event_notifications.sql",
}
WORKSPACE_APPLICATION_BLOBS = {
    "README.md": "ee8c4c39e0bda6627d6e223d735389c7c09cc3b8",
    "app/access-polish.css": "7bbd696c2ebe334da3a67b94c35fb9465a5d6224",
    "app/admin/account/page.tsx": "13b7dadef5035b32247428ea663bc1ddd7fad999",
    "app/admin/curation-desk.tsx": "5d126b05427503f25140aeae8c154155996dfc86",
    "app/admin/events/archived-event-deletion.tsx": "582f038594cbb4ede01c166d7ab814ac23198f84",
    "app/admin/events/event-archive.tsx": "6187b91f13045c291f522e05f7ebd309236fb8c3",
    "app/admin/events/event-cleanup.tsx": "63254af50fc3381bb1f52ec15556fac1edd4e744",
    "app/admin/events/event-operations.tsx": "9789d349e4d38692711d16bc1cb47d98155d92b8",
    "app/admin/operations/event-operations-hub.tsx": "d0683e7a9110ec1adca8d3d98b619852f3e2cfbe",
    "app/admin/operations/page.tsx": "07ed7b1c256376a696d2387f1417b5abe3a26feb",
    "app/admin/page.tsx": "8ea6bd9ea97a5e8aba1a5cecf1e147cb016162af",
    "app/announcement-composer.tsx": "0191df00ae288b769e2e764af8f11bba5fa389bc",
    "app/api/admin/accounts/route.ts": "82a912a9b82f2b305d91a038d027f31748ed06e8",
    "app/api/admin/campaigns/route.ts": "22346091e68f9592748e9dc4d893bec11ce117f7",
    "app/api/admin/events/archive/cleanup/route.ts": "08e4a4940ca0165af9ba312ef23dd57c748c814f",
    "app/api/admin/events/archive/deletion/route.ts": "a21f98ac70244c5a6e62a2166a58d4d2c9914610",
    "app/api/admin/events/archive/route.ts": "325c492f81f7df44e18d14451cd6e420a108506f",
    "app/api/admin/events/route.ts": "79a6ec6502966c51e3f0ae967336ec290939540c",
    "app/api/admin/operations/route.ts": "7a884be2befef67e94447aadab30865cdd3e4b7e",
    "app/api/admin/promoters/route.ts": "d2f795d704f06c720e1b9a2d223c2ee8768f4f12",
    "app/api/admin/rooms/route.ts": "aa6c19353815ef771319ca2313878067925fbded",
    "app/api/admin/submissions/route.ts": "d0c97047577d574cd75d9ca3f734495dd53d4fa9",
    "app/api/media/[id]/route.ts": "3deb1a3773b8dc1c8ebe9783923ee5df0954b9fa",
    "app/api/organizer/analytics/route.ts": "75203bf6aff0bc13488bf0d0155d33650f20ce2a",
    "app/api/organizer/assistant/events/route.ts": "857f205b2104e077ee50d79ccdb5d50ef5443001",
    "app/api/organizer/assistant/route.ts": "9f268a5ee56c891402988ee79592fc88d9c99bc6",
    "app/api/organizer/business/route.ts": "d6b9db136e59f27b0e6a8c95f1ee3c6e44b02c81",
    "app/api/organizer/notifications/subscription/route.ts": "00510d6ff34994a514871d8c7a3bc4892ff8b3d3",
    "app/api/organizer/workspace/route.ts": "91ce18864faed995274f8d41334fb19019e4a51e",
    "app/api/payments/initialize/route.ts": "c5f33c5322ee3213fe1231990dd896551447242f",
    "app/api/waitlist/route.ts": "8254e4244e4d3e9444db6b65b496eb09a93fc327",
    "app/events.ts": "88331e11bef5ae8f9417d65c6eb0a325850a517d",
    "app/help/help-centre.tsx": "f9b394985c7660b760e5f5628358ea1d128216c7",
    "app/operations-design.css": "389e146a6393036fe88d61130caea57cb9576951",
    "app/organizer/analytics/organizer-analytics.tsx": "f85e24f1fb9c1115de4c738c5ae1755a1198f14e",
    "app/organizer/workspace/host-rsvp-alerts.css": "f22597dd486810d0d8ae24ac5c1de6300d6f8362",
    "app/organizer/workspace/host-rsvp-alerts.tsx": "7747a4e3ac8e7dab8fb9cd7b8879c42b0fb8d7f2",
    "app/organizer/workspace/organizer-suite.tsx": "4dc74e21268f8d31b72efbac18cebe08c1962af1",
    "app/organizer/workspace/organizer-workspace.tsx": "b8d40a84d83d6d17507ac77b2d9f6756f4050dca",
    "app/organizer/workspace/suite-records.tsx": "6014ec26425de6f5e77413c5009eea13596c4daf",
    "app/organizer/workspace/suite.css": "0b44251a102b84f004114efc58e223529a13f289",
    "app/phone-announcement-composer.tsx": "12c95fee7dd4f459b681388bb260fcb292c1051b",
    "app/room-features.css": "11bda156d6b7884535417e3a6cac6427763f842b",
    "app/room/[slug]/room-client.tsx": "ba6d41b70521ecb638edd19518f19e40656b4a53",
    "db/schema.ts": "5acd9cb94f4a57e7c7665af311065544318e1b1b",
    "docs/operations/host-rsvp-push.md": "6a3cb719719ae5c24eb088f5a8e861da804fcc8c",
    "lib/admin-session.ts": "2cbf5e145a7a24d27dbc70419f8daaddb72ef611",
    "lib/event-archive.ts": "f497f6c4e03e0e0ce40dc0dffae2991dd829880f",
    "lib/event-removal.ts": "bf5d4a55f91c81e0392bf67eb36618ebe023a468",
    "lib/host-summary.ts": "4f60b4df73ce53d601fda743283425085c62927e",
    "lib/organizer-access.ts": "f7d980bb51c9a326c8f09bfec2e818803a7dc202",
    "lib/organizer-records.ts": "882f087425b5c0740eefd4cddcb651a9bdbe5c61",
    "lib/organizer-rsvp-push.ts": "7774bdd2061f47c18bd4c4f1f08ebd44622f7752",
    "lib/preview-events.ts": "aded66795d7e3e9712d29e5f3801b2d8bafb1d2b",
    "lib/registrations.ts": "8c0479748e3981ba238903f7fc5189a4263b71ad",
    "package.json": "ee7d351bd660b932e9870b6d542da4426386eca5",
    "styles/workspace.css": "f2e4451bd6226fa036e24acb5186bd4aa8b5f91f",
    "tests/app-navigation.test.mjs": "7a8789d4b74987df393cd8bdcd1795991a25b7a5",
    "tests/e2e/host-announcement-channels.spec.ts": "8b73b4d41049e9dfd482f46607fc8081467d09b3",
    "tests/e2e/host-rsvp-alerts.spec.ts": "92c2ffb99dd5607d54009ebc83b3f69e35eaf1cb",
    "tests/e2e/operations.spec.ts": "613880e1a8e42e7e045329dc7c20e8273859cdcd",
    "tests/e2e/room-features.spec.ts": "b49a9e1340a151bfaa94509a299513a181cd5060",
    "tests/e2e/room-host-messages.spec.ts": "6635518901d17a54e54f4b9c811c0779f14b02ab",
    "tests/e2e/room-identity.spec.ts": "da440a0e39dc06cef8d7c8b3695d16b6ca738a4e",
    "tests/event-archive.test.ts": "8786fdb9c6502760b748d5f89e08fc12afa301db",
    "tests/host-announcement-channel.test.ts": "424f1dab02f8aeecdfe2a7c0088e6cda0a457823",
    "tests/mobile-ui.test.mjs": "7be7869649ce4d5880c2cf51be54a5b3ce77a528",
    "tests/organizer-analytics.test.ts": "82719fc4b85051a92091823e8ed115fe085ae583",
    "tests/organizer-business.test.ts": "7d293efc50662bcb279a9c3e284d3923a8c0b0a5",
    "tests/organizer-finance-ui.test.mjs": "4f4699ac19b186e5eb5b75746224d78fd23b90dc",
    "tests/organizer-rsvp-push.test.ts": "cf56520260c6d5aa425251fcea629ca789f56c35",
    "tests/owner-notification-wiring.test.mjs": "99ff61ff4529fdcf794cc7c9848a361729f96869",
    "tests/payment-selection.test.ts": "1e63fdfed33240ad0d955e667717eccfe54327f5",
    "tests/registrations.test.ts": "6f4a156f28f301ad3dd7a1609d742c87104ab5ce",
    "tests/vps-bindings.mjs": "89a9d7d85e2839d7ccc35836b1e7378b56d331b3",
    "worker/the-room.ts": "f5849f1cd02093e6d752631b36267af336b31a14",
}

# One exact Yorke host-brand increment from the current reviewed live release.
# S includes screenshot-only preview tooling, not publication approval. Its
# application evidence can never select or supply its own trusted controls C.
YORKE_RELEASE_BASELINE = "c2058fb39bb6d9a93ef622aad08b1e9e2d22488f"
YORKE_BASE_TREE = "c85475e968e1cecbd6637fe77710b032dee0ecbd"
YORKE_APP_SNAPSHOT = "0babbc74b0a8d2b931289441c73aa93b36e1e52c"
YORKE_APP_TREE = "28f678b6a2a7812d2d4c11240b04baace9a1ea48"
YORKE_PACKAGE_BLOBS = ("ee7d351bd660b932e9870b6d542da4426386eca5",
                       "e4f736b3204696fceab081989f1cdddfd5b1bc5e")
YORKE_LOCK_BLOB = "47a4eaca5743b768598462d8b66a2ef49a442b4e"
YORKE_CONTROL_FILES = {"ops/vps/code-release.py", "ops/vps/test_code_release.py"}
YORKE_MIGRATION_FILES = {"drizzle/0067_host_brand_identity.sql"}
YORKE_APPLICATION_BLOBS = {
    ".github/workflows/booking-consent-previews.yml": "b87e8c610416c82998849ee5e0eb04ea0ca0045f",
    "app/api/public/events/route.ts": "291dc36b1731e74597d3fb623a2dae663f822a7d",
    "app/event/[slug]/event-details.css": "2f4dc2c5702db50cbdd8ea1d4fb9bc1fe50880e4",
    "app/event/[slug]/event-screen.tsx": "262aa6aec3b6e1ce4330b518a394db59d26a36c2",
    "app/event/[slug]/page.tsx": "0d1abc7e826da826673c6a064695389d6f8cfe5c",
    "app/host-brand.css": "fc69403abd5958a420407e863cf7683cb21c00c4",
    "app/host-portrait.css": "5af605709e139d67e56b145b8122f3e7deec91d5",
    "app/host-portrait.tsx": "72f4e6dd3314e058d571b1029e3a0313bd9927ab",
    "app/hosts/[slug]/page.tsx": "4390e2525c64968d22c8e738021293d6fb9e4655",
    "app/hosts/hosts.css": "1108b1c9f4a8e65813b547ed9b77f978eeac283f",
    "app/hosts/page.tsx": "fe7afa2f2b702f85673b92849da7938266dfaff4",
    "db/schema.ts": "530e44bb6c4145cd0daf7d1d90a900fbf1bddbc0",
    "docs/audits/yorke-host-brand-20261013.md": "abf170b3f090bbd88e178e9522f2e536798c3ff7",
    "lib/customer-screen.ts": "191a8e6f3b9a362f0319b647b61dbb53af137f76",
    "lib/event-experience.ts": "6453bd7faee040a030e925c40cb7dd0baed00409",
    "mobile/src/screen-catalogue.ts": "3b6c0195a091eb7912b4325c2f269e2dee107e02",
    "mobile/tests/host-brand-catalogue.test.ts": "80788c4ebe3bb4b6c9389256e225c49eb08f4f73",
    "package.json": "e4f736b3204696fceab081989f1cdddfd5b1bc5e",
    "public/hosts/the-yorke-way.svg": "d6eecbcae7eb241017e13f19b19e35290ce99c59",
    "scripts/package-host-brand-previews.mjs": "6160e04a05af0de48e925055c0f3dadd580ec8fc",
    "tests/e2e/host-brand-identity.spec.ts": "bc1871859fad35551c438df21d763e9f8dfb46d9",
    "tests/e2e/host-profile.spec.ts": "ba099658c2866802b436855819bcefd39f50074b",
    "tests/host-brand-identity.test.ts": "790c12145d885b6a869d68b7f000a7e408f4f90d",
    "tests/host-brand-migration.test.mjs": "20ced243776db46b865857ca9e9c97843d113afc",
    "tests/host-brand-preview-package.test.mjs": "515c1c87414fabaf287ab84c61f4cba8ed0ff7b6",
    "tests/host-brand-rendering.test.mjs": "67bc345faa8eeed83486243fe16df088ced9b045",
    "tests/staff-owner-integrity.test.ts": "c4848f22880124500be8627497fc5df223bcb5d2",
}

# One readiness release from live L, preserving the independently merged
# advisory base A. Only final S carries the four reviewed readiness outputs;
# neither A nor S can supply its own new release controls C.
RSVP_READINESS_LIVE_BASELINE = "d257f41b669a542de0eebbe09993e7efa8dd5074"
RSVP_READINESS_LIVE_TREE = "a4446b0a2d2fc6a03e5196fb9b3a2d90f72a5d66"
RSVP_READINESS_ADVISORY_BASE = "0f82e136c8005d910f0aeb44b6f355176fc254f6"
RSVP_READINESS_ADVISORY_TREE = "c805f0626b55e069e45b22e2420e4f0d463c945e"
RSVP_READINESS_APP_SNAPSHOT = "d43243e28d06000465b30175dd947a4a22ce4ba0"
RSVP_READINESS_APP_TREE = "b30272ddb69e5e1a9ee694bb7f8bab4c47eb541a"
RSVP_READINESS_PACKAGE_BLOBS = ("e4f736b3204696fceab081989f1cdddfd5b1bc5e",
                                "eccb3af63298d7642c1ea974d7e8f18da9563507")
RSVP_READINESS_LOCK_BLOB = "47a4eaca5743b768598462d8b66a2ef49a442b4e"
RSVP_READINESS_CONTROL_FILES = {"ops/vps/code-release.py", "ops/vps/test_code_release.py"}
RSVP_READINESS_ADVISORY_BLOBS = {
    ".github/workflows/candidate-parallel-checks.yml": "313182fc21841d8a059be596c7c31e0a0b179a33",
    "docs/reliability/parallel-candidate-benchmark.md": "c7706b3ffea9fbd2c73a435cc516e3d8c3bde289",
    "docs/reliability/release-timing.md": "4f2bfabd835257370f55b50fa03bb272127436fa",
    "ops/vps/candidate_build.py": "5820b026f9747961081fc3e8b8e5531bf546621a",
    "ops/vps/test_candidate_build.py": "332079c682451af3c3e1ac36feef0129d1975b29",
    "ops/vps/test_code_release.py": "3a00def2029213f4a54493ebc1b17559a218735e",
    "scripts/release-timing.py": "27f76adcc0ef2ad71b9e9696eb050ff643232d28",
    "tests/test_candidate_parallel_workflow.py": "26f56b2aca434e930718cb75db3a4a9863131411",
    "tests/test_release_timing.py": "874dc439367e2600fc764ba0d26e8fb3c93b37dd",
}
RSVP_READINESS_APPLICATION_BLOBS = {
    "app/registration-form.tsx": "392be6a7594bbc18b5be5f992b29801d21dc20d5",
    "package.json": "eccb3af63298d7642c1ea974d7e8f18da9563507",
    "tests/e2e/guest-clarity.spec.ts": "1e370c029f3134b90d8decb11a128e31823b791c",
    "tests/registration-readiness.test.mjs": "4d26acd0b4acec36e724edc0a0eb7dc793d16552",
}

# Finite, application-identical parallel-admission rollout: B -> C -> P.
# C changes the complete 14-path control family. P adds only the reserved test;
# its 13 non-control outputs are literal reviewed blobs, never candidate claims.
PARALLEL_RELEASE_BASELINE = "45ae58430aea3bad312a8244432078a4ffde59f8"
PARALLEL_RELEASE_BASE_TREE = "5c24c7eb3e0b7add6c04226bdbab33fea1b7846f"
PARALLEL_CONTROL_FILES = {"ops/vps/code-release.py", "ops/vps/test_code_release.py"}
PARALLEL_PROMOTION_FILE = "ops/vps/test_parallel_source_family.py"
PARALLEL_OUTPUT_BLOBS = {
    '.github/workflows/candidate-parallel-checks.yml': '81bad0f7a602c579fc14c961aa8e26e32f75767d',
    '.github/workflows/tickets-code-release.yml': '9c5ca1129fe7e97215b3d895060a4f01256473bf',
    '.github/workflows/tickets-release-operator-checks.yml': '019ec9b3ac73bec979d3ab62725a3d1208ca765f',
    'docs/reliability/parallel-candidate-benchmark.md': 'ae0f6fa386d882a649bfcaa7a6e57349c08f3d0e',
    'ops/vps/candidate_build.py': '502b3f8cddc2038113498824e430620eb1b55d0f',
    'ops/vps/test_candidate_build.py': 'a9920c4d21804074d4ab176c541247787b46639f',
    'ops/vps/parallel_candidate.py': '08e44556ad630ee5227463b74bce990f943d939f',
    'ops/vps/test_parallel_candidate.py': '3af28a1b01a08c19a97155229f6e0b5efc592fc0',
    'ops/vps/parallel_candidate_control.py': '1000acb20a4e8b3a0d9c5771ea5269db006805a4',
    'ops/vps/test_parallel_candidate_control.py': '6ddbd74138168c8538406920d9fda7432ce67f49',
    'ops/vps/test_parallel_admission.py': '35b8fb438193184f8e1654d44981f6c3564d0ca0',
    'ops/vps/test_parallel_source_family.py': '54ac92e721b51dda03bca69862816fa78d1c0737',
    'tests/test_candidate_parallel_workflow.py': '7fea55bc9d99e558d3c0cc0099cbc027e9423bb2',
}
PARALLEL_OUTPUT_MODES = {name: "100644" for name in PARALLEL_OUTPUT_BLOBS}
PARALLEL_MODULES = ("public_runtime_guard", "runtime_release", "candidate_build",
                    "parallel_candidate", "parallel_candidate_control")


# Bounded CINCO guest receipt release. Preserve the exact merged operational
# baseline; only six reviewed application/test files may change after controls.
CINCO_RELEASE_BASELINE = '45ae58430aea3bad312a8244432078a4ffde59f8'
CINCO_RELEASE_BASE_TREE = '5c24c7eb3e0b7add6c04226bdbab33fea1b7846f'
CINCO_ADVISORY_BASE = '8d156f081749bbd2a01d1ac6a7d3510c65ce8e22'
CINCO_ADVISORY_TREE = '8051670d6fc5cc1468b276e4a19104f4df5a9446'
CINCO_CONTROL_FILES = {"ops/vps/code-release.py", "ops/vps/test_code_release.py"}
CINCO_ADVISORY_BLOBS = {'.github/workflows/candidate-parallel-checks.yml': '81bad0f7a602c579fc14c961aa8e26e32f75767d', '.github/workflows/puro-exceso-listing.yml': '8bf87a0ee41e69c44b10b092fd2f7b238b301af0', '.github/workflows/puro-exceso-publish.yml': '285efaf42ccbb5caf50673b08e6751a8733b2117', '.github/workflows/tickets-code-release.yml': '9c5ca1129fe7e97215b3d895060a4f01256473bf', '.github/workflows/tickets-release-operator-checks.yml': '019ec9b3ac73bec979d3ab62725a3d1208ca765f', 'docs/reliability/parallel-candidate-benchmark.md': 'ae0f6fa386d882a649bfcaa7a6e57349c08f3d0e', 'ops/handover/puro_exceso/activate.sha256': 'e378ea429c22d4fe465246f53aa44cdb0f41a9c5', 'ops/handover/puro_exceso/apply.py': 'e4d4f2ddacf5b4ab41aaed934a830af19a74c574', 'ops/handover/puro_exceso/event_insert.py': '25d640e70488bb7ea7be014876c27caf50a7a951', 'ops/handover/puro_exceso/flyer.jpeg.b64': '63563463aa0fd7a62e9490449f44420d48328604', 'ops/handover/puro_exceso/inspect.py': 'da1d66b3a6d833d43d9ad1675dbd3cec16a57af0', 'ops/handover/puro_exceso/test_event_insert.py': 'e7219b9b15312c9e1dbb1cd685156ee691cee050', 'ops/handover/puro_exceso/test_inspect.py': '27ae56c68f2aea1b5020a99cdcda3ee95a8798d5', 'ops/handover/puro_exceso/verify_public.py': 'd3abfefb3bc9e24398c1bc31b7c74b3c89d9f6cb', 'ops/vps/candidate_build.py': '502b3f8cddc2038113498824e430620eb1b55d0f', 'ops/vps/parallel_candidate.py': '08e44556ad630ee5227463b74bce990f943d939f', 'ops/vps/parallel_candidate_control.py': '1000acb20a4e8b3a0d9c5771ea5269db006805a4', 'ops/vps/test_candidate_build.py': 'a9920c4d21804074d4ab176c541247787b46639f', 'ops/vps/test_parallel_admission.py': '35b8fb438193184f8e1654d44981f6c3564d0ca0', 'ops/vps/test_parallel_candidate.py': '3af28a1b01a08c19a97155229f6e0b5efc592fc0', 'ops/vps/test_parallel_candidate_control.py': '6ddbd74138168c8538406920d9fda7432ce67f49', 'ops/vps/test_parallel_source_family.py': '54ac92e721b51dda03bca69862816fa78d1c0737', 'tests/test_candidate_parallel_workflow.py': '7fea55bc9d99e558d3c0cc0099cbc027e9423bb2'}
CINCO_APPLICATION_BLOBS = {'lib/confirmation-delivery.ts': '02f9381c8bd379a9cce1238c2f985c004bcb482b', 'lib/registrations.ts': 'fda1d288ff3ff29db196c23995926731745d12c0', 'tests/confirmation-delivery.test.ts': 'd8f9770625793d2d09362fc8113ea4e8b990864c', 'tests/registrations.test.ts': '6b7308756973d59a002d956c64da91d7269687f6', 'lib/customer-email.ts': '5a6d69d69cfdb9925ed0b5b669b28d433020d655', 'tests/customer-email-rendering.test.mjs': '1459d87a8769b347e7a9338950b0f9534636b4a5'}

# Finite recovery increment from the active receipt release. The operational
# baseline adds only these two workflows; independently merged controls then
# admit the complete reviewed application patch, with no runtime/schema drift.
CINCO_RECOVERY_RELEASE_BASELINE = '04bbe9691a00ca48cfb974ab0b87b743d9c3aab8'
CINCO_RECOVERY_RELEASE_BASE_TREE = '2d621ad85ed87045fcfbee99b01dfe3e223cdf65'
CINCO_RECOVERY_ADVISORY_BASE = 'ac54f594c5dd5b965d4431cef54f11e2803d2f4e'
CINCO_RECOVERY_ADVISORY_TREE = '02a7d3241bf32b3d19dd14ddd640596956fccfc9'
CINCO_RECOVERY_CONTROL_FILES = {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
CINCO_RECOVERY_ADVISORY_BLOBS = {
    '.github/workflows/cinco-confirmation-release-20261019.yml': 'a946f4dbae8b24b375bf0dc58d6d3e72bce127d9',
    '.github/workflows/puro-approval-readonly-20261019.yml': '7b912b15ab04dd603dee86c0cc8f6d1c1ef754f3',
}
CINCO_RECOVERY_APPLICATION_BLOBS = {'app/api/customer/recovery/claim/route.ts': '78688e0fa697e793b523f599d61228aa9070a62b',
 'app/api/customer/registrations/route.ts': 'e52ee01e6594afe0a2a29997bda9007402fdb469',
 'app/my-nights/[slug]/night-hub.tsx': 'b8382ce3ff8a590c5b95c4a598ef241220ab204a',
 'app/my-nights/my-nights-client.tsx': '3bf1ca4484332cd2c73a1ff525483b10ea368782',
 'app/my-registrations.tsx': 'd243098e507fed942f343ede82f5ff74dfc8e741',
 'app/registration-form.tsx': '3377c892e301dd8c8ab79a1b0b25bd29b148631d',
 'app/room/[slug]/room-client.tsx': '71f3cabf44acfc2739ebad29c046c4d565287935',
 'app/tickets/ticket-wallet.tsx': '690cdf42d8730fe6206e92f84a9ec8e6ffeac0c6',
 'package.json': '5b9f6d868730b315d471696625ed879fd9a9dd48',
 'tests/e2e/discovery-pass-access.spec.ts': '96c88875c6ec2e99e0b0a6b4aca280ca66851731',
 'tests/e2e/operations.spec.ts': 'ec95702c13e6e2e9c3b5c10a4683827ae6b4373e',
 'tests/e2e/registration.spec.ts': 'a5c89bf3d3431f707c6a4d6bd34d96130c98aa77',
 'tests/my-nights-refresh.test.mjs': 'ca13ed25d6fa3758acb359b207b6b70b1dda4093',
 'tests/registration-readiness.test.mjs': 'cb932ef4ebdec0504b77ba613f9a81d2de739cd3',
 'tests/registrations.test.ts': '0b5bb42566da2ab729bb43311cfd9a67eea5ddb8',
 'tests/ticket-recovery.test.ts': '19887989e8eaf6a1f3d4d9b24efecdfdbad263d8'}
CINCO_RECOVERY_PACKAGE_BASE_BLOB = 'eccb3af63298d7642c1ea974d7e8f18da9563507'
CINCO_RECOVERY_LOCK_BLOB = '47a4eaca5743b768598462d8b66a2ef49a442b4e'


# Exact Flashes/RSVP increment. C adds only the independently reviewed controls
# and the pinned root/mobile Vite security patches; P adds only six UI/test files.
# No workflow, audit exception, runtime, schema or permission change is admitted.
FLASHES_RELEASE_BASELINE = 'f242907bb73b4f9f157451a9199dd66d237dbaf6'
FLASHES_RELEASE_BASE_TREE = '8f8bd4c0bf4b93f51627f172162ff6216388ea60'
FLASHES_ADVISORY_BASE = '87463bd06d05ea6aa6495582afcdd0ac725c1d53'
FLASHES_ADVISORY_TREE = '93ab0cf9444c59102fe2d25f90beb56f835dfcec'
FLASHES_CONTROL_FILES = {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
FLASHES_ADVISORY_BLOBS = {
    '.github/workflows/puro-access-readonly-20261020.yml': '34f5a3d5304f4066cbbc65c463c45e6636bb8c05',
    '.github/workflows/puro-access-release-20261019.yml': '764e866a7abc8f9fc05df3cdc2e4a87e7ffe8075',
    '.github/workflows/puro-delivery-readonly-20261020.yml': '86a3a28856f4b709fbe4a0d62272f3e13529f245',
}
FLASHES_APPLICATION_BLOBS = {'app/event/[slug]/event-details.css': '09936e76a884d9fd0d07a094c837a47ffbd1e36d',
 'app/room-features.css': '2b152ff8f704c23113ceab7c80d917e16f64e807',
 'app/room/[slug]/flash-capture-mark.tsx': '6b481b22accbdf3cb89d76023efc9523a6dc0e78',
 'app/room/[slug]/flashes-panel.tsx': 'ccd28f0222b0ef7161c708d84e513d1d0cd3812e',
 'tests/e2e/registration.spec.ts': '74a408047f4b6c16abe036f14e1758b87140bbe8',
 'tests/e2e/room-features.spec.ts': 'f9e895a6422d1f33ffc4b13094f5f0ed2406a4f0'}
FLASHES_SECURITY_BLOBS = {'mobile/package-lock.json': 'ef19daa868045d26c686ed003a29f183bc144e84',
 'mobile/package.json': '552fbe9817bdcfd4d9ecc898fbbabcc8cf17dc92',
 'package-lock.json': '3fa4bfae990eac872f88c72d30a51c995c35574d',
 'package.json': 'a3db62441e7b0c8676dc1a166b913004af92eedd'}
FLASHES_PACKAGE_BASE_BLOBS = {'mobile/package-lock.json': 'ebae7283d0906a9cb42b374b78a90986e7fcdcac',
 'mobile/package.json': '7cf2bf6a970f54c88c631b0ba39872c8ad4f03e6',
 'package-lock.json': '47a4eaca5743b768598462d8b66a2ef49a442b4e',
 'package.json': '5b9f6d868730b315d471696625ed879fd9a9dd48'}


# Exact navigation/arrival increment: independent controls C, then the complete
# reviewed application snapshot P. C includes only the pinned root Vitest patch;
# P adds only the reviewed feature/test changes. Workflows and schema stay fixed.
NAVIGATION_RELEASE_BASELINE = '5ddf0bc9186626d8325f72f216f5bf1e730ad189'
NAVIGATION_RELEASE_BASE_TREE = '5b91ad4592fcf5dcb9882e86e338f0a58f26a4a2'
NAVIGATION_APP_SNAPSHOT = '616d536ceda4ab1cab88aa178c97f2bb06c432b5'
NAVIGATION_APP_TREE = '5abd9b8d3dbae73e2d6770552fc1a50c6f10e89f'
NAVIGATION_CONTROL_FILES = {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
NAVIGATION_APPLICATION_INPUTS = {'app/api/customer/room-updates/route.ts': None,
 'app/api/rooms/[slug]/access/route.ts': '86de698f93b4068ebe45e7e2d66966f2e5a58ba2',
 'app/api/rooms/[slug]/updates/read/route.ts': None,
 'app/brand-arrival.css': None,
 'app/brand-arrival.tsx': None,
 'app/customer-dock.tsx': '18a4264821dd0af9700f88edc046a109ef458ab0',
 'app/iphone-interface.css': '3dd3b6b529819123cbc6fa9e71f48a95b193cb1d',
 'app/layout.tsx': 'e2b08c91b28ba40311d18723796d9c7e035db2ae',
 'app/mobile-navigation.tsx': 'cc9e7844b263a473f590b749de26c9c4d91d0773',
 'app/notification-bell.tsx': '103a2e0025719179c6ff292425b0ca9cffde3986',
 'app/notifications/notification-panel.tsx': 'a65b1b6d3dc00a1d0cb377c1a9c47e4951887009',
 'app/room-overlay.tsx': '97d273e63be52e8154925512524d25062237d69b',
 'app/room-shortcut.css': None,
 'app/room/[slug]/room-client.tsx': '71f3cabf44acfc2739ebad29c046c4d565287935',
 'app/tickets/ticket-wallet.tsx': '690cdf42d8730fe6206e92f84a9ec8e6ffeac0c6',
 'app/use-header-panel.ts': '24a3e6e3fb54ed67b28c348d77f1b92e60310448',
 'app/use-room-updates.ts': None,
 'app/use-top-panel-position.ts': None,
 'docs/design/brand-arrival.md': None,
 'docs/mobile/iphone-interface.md': 'e4fc69981cf054614ec72e7915c67df4a47b4528',
 'lib/attendee-auth.ts': '99a70a6d78fd3c0d8a7d4839de00bafd0bd3dd80',
 'lib/brand-arrival.ts': None,
 'lib/room-update-summary.ts': None,
 'lib/room-updates.ts': None,
 'lib/top-panel-position.ts': None,
 'package.json': 'a3db62441e7b0c8676dc1a166b913004af92eedd',
 'tests/brand-arrival.test.mjs': None,
 'tests/e2e/brand-arrival.spec.ts': None,
 'tests/e2e/customer-feedback.spec.ts': '28c355219aa8a55e51b429072bff8b031fc3f62e',
 'tests/e2e/menu-option-a.spec.ts': None,
 'tests/e2e/mobile-app-behavior.spec.ts': 'adbcc5000de0965671bb529af1835d595b4be1e2',
 'tests/e2e/room-shortcut.spec.ts': None,
 'tests/header-panel-focus.test.mjs': 'c8b2e33c326812fd6d68574e1f047512de00de51',
 'tests/menu-option-a.test.mjs': None,
 'tests/mobile-ui.test.mjs': '7be7869649ce4d5880c2cf51be54a5b3ce77a528',
 'tests/room-update-client.test.mjs': None,
 'tests/room-updates.test.ts': None,
 'tests/top-panel-position.test.ts': None}
NAVIGATION_APPLICATION_BLOBS = {'app/api/customer/room-updates/route.ts': 'f2431a97449c47728f29d7812b094aa9fca705f4',
 'app/api/rooms/[slug]/access/route.ts': '122acf520ef0bbd023163792ffdf9aaf2df0858b',
 'app/api/rooms/[slug]/updates/read/route.ts': '22bfa3dccd8141ef89e58d5a16ba52eb43c2308c',
 'app/brand-arrival.css': 'f92c1856c052d3357e8f230e806caae426705c92',
 'app/brand-arrival.tsx': '50281d16be1aefe130edc24118957381bafa3611',
 'app/customer-dock.tsx': '28ad0341bf1f15dfbcc7d630475ae18296c971be',
 'app/iphone-interface.css': '7cf1f56c8429ab4e66d983474b29a49e5b6e40a8',
 'app/layout.tsx': '349f0cbabcd8020bb178bc66ff96c3a271eda1ed',
 'app/mobile-navigation.tsx': '5450c96b389640d6cba47f20557fe991a3a8358b',
 'app/notification-bell.tsx': 'f64fd65812006bd450554709c5ad02158c060862',
 'app/notifications/notification-panel.tsx': '1263d504e9479e7d9e4ef808751dc538ff5aac7e',
 'app/room-overlay.tsx': 'a0885b8e14160eaa95534f43a408b563bd0bada9',
 'app/room-shortcut.css': '1973e6455afeae3a70640cff9cc52a6a1fadbff5',
 'app/room/[slug]/room-client.tsx': '9901bd498c867272f16701a43e32ff5287b4e14a',
 'app/tickets/ticket-wallet.tsx': 'f0cdd0b6e698c79b09704485fc92bd62d0f44be7',
 'app/use-header-panel.ts': '4f63d87e17dc785b18843b8191434331b2a1dbce',
 'app/use-room-updates.ts': '47f84a50890035f3eaf1dfede9d71a995a563249',
 'app/use-top-panel-position.ts': 'c198f8df3646a1a8191986459d26441ea55c10d9',
 'docs/design/brand-arrival.md': 'f6e4bb364421ad7288c7346f47d596be6b86530a',
 'docs/mobile/iphone-interface.md': '52d28270de3d8125da31dbe70762fd5a38c1fa35',
 'lib/attendee-auth.ts': '00c9e1e869a3b36cca533ba23524a005fe684c9d',
 'lib/brand-arrival.ts': '145955101e3f847d41b25bfb7d9193838e01db14',
 'lib/room-update-summary.ts': 'b10912adc58b9b155090c004c130a5ce9d84f4e0',
 'lib/room-updates.ts': 'cf4b3fccf25f1d280fef807c8c88fc3c51badbf3',
 'lib/top-panel-position.ts': '240d1ff8a1d212abba2fdbd48ffcafffbabba6df',
 'package.json': '53d1f8f8d2a69e12757a854b52cdc1d5cb4a1a46',
 'tests/brand-arrival.test.mjs': '451ef141ba4b14bcbc087541aa2a2aeee7c40071',
 'tests/e2e/brand-arrival.spec.ts': '69073eea8110e3783e7a5dd51a2986ff8433fecc',
 'tests/e2e/customer-feedback.spec.ts': '6738acad48bac13f9dbaa683c05fecfba44a2210',
 'tests/e2e/menu-option-a.spec.ts': 'bd6d6db6da4be435b73b960d6a664e08dda8144b',
 'tests/e2e/mobile-app-behavior.spec.ts': 'b0b336ee944c09b938815660cb70dc58578b7568',
 'tests/e2e/room-shortcut.spec.ts': 'dce5aece13dc9ef638777f7a05668f02aab9f59b',
 'tests/header-panel-focus.test.mjs': '9a922b8ab93d24fd85324cd773a6aa691d8e7e1e',
 'tests/menu-option-a.test.mjs': 'd9ea4553aa579a03d4bb401201f773de89db96ac',
 'tests/mobile-ui.test.mjs': '405c23b32bd288b47540194f18ead1fd23e60a3b',
 'tests/room-update-client.test.mjs': 'b999cae000af0d70eccb814b659b57b03872cf15',
 'tests/room-updates.test.ts': 'f189f11b585879ab5195f9dba8d704f26fa16761',
 'tests/top-panel-position.test.ts': '85b1447323e1cea78abf5c321f1314336d1e4553'}
NAVIGATION_DEPENDENCY_BLOBS = {'mobile/package-lock.json': 'ef19daa868045d26c686ed003a29f183bc144e84',
 'mobile/package.json': '552fbe9817bdcfd4d9ecc898fbbabcc8cf17dc92'}
NAVIGATION_PREREQUISITE_INPUTS = {'package-lock.json': '3fa4bfae990eac872f88c72d30a51c995c35574d',
 'package.json': 'a3db62441e7b0c8676dc1a166b913004af92eedd'}
NAVIGATION_PREREQUISITE_BLOBS = {'package-lock.json': 'bad17d8e69775f8077bda31df27cb27ace0c7918',
 'package.json': 'd60595d1d10f8e3bb88c3d88fec658dce0a36be1'}
NAVIGATION_TEST_SCRIPT_APPENDS = {
    'test:repo': ' tests/room-update-client.test.mjs',
    'test:ui': ' tests/header-panel-focus.test.mjs tests/menu-option-a.test.mjs tests/brand-arrival.test.mjs',
}


# Exact post-navigation filters and bounded Room/test-budget maintenance.
# C changes only two controls; P retains the complete independently reviewed S.
# No dependency, workflow, schema, audit-policy or permission change is allowed.
FILTERS_ROOM_RELEASE_BASELINE = '31cf526ad86b678c5193b405d0ce2420238f9586'
FILTERS_ROOM_RELEASE_BASE_TREE = '5fda675b1d23d065ad93dad7a38cca0e5c0ecd5f'
FILTERS_ROOM_APP_SNAPSHOT = '1aeea7662ec5b979463cf21282b70c92190694b8'
FILTERS_ROOM_APP_TREE = 'dddd0cb54a8b2261f44b6928e3aa6ae8f4e7da43'
FILTERS_ROOM_CONTROL_FILES = {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
FILTERS_ROOM_APPLICATION_INPUTS = {'app/customer-dock.tsx': '28ad0341bf1f15dfbcc7d630475ae18296c971be',
 'app/registration-form.tsx': '3377c892e301dd8c8ab79a1b0b25bd29b148631d',
 'app/room-features.css': '2b152ff8f704c23113ceab7c80d917e16f64e807',
 'app/room/[slug]/flash-camera.tsx': '4a2d15fd48c0ed3d254c439f3658ad158e3a065f',
 'app/room/[slug]/flash-look-picker.tsx': None,
 'app/room/[slug]/flash-viewer.tsx': 'f2961ec4eab16d6d182921a50d4a6174141b745a',
 'app/room/[slug]/room-client.tsx': '9901bd498c867272f16701a43e32ff5287b4e14a',
 'app/use-room-updates.ts': '47f84a50890035f3eaf1dfede9d71a995a563249',
 'docs/design/flashes-cinematic-filters.md': None,
 'lib/flash-photo-filters.ts': None,
 'package.json': '53d1f8f8d2a69e12757a854b52cdc1d5cb4a1a46',
 'scripts/preview-flash-filters.mjs': None,
 'tests/e2e/flash-camera.spec.ts': None,
 'tests/e2e/public-journey.spec.ts': '3a1b562918d91cfd0882684a47d1c8537996c81d',
 'tests/e2e/room-features.spec.ts': 'f9e895a6422d1f33ffc4b13094f5f0ed2406a4f0',
 'tests/e2e/room-shortcut.spec.ts': 'dce5aece13dc9ef638777f7a05668f02aab9f59b',
 'tests/flash-camera-state.test.mjs': None,
 'tests/flash-photo-filters.test.mjs': None,
 'tests/room-lifecycle.test.mjs': None}
FILTERS_ROOM_APPLICATION_BLOBS = {'app/customer-dock.tsx': '674b40073b4f21d5621a1719b2f48c668f64e264',
 'app/registration-form.tsx': '555271f87033e08e64575a35f0041855d3ad8e41',
 'app/room-features.css': '3dcef6b137313e40b0aedbd4237065f21ff92ec1',
 'app/room/[slug]/flash-camera.tsx': 'b5a156b3b75674f9cd71eec5ea3ec0c505428b92',
 'app/room/[slug]/flash-look-picker.tsx': 'f4ffc8b16b1378b71dc7f09b0265a925a1216139',
 'app/room/[slug]/flash-viewer.tsx': 'e140bfc51dfcf2d719c556e4dfcb19d148b8588e',
 'app/room/[slug]/room-client.tsx': '7553467949f07e199c85439dc129e785fdfa4184',
 'app/use-room-updates.ts': 'a10c53fc340aafe186132eaefe3968c570b8a08a',
 'docs/design/flashes-cinematic-filters.md': 'ded1d86ae0aee075341032e9aee3ea269637cb66',
 'lib/flash-photo-filters.ts': '8392734c6593ec495f92705f2f8572218093f9e8',
 'package.json': '9ecd5cbf859c38a7b4768cfaa0d1ca7c7f33ea36',
 'scripts/preview-flash-filters.mjs': '2352b1b4db62637a1323e700958fdb6e44d84a64',
 'tests/e2e/flash-camera.spec.ts': '8fccee112fb70d58fc1d5618314bfff05b4d98ca',
 'tests/e2e/public-journey.spec.ts': '36953eca91c0188a7db5d41c2d76f687fab383cf',
 'tests/e2e/room-features.spec.ts': '79c1dc9aefdbf88348beeb476ed258f7dc5b349c',
 'tests/e2e/room-shortcut.spec.ts': '7be29aba38e78c939e10364e010ac342e62e2694',
 'tests/flash-camera-state.test.mjs': '14fe34f80f08e810837facb9406da3b5c6bd66fc',
 'tests/flash-photo-filters.test.mjs': 'c4e4daa843aeaf63f02e5ab72939eeab6f3a541b',
 'tests/room-lifecycle.test.mjs': 'b197a89b4907d8e8282f5b984213842295e6bc60'}
FILTERS_ROOM_DEPENDENCY_BLOBS = {'mobile/package-lock.json': 'ef19daa868045d26c686ed003a29f183bc144e84',
 'mobile/package.json': '552fbe9817bdcfd4d9ecc898fbbabcc8cf17dc92',
 'package-lock.json': 'bad17d8e69775f8077bda31df27cb27ace0c7918'}
FILTERS_ROOM_TEST_SCRIPT_APPENDS = {'test:repo': ' tests/room-lifecycle.test.mjs',
 'test:ui': ' tests/flash-photo-filters.test.mjs tests/flash-camera-state.test.mjs'}


# Exact M-based recovery readiness and candidate-only synthetic camera audit scope.
# Independent C changes only the two controls; P retains the published source S.
# No package, dependency, workflow, runtime, audit-policy or migration change.
RECOVERY_AUDIT_RELEASE_BASELINE = '712fa5d10b353f847533003e09cc64ec9ebba1bb'
RECOVERY_AUDIT_RELEASE_BASE_TREE = '192517ff2e9fa612e3c939e54bf5658f46d06584'
RECOVERY_AUDIT_APP_SNAPSHOT = '81e016eb1f3e54e7e2083574069cf0a43d8f569b'
RECOVERY_AUDIT_APP_TREE = '4e74fde95272012126f119d5ee9d67f51867335e'
RECOVERY_AUDIT_CONTROL_FILES = {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
RECOVERY_AUDIT_APPLICATION_INPUTS = {'app/my-nights/my-nights-client.tsx': '3bf1ca4484332cd2c73a1ff525483b10ea368782',
 'tests/browser-audit-harness.test.mjs': 'a422c372910c600870a5f072dc146fe16e553a40',
 'tests/e2e/discovery-pass-access.spec.ts': '96c88875c6ec2e99e0b0a6b4aca280ca66851731',
 'tests/e2e/flash-camera.spec.ts': '8fccee112fb70d58fc1d5618314bfff05b4d98ca',
 'tests/my-nights-refresh.test.mjs': 'ca13ed25d6fa3758acb359b207b6b70b1dda4093'}
RECOVERY_AUDIT_APPLICATION_BLOBS = {'app/my-nights/my-nights-client.tsx': '34e5f4ab5dcda3ba059cd2fcbd7f6810e00380cd',
 'tests/browser-audit-harness.test.mjs': 'bc1e79e0916c2bfc2fd57a98e92aa12c55879304',
 'tests/e2e/discovery-pass-access.spec.ts': 'bf34b4773c5acb26d1ed903e1ea014824f305ad8',
 'tests/e2e/flash-camera.spec.ts': 'ff86b09b19e6e255ca39cc451e3d0e50dcf5b217',
 'tests/my-nights-refresh.test.mjs': 'e80ed4a4bd86c20e996980f7d7d57de55557f957'}
RECOVERY_AUDIT_DEPENDENCY_BLOBS = {'mobile/package-lock.json': 'ef19daa868045d26c686ed003a29f183bc144e84',
 'mobile/package.json': '552fbe9817bdcfd4d9ecc898fbbabcc8cf17dc92',
 'package-lock.json': 'bad17d8e69775f8077bda31df27cb27ace0c7918',
 'package.json': '9ecd5cbf859c38a7b4768cfaa0d1ca7c7f33ea36',
 'runtime/vps/package.json': 'e37de887cb29595c07fa90025cb314e978222baa'}


# Exact website-listing exclusion, header menu, PWA resilience and Next.js patch.
# Independent C contains only the controls and exact Next.js security prerequisite.
# Root package/lock inputs and outputs are pinned; test registrations remain S/P-only.
# Other dependencies, workflows, audit policy, access, runtime and migrations stay fixed.
INTEGRATED_EXPERIENCE_RELEASE_BASELINE = '4c5f395b75837725beb990e27261e3ad367c1314'
INTEGRATED_EXPERIENCE_RELEASE_BASE_TREE = 'e3c30e6a0cadfac282f6f8e5c793ac18e8a83c08'
INTEGRATED_EXPERIENCE_APP_SNAPSHOT = 'e7f382b907629b053cd04311f0d5e44255e31612'
INTEGRATED_EXPERIENCE_APP_TREE = '63cbf62a157fe997ca267d1274660771070152b0'
INTEGRATED_EXPERIENCE_CONTROL_FILES = {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
INTEGRATED_EXPERIENCE_APPLICATION_INPUTS = {'app/events/page.tsx': '72e2811199aa4c96f073d5b116e474f91d5e4e9a',
 'app/global-error.tsx': None,
 'app/header-origin-menu.css': None,
 'app/hosts/[slug]/page.tsx': '4390e2525c64968d22c8e738021293d6fb9e4655',
 'app/mobile-app-frame.tsx': '33559c6475f4b025e821b33c13d55a5b062391e9',
 'app/mobile-navigation.tsx': '5450c96b389640d6cba47f20557fe991a3a8358b',
 'app/page.tsx': 'db81c6b2d430006a0d1b323ee7a1be31a4576cf6',
 'app/pwa-registration.tsx': '13dc55885d8bf4ad4520fe2850c66918621fcbac',
 'app/room/[slug]/room-client.tsx': '7553467949f07e199c85439dc129e785fdfa4184',
 'app/sitemap.ts': 'b7c91ad4ec237f179dccfddfb4af8b1465dce362',
 'app/use-header-panel.ts': '4f63d87e17dc785b18843b8191434331b2a1dbce',
 'docs/audits/pwa-resume-2026-10-23.md': None,
 'lib/mobile-viewport.ts': None,
 'lib/room-viewport.ts': None,
 'lib/website-event-listings.ts': None,
 'package.json': '9ecd5cbf859c38a7b4768cfaa0d1ca7c7f33ea36',
 'styles/customer.css': 'c6d3cc402fcb37287444c9ac75777424ceeac891',
 'tests/e2e/discovery-pass-access.spec.ts': 'bf34b4773c5acb26d1ed903e1ea014824f305ad8',
 'tests/e2e/event-details.spec.ts': '76775953efa8ef1a4358e6a25acdf26a53c14736',
 'tests/e2e/host-profile.spec.ts': 'ba099658c2866802b436855819bcefd39f50074b',
 'tests/e2e/menu-option-a.spec.ts': 'bd6d6db6da4be435b73b960d6a664e08dda8144b',
 'tests/e2e/mobile-app-behavior.spec.ts': 'b0b336ee944c09b938815660cb70dc58578b7568',
 'tests/e2e/public-journey.spec.ts': '36953eca91c0188a7db5d41c2d76f687fab383cf',
 'tests/e2e/published-catalogue.spec.ts': '7578c37a441e06ce10b0b87fa2cb4c412dee4684',
 'tests/e2e/pwa-resume.spec.ts': None,
 'tests/e2e/website-event-unlisting.spec.ts': None,
 'tests/header-origin-menu.test.mjs': None,
 'tests/menu-option-a.test.mjs': 'd9ea4553aa579a03d4bb401201f773de89db96ac',
 'tests/mobile-ui.test.mjs': '405c23b32bd288b47540194f18ead1fd23e60a3b',
 'tests/pwa-resume.test.mjs': None,
 'tests/website-event-listings.test.ts': None}
INTEGRATED_EXPERIENCE_APPLICATION_BLOBS = {'app/events/page.tsx': 'fba48076da86f381c27339db7ba290bf1f12e835',
 'app/global-error.tsx': 'd1a4b2d25ff1d796ffdc967ba874ad1011cfa328',
 'app/header-origin-menu.css': '87b9c852ac8d693de75724cb4f1cca33cb8dbdaa',
 'app/hosts/[slug]/page.tsx': 'cd9a1372f923ff8b9542ea8cda12dae0662206a5',
 'app/mobile-app-frame.tsx': 'a17c531970c755c6dc646b6791e59328db822fc5',
 'app/mobile-navigation.tsx': '51fb72c23f0788fdaa7ee46bf11ed034fce31c79',
 'app/page.tsx': '483383be20e94ba007b3fd86e694962dab167dc4',
 'app/pwa-registration.tsx': 'd97ac772787aebfd0a59ac2fd752394cd14302d2',
 'app/room/[slug]/room-client.tsx': '8ac1b0535e85abdca999598cd30dac01c7d949d7',
 'app/sitemap.ts': '2f6dd2eb4ca539eec380631d26c4d8a94bb75287',
 'app/use-header-panel.ts': '6052f5c275f5142c40bb06e1c55f94ceae25a9ed',
 'docs/audits/pwa-resume-2026-10-23.md': 'd65eab1b2df293a2cb5f69cde7ae802e107cc28c',
 'lib/mobile-viewport.ts': '20a3a8aefd7ee3f8c5f2dd4cd0e7da7575282a43',
 'lib/room-viewport.ts': 'ee7f3a7b89cc01686e9398e29964bae6f92d0a0b',
 'lib/website-event-listings.ts': '77a182916880cb4eaeebdc7d87288f84834b8feb',
 'package.json': 'd4dc400662fa9a63435f70da0374f51a87fd3c19',
 'styles/customer.css': '91c84bbd74df2347bbcb8615fb670e29a59b8462',
 'tests/e2e/discovery-pass-access.spec.ts': 'bfd80a5f2af6d6027e0f1fd98eb8030247b5d56c',
 'tests/e2e/event-details.spec.ts': '53b643a49ae9a38c7f41f9c3f1b854e664fd4351',
 'tests/e2e/host-profile.spec.ts': 'b863f3c3b1a48b1068134cd6b6348ce454568201',
 'tests/e2e/menu-option-a.spec.ts': '9e5967d162016a520b5520ab866cabad3c2b8645',
 'tests/e2e/mobile-app-behavior.spec.ts': '76be65b6ec1748b18fbd28bedeeeaf71f432593a',
 'tests/e2e/public-journey.spec.ts': '6cdf7e9c9fd330f9875ff44bce66b76664dbde71',
 'tests/e2e/published-catalogue.spec.ts': '0b8a0929b7579fb520f4013399321ad97637f421',
 'tests/e2e/pwa-resume.spec.ts': '25c637087dda172d89d7130e2fcc669deed02543',
 'tests/e2e/website-event-unlisting.spec.ts': '75fb84bf2cddb3925893926d77201b39e38050a5',
 'tests/header-origin-menu.test.mjs': '4178145113c4f712e5d17604f676103475a0cb24',
 'tests/menu-option-a.test.mjs': '9f74f310f31efb87debb3d787067bed85b6931ac',
 'tests/mobile-ui.test.mjs': 'f09ae5135a867cc229f787c2fd61214a9006b165',
 'tests/pwa-resume.test.mjs': 'f569c8ee490617bdf16e560c0a58708210826238',
 'tests/website-event-listings.test.ts': 'c83a089e54a58a7461766158fc9ad7f9ac617500'}
INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS = {'mobile/package-lock.json': 'ef19daa868045d26c686ed003a29f183bc144e84',
 'mobile/package.json': '552fbe9817bdcfd4d9ecc898fbbabcc8cf17dc92',
 'runtime/vps/package.json': 'e37de887cb29595c07fa90025cb314e978222baa'}

INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS = {'package-lock.json': 'bad17d8e69775f8077bda31df27cb27ace0c7918',
 'package.json': '9ecd5cbf859c38a7b4768cfaa0d1ca7c7f33ea36'}
INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS = {'package-lock.json': '607dce6d28154ac15c8de1abc6083828e6317e12',
 'package.json': '29dd9100982f0da8a90e8fd360a48440770c40c2'}

HOST_RSVP_PUSH_PATH = "drizzle/0063_host_rsvp_push.sql"
RECOVERABLE_ARCHIVE_PATH = "drizzle/0065_recoverable_event_archive.sql"
OWNER_NOTIFICATIONS_PATH = "drizzle/0066_owner_event_notifications.sql"
HOST_BRAND_IDENTITY_PATH = "drizzle/0067_host_brand_identity.sql"
WORKSPACE_SCHEMA_PATHS = (RECOVERABLE_ARCHIVE_PATH, OWNER_NOTIFICATIONS_PATH)
# The two outbox tables and three indexes from the exact admitted 0063 schema.
# Neither these objects nor their existing rows may change when replacing its
# two capture triggers. No historical deliveries are inserted by this release.
OWNER_NOTIFICATION_PREREQUISITES = {
    "organizer_push_subscriptions", "organizer_push_account",
    "organizer_rsvp_push_deliveries", "organizer_rsvp_push_device", "organizer_rsvp_push_pending",
}
OWNER_NOTIFICATION_PREREQUISITES_SHA256 = "3c72c8eae3da1a730338f35f9ea5980a13ab1b5576c4c1e378c8b49996de2527"
STAFF_OWNER_GUARD_PATH = "drizzle/0060_staff_owner_integrity.sql"
HOST_VERIFICATION_PATH = "drizzle/0059_kofi_bills_verified_host.sql"
PINK_EDITION_PATH = "drizzle/0062_guest_list_confirmed_october_25.sql"
PINK_EDITION_ASSETS = {
    "/events/on-the-guest-list-20261025.webp": "339f178efb30268411b30ccc418a28d8b210262e7fd76552ded804fe23c2c43d",
    "/events/on-the-guest-list-20261025-email.jpg": "ee0a8c9450ec9ebf58c03667f8fec1c848feb65f263a3865068ef17318a4e64b",
}
# Confirmed in the immutable pre-failure backup and generated from the original
# handover writerGuardStatements(['hosts']). Never remove or disable these guards.
HOST_WRITER_GUARDS = {
    "_bct_guard_hosts_delete": "444b3676092af1ff98b1385bf801469f846cd7453f8b8fb4cda2b45bdc3c9a11",
    "_bct_guard_hosts_insert": "d1735171feb3d6a70de76224d2ad2c8417ce5a64e03e271a406fefba695c4571",
    "_bct_guard_hosts_update": "993741626e1e5f828e1dd1c681fed62e180645e837e0bcf95fa709bdbd7285ce",
}
HOST_WRITER_CONTROL_SCHEMA = "612caa86b3f0bf636dab09beb9c9bdd8b3fa042cc7ed5917dce0fef9c849f591"
REVIEWED_MIGRATIONS = {
    HOST_BRAND_IDENTITY_PATH: {
        "kind": "kofi-bills-brand-identity",
        "blob": "03341823c192635fdb84fa51cb56b7b742e84bd0",
        "sha256": "a6b7efb3ab1b76dc8d4ff3c91e7f017d47fa3feaeff2ce9145ecb1673744bdec",
        "beforeSchemaSha256": "c76fe019ff802163ec689af28f8c1bca103ea240eef41a4742be279fa3696c1c",
        "schemaSha256": "e1811ef41723fb899fc8ad95535725cee147db09d4195fd13dcd56852cbb430c",
    },
    RECOVERABLE_ARCHIVE_PATH: {
        "kind": "recoverable-event-archive",
        "blob": "28970c4f5b2dcd706357c60e1af9178201c57408",
        "sha256": "8c6781a96369ac46546df248416b9e670138cfaabf955e63b2e78d6692043cc9",
        "beforeSchemaSha256": "4bda7df653f889115f123decc2e1d85fed245fdf697e60aab0b2aa19931e7e07",
        "schemaSha256": "b9a877b17f682097be0b324321cf51c9afa737fd440c6ece2ddfa0a6576b2305",
        "objects": ["curated_event_archive_idx", "curated_event_records"],
    },
    OWNER_NOTIFICATIONS_PATH: {
        "kind": "owner-event-notifications",
        "blob": "e9842189f6b63dc72c90997773cb61edb34842b7",
        "sha256": "a23ddeeb8e4d4e8cad94246d6a807a9c4aba2037e427a0a2e7052f61e7396f25",
        "beforeSchemaSha256": "a4a54363400ac45a9ded3decc38f989194c1740239461e9dd336de9def056d63",
        "schemaSha256": "ecbaffb928eb8994cd254d749ef6f034d8d7c0dab82ef296459a89194832a5fb",
        "objects": ["organizer_rsvp_push_created", "organizer_rsvp_push_verified"],
    },
    "drizzle/0064_host_purchase_push.sql": {'blob': 'a0abdccd9551012b5759294db1cc32f83bf69240', 'sha256': '483a853e328a9217cd3195a9ea4bc86be3bd4eabce5bd5afe228b4b3737391cd', 'schemaSha256': 'b8b8ef20df80920fba1e0a45425aed53a907646bdc43a5bfc4ce19cf9b0e2d75', 'tables': ['organizer_purchase_push_deliveries']},
    HOST_RSVP_PUSH_PATH: {'blob': '77ab9cbf55b43609f3e478fb5ff8807d7927f02a', 'sha256': '916a7f508d43fbd97061df03db9f1745f5ffabf95de764772c9725e78be539ea', 'schemaSha256': 'a9f7a6cf47d5e95bedf5b971496c305177b75ed9cc783451e733962765bd69f8', 'tables': ['organizer_push_subscriptions', 'organizer_rsvp_push_deliveries'], 'triggers': {'organizer_rsvp_push_created': 'event_registrations', 'organizer_rsvp_push_verified': 'event_registrations'}},
    PINK_EDITION_PATH: {'kind': 'pink-edition-confirmed', 'blob': 'f6282183059583f9ac9254977e1cc36706c7f3ca', 'sha256': '338d89e27f255535a41f05b2a60c5eb6639f690218db61f38060b11c8c506df5'},
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


def reviewed_yorke_application_blobs(expected, source):
    """Admit only reviewed S application bytes, with independently merged C."""
    require(git("rev-parse", expected + "^{tree}") == YORKE_BASE_TREE
            and git("rev-parse", YORKE_APP_SNAPSHOT + "^{tree}") == YORKE_APP_TREE
            and git("rev-list", "--parents", "-n", "1", YORKE_APP_SNAPSHOT)
            == YORKE_APP_SNAPSHOT + " " + expected,
            "Yorke snapshot or its exact baseline changed.")
    require(set(git("diff", "--name-only", expected, YORKE_APP_SNAPSHOT).splitlines())
            == set(YORKE_APPLICATION_BLOBS) | YORKE_MIGRATION_FILES,
            "Yorke snapshot differs from its complete reviewed inventory.")
    verify_trusted_operator(source)
    trusted = os.environ["BECORE_TRUSTED_BASE"]
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, trusted],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, trusted).splitlines()) == YORKE_CONTROL_FILES,
            "Yorke trusted controls must change only the two reviewed control files.")
    verify_changed_modes(expected, trusted)
    require(set(git("diff", "--name-only", YORKE_APP_SNAPSHOT, source).splitlines())
            <= YORKE_CONTROL_FILES,
            "Yorke candidate differs from the exact application snapshot.")
    pins = {**REVIEWED_APPLICATION_BLOBS, **YORKE_APPLICATION_BLOBS}
    for name in sorted(YORKE_CONTROL_FILES):
        require(git("ls-tree", source, "--", name) == git("ls-tree", trusted, "--", name),
                "Yorke candidate controls differ from the trusted baseline.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    # The SQL path still needs its separate reviewed migration entry/validator.
    return pins


def reviewed_readiness_application_blobs(expected, source):
    """Bind live L, exact merged advisory A, snapshot S and independent C/P."""
    advisory = RSVP_READINESS_ADVISORY_BASE
    snapshot = RSVP_READINESS_APP_SNAPSHOT
    require(git("rev-parse", expected + "^{tree}") == RSVP_READINESS_LIVE_TREE
            and git("rev-parse", advisory + "^{tree}") == RSVP_READINESS_ADVISORY_TREE,
            "Readiness live or advisory baseline changed.")
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, advisory],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, advisory).splitlines())
            == set(RSVP_READINESS_ADVISORY_BLOBS),
            "Readiness advisory baseline differs from its complete reviewed inventory.")
    verify_changed_modes(expected, advisory)
    for name, blob in RSVP_READINESS_ADVISORY_BLOBS.items():
        require(git("rev-parse", advisory + ":" + name) == blob,
                "Readiness advisory baseline differs from reviewed source: " + name)
    require(git("rev-parse", snapshot + "^{tree}") == RSVP_READINESS_APP_TREE
            and git("rev-list", "--parents", "-n", "1", snapshot) == snapshot + " " + advisory,
            "Readiness snapshot must be the exact direct child of the advisory baseline.")
    require(set(git("diff", "--name-only", advisory, snapshot).splitlines())
            == set(RSVP_READINESS_APPLICATION_BLOBS),
            "Readiness snapshot differs from its complete reviewed inventory.")
    verify_trusted_operator(source)
    trusted = os.environ["BECORE_TRUSTED_BASE"]
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", advisory, trusted],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", advisory, trusted).splitlines())
            == RSVP_READINESS_CONTROL_FILES,
            "Readiness trusted controls must change only the two reviewed control files from advisory baseline.")
    verify_changed_modes(advisory, trusted)
    require(set(git("diff", "--name-only", snapshot, source).splitlines())
            <= RSVP_READINESS_CONTROL_FILES,
            "Readiness candidate differs from the exact application snapshot.")
    pins = {**REVIEWED_APPLICATION_BLOBS, **RSVP_READINESS_ADVISORY_BLOBS,
            **RSVP_READINESS_APPLICATION_BLOBS}
    for name in sorted(RSVP_READINESS_CONTROL_FILES):
        require(git("ls-tree", source, "--", name) == git("ls-tree", trusted, "--", name),
                "Readiness candidate controls differ from the trusted baseline.")
        # A's test blob is evidence of the independently merged advisory change.
        # P must instead carry the exact newly reviewed C test/control entries.
        pins[name] = git("rev-parse", trusted + ":" + name)
    return pins


def reviewed_parallel_application_blobs(expected, source):
    """Admit one complete B/C/P inventory; no application authority is added."""
    trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(expected == PARALLEL_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == PARALLEL_RELEASE_BASE_TREE,
            "Parallel release baseline differs from its exact reviewed tree.")
    require(SHA.fullmatch(trusted) and trusted not in (expected, source),
            "Parallel controls require an independent merged baseline.")
    verify_trusted_operator(source)
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, trusted],
                   check=True, env=git_environment(), timeout=60)
    all_files = set(PARALLEL_OUTPUT_BLOBS) | PARALLEL_CONTROL_FILES
    control_files = all_files - {PARALLEL_PROMOTION_FILE}
    require(len(PARALLEL_OUTPUT_BLOBS) == 13 and len(all_files) == 15
            and set(git("diff", "--name-only", expected, trusted).splitlines()) == control_files,
            "Parallel trusted controls differ from the complete 14-path inventory.")
    require(not git("ls-tree", trusted, "--", PARALLEL_PROMOTION_FILE)
            and set(git("diff", "--name-only", trusted, source).splitlines()) == {PARALLEL_PROMOTION_FILE}
            and set(git("diff", "--name-only", expected, source).splitlines()) == all_files,
            "Parallel promotion must add only the reserved test in the complete 15-path inventory.")
    verify_changed_modes(expected, trusted)
    verify_changed_modes(trusted, source)
    pins = dict(PARALLEL_OUTPUT_BLOBS)
    for name, blob in PARALLEL_OUTPUT_BLOBS.items():
        entry = PARALLEL_OUTPUT_MODES[name] + " blob " + blob + "\t" + name
        require(git("ls-tree", source, "--", name) == entry,
                "Parallel output differs from its reviewed blob or mode: " + name)
        if name != PARALLEL_PROMOTION_FILE:
            require(git("ls-tree", trusted, "--", name) == entry,
                    "Parallel trusted output differs from its reviewed blob or mode: " + name)
    for name in sorted(PARALLEL_CONTROL_FILES):
        entry = git("ls-tree", trusted, "--", name)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(name), entry)
                and git("ls-tree", source, "--", name) == entry,
                "Parallel control differs from its independent trusted entry.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    require(not migration_plan(all_files), "Parallel rollout cannot introduce migrations.")
    return pins


def reviewed_cinco_application_blobs(expected, source):
    """Admit only the exact receipt patch on independently merged controls."""
    require(expected == CINCO_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == CINCO_RELEASE_BASE_TREE
            and git("rev-parse", CINCO_ADVISORY_BASE + "^{tree}") == CINCO_ADVISORY_TREE,
            "CINCO live or advisory baseline changed.")
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, CINCO_ADVISORY_BASE],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, CINCO_ADVISORY_BASE).splitlines())
            == set(CINCO_ADVISORY_BLOBS) | CINCO_CONTROL_FILES,
            "CINCO advisory inventory changed.")
    for name, blob in CINCO_ADVISORY_BLOBS.items():
        require(git("rev-parse", CINCO_ADVISORY_BASE + ":" + name) == blob,
                "CINCO advisory blob changed: " + name)
    verify_trusted_operator(source)
    trusted = os.environ["BECORE_TRUSTED_BASE"]
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", CINCO_ADVISORY_BASE, trusted],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", CINCO_ADVISORY_BASE, trusted).splitlines()) == CINCO_CONTROL_FILES,
            "CINCO trusted controls contain unreviewed changes.")
    require(set(git("diff", "--name-only", trusted, source).splitlines()) == set(CINCO_APPLICATION_BLOBS),
            "CINCO candidate differs from the exact six-file application patch.")
    verify_changed_modes(expected, source)
    pins = {**CINCO_ADVISORY_BLOBS, **CINCO_APPLICATION_BLOBS}
    for name, blob in pins.items():
        require(git("ls-tree", source, "--", name) == "100644 blob " + blob + "\t" + name,
                "CINCO output differs from its reviewed blob or mode: " + name)
    for name in sorted(CINCO_CONTROL_FILES):
        require(git("ls-tree", source, "--", name) == git("ls-tree", trusted, "--", name),
                "CINCO candidate controls differ from the trusted baseline.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    require(not migration_plan(pins), "CINCO receipt release cannot introduce migrations.")
    return pins


def reviewed_cinco_recovery_application_blobs(expected, source):
    """Admit exactly L -> two workflows -> merged controls -> reviewed patch."""
    advisory = CINCO_RECOVERY_ADVISORY_BASE
    controls = CINCO_RECOVERY_CONTROL_FILES
    require(expected == CINCO_RECOVERY_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == CINCO_RECOVERY_RELEASE_BASE_TREE
            and git("rev-parse", advisory + "^{tree}") == CINCO_RECOVERY_ADVISORY_TREE,
            "CINCO recovery live or advisory baseline changed.")
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, advisory],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, advisory).splitlines())
            == set(CINCO_RECOVERY_ADVISORY_BLOBS),
            "CINCO recovery advisory inventory changed.")
    verify_changed_modes(expected, advisory)
    for name, blob in CINCO_RECOVERY_ADVISORY_BLOBS.items():
        require(not git("ls-tree", expected, "--", name)
                and git("ls-tree", advisory, "--", name) == "100644 blob " + blob + "\t" + name,
                "CINCO recovery advisory addition changed: " + name)
    trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(SHA.fullmatch(trusted) and trusted not in (expected, advisory, source),
            "CINCO recovery requires independent merged controls.")
    verify_trusted_operator(source)
    # A same-named local tag must never impersonate the remote main branch.
    for ancestor, descendant in ((advisory, trusted), (trusted, "refs/remotes/origin/main")):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", advisory, trusted).splitlines()) == controls,
            "CINCO recovery trusted controls contain unreviewed changes.")
    require(CINCO_RECOVERY_APPLICATION_BLOBS
            and set(git("diff", "--name-only", trusted, source).splitlines())
            == set(CINCO_RECOVERY_APPLICATION_BLOBS),
            "CINCO recovery candidate differs from the complete reviewed application patch.")
    verify_changed_modes(advisory, trusted)
    verify_changed_modes(trusted, source)
    pins = {**CINCO_RECOVERY_ADVISORY_BLOBS, **CINCO_RECOVERY_APPLICATION_BLOBS}
    for name, blob in pins.items():
        require(git("ls-tree", source, "--", name) == "100644 blob " + blob + "\t" + name,
                "CINCO recovery output differs from its reviewed blob or mode: " + name)
    for name in sorted(controls):
        entry = git("ls-tree", trusted, "--", name)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(name), entry)
                and git("ls-tree", source, "--", name) == entry,
                "CINCO recovery controls differ from their independent trusted entry.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    require(not migration_plan(pins), "CINCO recovery release cannot introduce migrations.")
    return pins


def reviewed_flashes_application_blobs(expected, source):
    """Admit exact L/A, independently reviewed security controls C, then UI P."""
    advisory = FLASHES_ADVISORY_BASE
    controls = FLASHES_CONTROL_FILES
    require(expected == FLASHES_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == FLASHES_RELEASE_BASE_TREE
            and git("rev-parse", advisory + "^{tree}") == FLASHES_ADVISORY_TREE,
            "Flashes live or advisory baseline changed.")
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, advisory],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, advisory).splitlines())
            == set(FLASHES_ADVISORY_BLOBS),
            "Flashes advisory inventory changed.")
    verify_changed_modes(expected, advisory)
    for name, blob in FLASHES_ADVISORY_BLOBS.items():
        require(not git("ls-tree", expected, "--", name)
                and git("ls-tree", advisory, "--", name) == "100644 blob " + blob + "\t" + name,
                "Flashes advisory addition changed: " + name)
    trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(SHA.fullmatch(trusted) and trusted not in (expected, advisory, source),
            "Flashes requires independent merged controls.")
    verify_trusted_operator(source)
    # A same-named local tag must never impersonate the remote main branch.
    for ancestor, descendant in ((advisory, trusted), (trusted, "refs/remotes/origin/main")):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", advisory, trusted).splitlines()) == controls | set(FLASHES_SECURITY_BLOBS),
            "Flashes trusted controls contain unreviewed changes.")
    require(FLASHES_APPLICATION_BLOBS
            and set(git("diff", "--name-only", trusted, source).splitlines())
            == set(FLASHES_APPLICATION_BLOBS),
            "Flashes candidate differs from the complete reviewed application patch.")
    verify_changed_modes(advisory, trusted)
    verify_changed_modes(trusted, source)
    pins = {**FLASHES_ADVISORY_BLOBS, **FLASHES_SECURITY_BLOBS, **FLASHES_APPLICATION_BLOBS}
    for name, blob in FLASHES_SECURITY_BLOBS.items():
        require(git("ls-tree", trusted, "--", name) == "100644 blob " + blob + "\t" + name,
                "Flashes trusted security patch differs from reviewed source: " + name)
    for name, blob in pins.items():
        require(git("ls-tree", source, "--", name) == "100644 blob " + blob + "\t" + name,
                "Flashes output differs from its reviewed blob or mode: " + name)
    for name in sorted(controls):
        entry = git("ls-tree", trusted, "--", name)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(name), entry)
                and git("ls-tree", source, "--", name) == entry,
                "Flashes controls differ from their independent trusted entry.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    require(not migration_plan(pins), "Flashes release cannot introduce migrations.")
    return pins


def reviewed_integrated_experience_application_blobs(expected, source):
    """Bind exact M/S inputs and outputs to independent control C and promotion P."""
    snapshot = INTEGRATED_EXPERIENCE_APP_SNAPSHOT
    controls = INTEGRATED_EXPERIENCE_CONTROL_FILES
    application = INTEGRATED_EXPERIENCE_APPLICATION_BLOBS
    dependencies = INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS
    prerequisites = INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS
    require(controls == {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
            and set(dependencies) == {'mobile/package.json', 'mobile/package-lock.json',
                                      'runtime/vps/package.json'}
            and set(application) == set(INTEGRATED_EXPERIENCE_APPLICATION_INPUTS)
            == {'app/events/page.tsx',
             'app/global-error.tsx',
             'app/header-origin-menu.css',
             'app/hosts/[slug]/page.tsx',
             'app/mobile-app-frame.tsx',
             'app/mobile-navigation.tsx',
             'app/page.tsx',
             'app/pwa-registration.tsx',
             'app/room/[slug]/room-client.tsx',
             'app/sitemap.ts',
             'app/use-header-panel.ts',
             'docs/audits/pwa-resume-2026-10-23.md',
             'lib/mobile-viewport.ts',
             'lib/room-viewport.ts',
             'lib/website-event-listings.ts',
             'package.json',
             'styles/customer.css',
             'tests/e2e/discovery-pass-access.spec.ts',
             'tests/e2e/event-details.spec.ts',
             'tests/e2e/host-profile.spec.ts',
             'tests/e2e/menu-option-a.spec.ts',
             'tests/e2e/mobile-app-behavior.spec.ts',
             'tests/e2e/public-journey.spec.ts',
             'tests/e2e/published-catalogue.spec.ts',
             'tests/e2e/pwa-resume.spec.ts',
             'tests/e2e/website-event-unlisting.spec.ts',
             'tests/header-origin-menu.test.mjs',
             'tests/menu-option-a.test.mjs',
             'tests/mobile-ui.test.mjs',
             'tests/pwa-resume.test.mjs',
             'tests/website-event-listings.test.ts'}
            and set(prerequisites) == set(INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS)
            == {'package.json', 'package-lock.json'}
            and set(application) & set(prerequisites) == {'package.json'}
            and not (controls | set(dependencies)) & (set(application) | set(prerequisites)),
            "Integrated experience inventory or scope changed.")
    require(expected == INTEGRATED_EXPERIENCE_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == INTEGRATED_EXPERIENCE_RELEASE_BASE_TREE
            and git("rev-parse", snapshot + "^{tree}") == INTEGRATED_EXPERIENCE_APP_TREE,
            "Integrated experience live or snapshot tree changed.")
    for ancestor, descendant in ((expected, snapshot), (snapshot, source)):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, snapshot).splitlines()) == set(application) | set(prerequisites),
            "Integrated experience snapshot differs from its complete reviewed inventory.")
    verify_changed_modes(expected, snapshot)
    for name, blob in INTEGRATED_EXPERIENCE_APPLICATION_INPUTS.items():
        entry = git("ls-tree", expected, "--", name)
        require(entry == ("100644 blob " + blob + "\t" + name if blob is not None else ""),
                "Integrated experience application input differs from reviewed source: " + name)
    for name, blob in INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS.items():
        require(git("ls-tree", expected, "--", name) == "100644 blob " + blob + "\t" + name,
                "Integrated experience prerequisite input differs from reviewed source: " + name)
    # The lock is identical in C, S and P; only S/P add the reviewed test registrations.
    outputs = {**prerequisites, **application}
    for name, blob in outputs.items():
        require(git("ls-tree", snapshot, "--", name) == "100644 blob " + blob + "\t" + name,
                "Integrated experience snapshot output differs from reviewed source: " + name)
    trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(SHA.fullmatch(trusted) and trusted not in (expected, snapshot, source),
            "Integrated experience requires independent merged controls.")
    verify_trusted_operator(source)
    for ancestor, descendant in ((expected, trusted), (trusted, "refs/remotes/origin/main")):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, trusted).splitlines()) == controls | set(prerequisites),
            "Integrated experience trusted controls contain unreviewed changes.")
    require(set(git("diff", "--name-only", trusted, source).splitlines()) == set(application)
            and set(git("diff", "--name-only", snapshot, source).splitlines()) == controls,
            "Integrated experience candidate differs from the complete reviewed application patch.")
    verify_changed_modes(expected, trusted)
    verify_changed_modes(trusted, source)
    for name, blob in prerequisites.items():
        require(git("ls-tree", trusted, "--", name) == "100644 blob " + blob + "\t" + name,
                "Integrated experience trusted prerequisite differs from reviewed source: " + name)
    pins = dict(outputs)
    for name, blob in outputs.items():
        require(git("ls-tree", source, "--", name) == "100644 blob " + blob + "\t" + name,
                "Integrated experience output differs from its reviewed blob or mode: " + name)
    for name in sorted(controls):
        entry = git("ls-tree", trusted, "--", name)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(name), entry)
                and git("ls-tree", source, "--", name) == entry,
                "Integrated experience controls differ from their independent trusted entry.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    # The complete M/S/C/P diffs freeze every other path, including every workflow.
    for name, blob in dependencies.items():
        require(all(git("ls-tree", revision, "--", name) == "100644 blob " + blob + "\t" + name
                    for revision in (expected, snapshot, trusted, source)),
                "Integrated experience dependencies must remain unchanged: " + name)
    before = strict_json(git("show", expected + ":package.json"))
    control = strict_json(git("show", trusted + ":package.json"))
    after = strict_json(git("show", source + ":package.json"))
    require(before["dependencies"]["next"] == "16.3.8"
            and control["dependencies"]["next"] == "16.4.1",
            "Integrated experience requires exactly Next.js 16.3.8 to 16.4.1.")
    before["dependencies"]["next"] = "16.4.1"
    require(before == control, "Integrated experience prerequisite is not the exact Next.js security patch.")
    control["scripts"]["test:ui"] = control["scripts"]["test:ui"].replace(
        "tests/header-panel-focus.test.mjs", "tests/header-panel-focus.test.mjs tests/header-origin-menu.test.mjs"
    ) + " tests/pwa-resume.test.mjs"
    require(control == after, "Integrated experience package change is not the exact test registration patch.")
    require(not migration_plan(pins), "Integrated experience release cannot introduce migrations.")
    return pins


def reviewed_recovery_audit_application_blobs(expected, source):
    """Bind exact M/S inputs and outputs to independent control C and promotion P."""
    snapshot = RECOVERY_AUDIT_APP_SNAPSHOT
    controls = RECOVERY_AUDIT_CONTROL_FILES
    application = RECOVERY_AUDIT_APPLICATION_BLOBS
    dependencies = RECOVERY_AUDIT_DEPENDENCY_BLOBS
    require(controls == {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
            and set(dependencies) == {'package.json', 'package-lock.json', 'mobile/package.json',
                                      'mobile/package-lock.json', 'runtime/vps/package.json'}
            and set(application) == set(RECOVERY_AUDIT_APPLICATION_INPUTS)
            == {'app/my-nights/my-nights-client.tsx', 'tests/browser-audit-harness.test.mjs',
                'tests/e2e/discovery-pass-access.spec.ts', 'tests/e2e/flash-camera.spec.ts',
                'tests/my-nights-refresh.test.mjs'}
            and not (controls | set(dependencies)) & set(application),
            "Recovery/audit inventory or scope changed.")
    require(expected == RECOVERY_AUDIT_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == RECOVERY_AUDIT_RELEASE_BASE_TREE
            and git("rev-parse", snapshot + "^{tree}") == RECOVERY_AUDIT_APP_TREE,
            "Recovery/audit live or snapshot tree changed.")
    for ancestor, descendant in ((expected, snapshot), (snapshot, source)):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, snapshot).splitlines()) == set(application),
            "Recovery/audit snapshot differs from its complete reviewed inventory.")
    verify_changed_modes(expected, snapshot)
    for name, blob in RECOVERY_AUDIT_APPLICATION_INPUTS.items():
        entry = git("ls-tree", expected, "--", name)
        require(entry == ("100644 blob " + blob + "\t" + name if blob is not None else ""),
                "Recovery/audit application input differs from reviewed source: " + name)
    for name, blob in application.items():
        require(git("ls-tree", snapshot, "--", name) == "100644 blob " + blob + "\t" + name,
                "Recovery/audit snapshot output differs from reviewed source: " + name)
    trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(SHA.fullmatch(trusted) and trusted not in (expected, snapshot, source),
            "Recovery/audit requires independent merged controls.")
    verify_trusted_operator(source)
    for ancestor, descendant in ((expected, trusted), (trusted, "refs/remotes/origin/main")):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, trusted).splitlines()) == controls,
            "Recovery/audit trusted controls contain unreviewed changes.")
    require(set(git("diff", "--name-only", trusted, source).splitlines()) == set(application)
            and set(git("diff", "--name-only", snapshot, source).splitlines()) == controls,
            "Recovery/audit candidate differs from the complete reviewed application patch.")
    verify_changed_modes(expected, trusted)
    verify_changed_modes(trusted, source)
    pins = dict(application)
    for name, blob in application.items():
        require(git("ls-tree", source, "--", name) == "100644 blob " + blob + "\t" + name,
                "Recovery/audit output differs from its reviewed blob or mode: " + name)
    for name in sorted(controls):
        entry = git("ls-tree", trusted, "--", name)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(name), entry)
                and git("ls-tree", source, "--", name) == entry,
                "Recovery/audit controls differ from their independent trusted entry.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    # The complete M/S/C/P diffs freeze every other path, including every workflow.
    for name, blob in dependencies.items():
        require(all(git("ls-tree", revision, "--", name) == "100644 blob " + blob + "\t" + name
                    for revision in (expected, snapshot, trusted, source)),
                "Recovery/audit dependencies must remain unchanged: " + name)
    require(not migration_plan(pins), "Recovery/audit release cannot introduce migrations.")
    return pins


def reviewed_filters_room_application_blobs(expected, source):
    """Bind exact B/S inputs and outputs to independent control C and promotion P."""
    snapshot = FILTERS_ROOM_APP_SNAPSHOT
    controls = FILTERS_ROOM_CONTROL_FILES
    application = FILTERS_ROOM_APPLICATION_BLOBS
    dependencies = FILTERS_ROOM_DEPENDENCY_BLOBS
    require(controls == {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
            and set(dependencies) == {'package-lock.json', 'mobile/package-lock.json', 'mobile/package.json'}
            and len(application) == 19 and set(application) == set(FILTERS_ROOM_APPLICATION_INPUTS)
            and not (controls | set(dependencies)) & set(application)
            and 'package.json' in application
            and not any(name.startswith(('.github/', 'mobile/', 'runtime/', 'drizzle/'))
                        for name in application),
            "Filters/Room inventory or scope changed.")
    require(expected == FILTERS_ROOM_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == FILTERS_ROOM_RELEASE_BASE_TREE
            and git("rev-parse", snapshot + "^{tree}") == FILTERS_ROOM_APP_TREE,
            "Filters/Room live or snapshot tree changed.")
    for ancestor, descendant in ((expected, snapshot), (snapshot, source)):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, snapshot).splitlines()) == set(application),
            "Filters/Room snapshot differs from its complete reviewed inventory.")
    verify_changed_modes(expected, snapshot)
    for name, blob in FILTERS_ROOM_APPLICATION_INPUTS.items():
        entry = git("ls-tree", expected, "--", name)
        require(entry == ("100644 blob " + blob + "\t" + name if blob is not None else ""),
                "Filters/Room application input differs from reviewed source: " + name)
    for name, blob in application.items():
        require(git("ls-tree", snapshot, "--", name) == "100644 blob " + blob + "\t" + name,
                "Filters/Room snapshot output differs from reviewed source: " + name)
    trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(SHA.fullmatch(trusted) and trusted not in (expected, snapshot, source),
            "Filters/Room requires independent merged controls.")
    verify_trusted_operator(source)
    for ancestor, descendant in ((expected, trusted), (trusted, "refs/remotes/origin/main")):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, trusted).splitlines()) == controls,
            "Filters/Room trusted controls contain unreviewed changes.")
    require(set(git("diff", "--name-only", trusted, source).splitlines()) == set(application)
            and set(git("diff", "--name-only", snapshot, source).splitlines()) == controls,
            "Filters/Room candidate differs from the complete reviewed application patch.")
    verify_changed_modes(expected, trusted)
    verify_changed_modes(trusted, source)
    pins = dict(application)
    for name, blob in application.items():
        require(git("ls-tree", source, "--", name) == "100644 blob " + blob + "\t" + name,
                "Filters/Room output differs from its reviewed blob or mode: " + name)
    for name in sorted(controls):
        entry = git("ls-tree", trusted, "--", name)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(name), entry)
                and git("ls-tree", source, "--", name) == entry,
                "Filters/Room controls differ from their independent trusted entry.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    # The complete B/S/C/P diffs freeze every other path, including every workflow.
    for name, blob in dependencies.items():
        require(all(git("ls-tree", revision, "--", name) == "100644 blob " + blob + "\t" + name
                    for revision in (expected, snapshot, trusted, source)),
                "Filters/Room dependencies must remain unchanged: " + name)
    before = strict_json(git("show", expected + ":package.json"))
    after = strict_json(git("show", source + ":package.json"))
    for name, append in FILTERS_ROOM_TEST_SCRIPT_APPENDS.items():
        require(isinstance(append, str) and append.startswith(' tests/')
                and name.startswith('test:') and isinstance(before.get('scripts', {}).get(name), str),
                "Filters/Room test registration schema changed.")
        before['scripts'][name] += append
    require(before == after, "Filters/Room package change is not the exact test registration append.")
    require(not migration_plan(pins), "Filters/Room release cannot introduce migrations.")
    return pins


def reviewed_navigation_application_blobs(expected, source):
    """Bind B/S to the exact complete patch, with separately merged controls C."""
    snapshot = NAVIGATION_APP_SNAPSHOT
    controls = NAVIGATION_CONTROL_FILES
    application = NAVIGATION_APPLICATION_BLOBS
    prerequisites = NAVIGATION_PREREQUISITE_BLOBS
    require(controls == {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'}
            and set(prerequisites) == set(NAVIGATION_PREREQUISITE_INPUTS)
            == {'package.json', 'package-lock.json'}
            and not controls & (set(application) | set(prerequisites))
            and set(application) & set(prerequisites) == {'package.json'},
            "Navigation prerequisite inventory or scope changed.")
    require(expected == NAVIGATION_RELEASE_BASELINE
            and git("rev-parse", expected + "^{tree}") == NAVIGATION_RELEASE_BASE_TREE
            and git("rev-parse", snapshot + "^{tree}") == NAVIGATION_APP_TREE,
            "Navigation live or snapshot tree changed.")
    # P retains S in its graph; a release checkout never depends on a side ref.
    for ancestor, descendant in ((expected, snapshot), (snapshot, source)):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(application and set(application) == set(NAVIGATION_APPLICATION_INPUTS)
            and set(git("diff", "--name-only", expected, snapshot).splitlines())
            == set(application) | set(prerequisites),
            "Navigation snapshot differs from its complete reviewed inventory.")
    verify_changed_modes(expected, snapshot)
    for name, blob in NAVIGATION_APPLICATION_INPUTS.items():
        entry = git("ls-tree", expected, "--", name)
        require(entry == ("100644 blob " + blob + "\t" + name if blob is not None else ""),
                "Navigation application input differs from reviewed source: " + name)
    for name, blob in NAVIGATION_PREREQUISITE_INPUTS.items():
        require(git("ls-tree", expected, "--", name) == "100644 blob " + blob + "\t" + name,
                "Navigation prerequisite input differs from reviewed source: " + name)
    # The application package has the same patch plus the exact test appends.
    # The lock is shared byte-for-byte by C, S and P.
    outputs = {**prerequisites, **application}
    for name, blob in outputs.items():
        require(git("ls-tree", snapshot, "--", name) == "100644 blob " + blob + "\t" + name,
                "Navigation snapshot output differs from reviewed source: " + name)
    trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
    require(SHA.fullmatch(trusted) and trusted not in (expected, snapshot, source),
            "Navigation requires independent merged controls.")
    verify_trusted_operator(source)
    for ancestor, descendant in ((expected, trusted), (trusted, "refs/remotes/origin/main")):
        subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", ancestor, descendant],
                       check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, trusted).splitlines()) == controls | set(prerequisites),
            "Navigation trusted controls contain unreviewed changes.")
    require(set(git("diff", "--name-only", trusted, source).splitlines()) == set(application)
            and set(git("diff", "--name-only", snapshot, source).splitlines()) == controls,
            "Navigation candidate differs from the complete reviewed application patch.")
    verify_changed_modes(expected, trusted)
    verify_changed_modes(trusted, source)
    for name, blob in prerequisites.items():
        require(git("ls-tree", trusted, "--", name) == "100644 blob " + blob + "\t" + name,
                "Navigation trusted prerequisite differs from reviewed source: " + name)
    pins = dict(outputs)
    for name, blob in outputs.items():
        require(git("ls-tree", source, "--", name) == "100644 blob " + blob + "\t" + name,
                "Navigation output differs from its reviewed blob or mode: " + name)
    for name in sorted(controls):
        entry = git("ls-tree", trusted, "--", name)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(name), entry)
                and git("ls-tree", source, "--", name) == entry,
                "Navigation controls differ from their independent trusted entry.")
        pins[name] = git("rev-parse", trusted + ":" + name)
    require(not migration_plan(pins), "Navigation release cannot introduce migrations.")
    return pins


def reviewed_application_blobs(expected, source):
    """Select each exact application tree only from its approved live baseline."""
    if expected == INTEGRATED_EXPERIENCE_RELEASE_BASELINE:
        return reviewed_integrated_experience_application_blobs(expected, source)
    if expected == RECOVERY_AUDIT_RELEASE_BASELINE:
        return reviewed_recovery_audit_application_blobs(expected, source)
    if expected == FILTERS_ROOM_RELEASE_BASELINE:
        return reviewed_filters_room_application_blobs(expected, source)
    if expected == NAVIGATION_RELEASE_BASELINE:
        return reviewed_navigation_application_blobs(expected, source)
    if expected == FLASHES_RELEASE_BASELINE:
        return reviewed_flashes_application_blobs(expected, source)
    if expected == CINCO_RECOVERY_RELEASE_BASELINE:
        return reviewed_cinco_recovery_application_blobs(expected, source)
    if expected == CINCO_RELEASE_BASELINE and git("rev-parse", source + ":lib/registrations.ts") == CINCO_APPLICATION_BLOBS["lib/registrations.ts"]:
        return reviewed_cinco_application_blobs(expected, source)
    if expected == PARALLEL_RELEASE_BASELINE:
        return reviewed_parallel_application_blobs(expected, source)
    if expected == RSVP_READINESS_LIVE_BASELINE:
        return reviewed_readiness_application_blobs(expected, source)
    if expected == YORKE_RELEASE_BASELINE:
        return reviewed_yorke_application_blobs(expected, source)
    if expected != WORKSPACE_RELEASE_BASELINE:
        return REVIEWED_APPLICATION_BLOBS
    require(git("rev-parse", expected + "^{tree}") == WORKSPACE_BASE_TREE
            and git("rev-parse", WORKSPACE_APP_SNAPSHOT + "^{tree}") == WORKSPACE_APP_TREE
            and git("rev-list", "--parents", "-n", "1", WORKSPACE_APP_SNAPSHOT)
            == WORKSPACE_APP_SNAPSHOT + " " + expected,
            "Workspace snapshot or its exact baseline changed.")
    require(set(git("diff", "--name-only", expected, WORKSPACE_APP_SNAPSHOT).splitlines())
            == set(WORKSPACE_APPLICATION_BLOBS) | WORKSPACE_MIGRATION_FILES,
            "Workspace snapshot differs from its complete reviewed inventory.")
    # C must be independently selected and already merged, with no application
    # changes. P copies S application bytes onto C; S need not be a P ancestor.
    verify_trusted_operator(source)
    trusted = os.environ["BECORE_TRUSTED_BASE"]
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, trusted],
                   check=True, env=git_environment(), timeout=60)
    require(set(git("diff", "--name-only", expected, trusted).splitlines()) <= WORKSPACE_CONTROL_FILES,
            "Workspace trusted controls contain application changes.")
    require(set(git("diff", "--name-only", WORKSPACE_APP_SNAPSHOT, source).splitlines())
            <= WORKSPACE_CONTROL_FILES,
            "Workspace candidate differs from the exact application snapshot.")
    pins = {**REVIEWED_APPLICATION_BLOBS, **WORKSPACE_APPLICATION_BLOBS}
    for name in sorted(WORKSPACE_CONTROL_FILES):
        blob = git("rev-parse", trusted + ":" + name)
        require(git("rev-parse", source + ":" + name) == blob,
                "Workspace candidate controls differ from the trusted baseline.")
        pins[name] = blob
    # SQL still requires its independent reviewed-migration entry and validator.
    return pins


def vetted_changes(expected, source):
    subprocess.run(["git", "--no-replace-objects", "merge-base", "--is-ancestor", expected, source], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=git_environment(), timeout=60)
    verify_changed_modes(expected, source)
    changed = git("diff", "--name-only", expected, source).splitlines()
    application_pins = reviewed_application_blobs(expected, source)
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
        if name in application_pins or name in REVIEWED_MIGRATIONS:
            reviewed = application_pins.get(name) or REVIEWED_MIGRATIONS[name]["blob"]
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
    if expected == INTEGRATED_EXPERIENCE_RELEASE_BASELINE:
        require(not migration_plan(changed), "Integrated experience release cannot introduce migrations.")
        return changed
    if expected == RECOVERY_AUDIT_RELEASE_BASELINE:
        require(not migration_plan(changed), "Recovery/audit release cannot introduce migrations.")
        return changed
    if expected == FILTERS_ROOM_RELEASE_BASELINE:
        require(not migration_plan(changed), "Filters/Room release cannot introduce migrations.")
        return changed
    if expected == NAVIGATION_RELEASE_BASELINE:
        require((set(NAVIGATION_PREREQUISITE_BLOBS) | set(NAVIGATION_DEPENDENCY_BLOBS))
                & set(changed) == {'package.json', 'package-lock.json'},
                "Navigation permits only the exact root security pair and test registrations.")
        for name, blob in NAVIGATION_DEPENDENCY_BLOBS.items():
            require(git("rev-parse", expected + ":" + name) == blob
                    and git("rev-parse", source + ":" + name) == blob,
                    "Navigation dependencies must remain unchanged: " + name)
        before = strict_json(git("show", expected + ":package.json"))
        control = strict_json(git("show", os.environ["BECORE_TRUSTED_BASE"] + ":package.json"))
        after = strict_json(git("show", source + ":package.json"))
        require(before["devDependencies"]["vitest"] == "4.1.11"
                and control["devDependencies"]["vitest"] == "4.1.12",
                "Navigation requires exactly Vitest 4.1.11 to 4.1.12.")
        before["devDependencies"]["vitest"] = "4.1.12"
        require(before == control, "Navigation prerequisite is not the exact Vitest security patch.")
        for name, append in NAVIGATION_TEST_SCRIPT_APPENDS.items():
            control["scripts"][name] += append
        require(control == after, "Navigation package change is not the exact test registration append.")
        require(not migration_plan(changed), "Navigation release cannot introduce migrations.")
        return changed
    if expected == FLASHES_RELEASE_BASELINE:
        require(set(FLASHES_SECURITY_BLOBS) <= set(changed),
                "Flashes requires the complete reviewed root/mobile Vite security patches.")
        for name, blob in FLASHES_PACKAGE_BASE_BLOBS.items():
            require(git("rev-parse", expected + ":" + name) == blob
                    and git("rev-parse", FLASHES_ADVISORY_BASE + ":" + name) == blob
                    and git("rev-parse", source + ":" + name) == FLASHES_SECURITY_BLOBS[name],
                    "Flashes package or dependency lock differs from reviewed source: " + name)
        for name in ("package.json", "mobile/package.json"):
            before = strict_json(git("show", expected + ":" + name))
            after = strict_json(git("show", source + ":" + name))
            require(before["devDependencies"]["vite"] == "8.2.1"
                    and after["devDependencies"]["vite"] == "8.2.4",
                    "Flashes requires exactly Vite 8.2.1 to 8.2.4: " + name)
            before["devDependencies"]["vite"] = "8.2.4"
            require(before == after, "Flashes package change is not the exact Vite security patch: " + name)
        require(not migration_plan(changed), "Flashes release cannot introduce migrations.")
        return changed
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
    if expected == CINCO_RECOVERY_RELEASE_BASELINE:
        require({"package.json", "package-lock.json"} & set(changed) == {"package.json"},
                "CINCO recovery permits only the reviewed package test:ui append.")
        for revision, package in ((expected, CINCO_RECOVERY_PACKAGE_BASE_BLOB),
                                  (source, CINCO_RECOVERY_APPLICATION_BLOBS["package.json"])):
            require(git("rev-parse", revision + ":package.json") == package
                    and git("rev-parse", revision + ":package-lock.json") == CINCO_RECOVERY_LOCK_BLOB,
                    "CINCO recovery package or unchanged dependency lock differs from reviewed source.")
        before = strict_json(git("show", expected + ":package.json"))
        after = strict_json(git("show", source + ":package.json"))
        before["scripts"]["test:ui"] += " tests/my-nights-refresh.test.mjs"
        require(before == after, "CINCO recovery package change is not the exact test:ui append.")
        require(not migration_plan(changed), "CINCO recovery release cannot introduce migrations.")
        return changed
    if expected == WORKSPACE_RELEASE_BASELINE:
        # Only the exact test:ui script registration changes. A dependency or lock
        # edit cannot inherit this scripts-only approval or an old audit exception.
        require({"package.json", "package-lock.json"} & set(changed) == {"package.json"},
                "Workspace release permits only the reviewed package scripts change.")
        for revision, package in zip((expected, source), WORKSPACE_PACKAGE_BLOBS):
            require(git("rev-parse", revision + ":package.json") == package
                    and git("rev-parse", revision + ":package-lock.json")
                    == WORKSPACE_LOCK_BLOB,
                    "Workspace package scripts or unchanged dependency lock differ from reviewed source.")
        before = strict_json(git("show", expected + ":package.json"))
        after = strict_json(git("show", source + ":package.json"))
        before["scripts"] = after["scripts"]
        require(before == after, "Workspace package change is not scripts-only.")
        return changed
    if expected == YORKE_RELEASE_BASELINE:
        # Exact test:repo/test:ui registrations only, with the same dependency
        # lock. No dependency or historical audit-window exception is expanded.
        require({"package.json", "package-lock.json"} & set(changed) == {"package.json"},
                "Yorke release permits only the reviewed package scripts change.")
        for revision, package in zip((expected, source), YORKE_PACKAGE_BLOBS):
            require(git("rev-parse", revision + ":package.json") == package
                    and git("rev-parse", revision + ":package-lock.json") == YORKE_LOCK_BLOB,
                    "Yorke package scripts or unchanged dependency lock differ from reviewed source.")
        before = strict_json(git("show", expected + ":package.json"))
        after = strict_json(git("show", source + ":package.json"))
        before["scripts"] = after["scripts"]
        require(before == after, "Yorke package change is not scripts-only.")
        return changed
    if expected == RSVP_READINESS_LIVE_BASELINE:
        require({"package.json", "package-lock.json"} & set(changed) == {"package.json"},
                "Readiness release permits only the reviewed package test:ui change.")
        for revision, package in zip((expected, source), RSVP_READINESS_PACKAGE_BLOBS):
            require(git("rev-parse", revision + ":package.json") == package
                    and git("rev-parse", revision + ":package-lock.json") == RSVP_READINESS_LOCK_BLOB,
                    "Readiness package script or unchanged dependency lock differs from reviewed source.")
        before = strict_json(git("show", expected + ":package.json"))
        after = strict_json(git("show", source + ":package.json"))
        before["scripts"]["test:ui"] = after["scripts"]["test:ui"]
        require(before == after, "Readiness package change is not test:ui-only.")
        require(not migration_plan(changed), "Readiness release cannot introduce migrations.")
        return changed
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


def verify_runtime_jobs(runtime_jobs):
    require(len(runtime_jobs) == 2
            and all(job.get("conclusion") == "success" for job in runtime_jobs),
            "Runtime contains a failed, skipped or unexpected job.")
    require({job.get("name") for job in runtime_jobs} == {"verify", "handoff"},
            "Runtime verification jobs missing.")
    require_steps(next(job for job in runtime_jobs if job["name"] == "verify"), RUNTIME_VERIFY_STEPS)
    require_steps(next(job for job in runtime_jobs if job["name"] == "handoff"), RUNTIME_HANDOFF_STEPS)
def verify_jobs(runtime_jobs, candidate_jobs):
    verify_runtime_jobs(runtime_jobs)
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


def verify_parallel_run(run, jobs, *, repository):
    require(type(run) is dict and run.get("status") == "completed" and run.get("conclusion") == "success"
            and run.get("path") == ".github/workflows/candidate-parallel-checks.yml"
            and run.get("head_branch") == "improve/release-evidence-parallel-20261013"
            and run.get("event") in ("push", "workflow_dispatch")
            and type(run.get("id")) is int and run["id"] > 0
            and type(run.get("run_attempt")) is int and run["run_attempt"] > 0
            and isinstance(run.get("head_sha"), str) and SHA.fullmatch(run["head_sha"])
            and run.get("repository", {}).get("full_name") == repository
            and run.get("head_repository", {}).get("full_name") == repository,
            "Parallel candidate run identity differs from the exact branch workflow.")
    names = {"build", "desktop-chromium", "mobile-chromium", "mobile-webkit", "verify"}
    require(type(jobs) is list and len(jobs) == 5 and all(type(job) is dict for job in jobs),
            "Parallel candidate requires exactly five jobs.")
    identifiers = set()
    observed = set()
    for job in jobs:
        require(type(job.get("id")) is int and job["id"] > 0 and job["id"] not in identifiers
                and type(job.get("run_id")) is int and job["run_id"] == run["id"]
                and ("run_attempt" not in job or type(job["run_attempt"]) is int
                     and job["run_attempt"] == run["run_attempt"])
                and job.get("head_sha") == run["head_sha"] and job.get("status") == "completed"
                and job.get("conclusion") == "success" and job.get("name") in names
                and job["name"] not in observed,
                "Parallel job does not belong to the exact successful workflow attempt.")
        identifiers.add(job["id"])
        observed.add(job["name"])


def authenticated_parallel_modules(source):
    """Compile only independently authenticated source, ignoring imports/pycache.

    Read/authenticate every module before executing any of them. The private
    import hook resolves their dependencies exclusively to fresh modules; even a
    same-path forged sys.modules entry or valid timestamp .pyc is irrelevant.
    """
    verify_trusted_operator(source)
    baseline = os.environ["BECORE_TRUSTED_BASE"]
    directory = Path(__file__).absolute().parent
    sources = {}
    for name in PARALLEL_MODULES:
        path = directory / (name + ".py")
        relative = "ops/vps/" + path.name
        info = path.lstat()
        require(not any(parent.is_symlink() for parent in (path, *path.parents))
                and stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o644,
                "Parallel verifier must be a regular trusted module: " + relative)
        entry = git("ls-tree", baseline, "--", relative)
        require(re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(relative), entry),
                "Parallel verifier trusted mode is invalid: " + relative)
        raw = path.read_bytes()
        expected = subprocess.check_output(["git", "--no-replace-objects", "show", baseline + ":" + relative],
                                           stderr=subprocess.DEVNULL, env=git_environment(), timeout=60)
        require(raw == expected, "Parallel verifier bytes differ from trusted baseline: " + relative)
        sources[name] = (path, raw)
    modules = {}
    ordinary_import = builtins.__import__

    def trusted_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name in PARALLEL_MODULES:
            require(level == 0 and name in modules, "Parallel module dependency order is invalid.")
            return modules[name]
        require(level == 0, "Relative parallel module imports are forbidden.")
        return ordinary_import(name, globals, locals, fromlist, level)

    for name, (path, raw) in sources.items():
        module = types.ModuleType(name)
        module.__file__ = str(path)
        module.__builtins__ = dict(vars(builtins), __import__=trusted_import)
        exec(compile(raw, str(path), "exec", dont_inherit=True), module.__dict__)
        modules[name] = module
    # Publish only after the entire authenticated dependency graph compiles.
    # The shared runtime transport guard then imports this fresh verified module,
    # never a preexisting sys.modules forgery or timestamp-valid bytecode cache.
    sys.modules.update(modules)
    return modules


def validate_parallel_proof(proof, *, repository, candidate, tree, run_id, attempt, baseline=None):
    """Standalone host shape/binding gate, never a replacement for collection."""
    keys = {"schema", "repository", "source_sha", "source_tree", "workflow", "workflow_sha",
            "workflow_blob", "audit_trusted_base", "run_id", "run_attempt", "event", "head_branch",
            "artifact", "jobs", "receipts", "metadata_sha256"}
    require(type(proof) is dict and set(proof) == keys
            and proof["schema"] == "tickets-parallel-candidate/v2", "Version 2 parallel proof required.")

    def sha(value):
        return isinstance(value, str) and SHA.fullmatch(value)

    def digest(value):
        return isinstance(value, str) and DIGEST.fullmatch(value)

    def number(value):
        return type(value) is int and 1 <= value < 10 ** 20

    require(repository == "bechirobob/tickets" and sha(candidate) and sha(tree)
            and isinstance(run_id, str) and re.fullmatch(r"[1-9][0-9]{0,19}", run_id)
            and number(attempt) and sha(proof["audit_trusted_base"])
            and proof["audit_trusted_base"] != candidate
            and (baseline is None or proof["audit_trusted_base"] == baseline),
            "Parallel proof independent identity is invalid.")
    expected = {"repository": repository, "source_sha": candidate, "source_tree": tree,
                "workflow": ".github/workflows/candidate-parallel-checks.yml", "workflow_sha": candidate,
                "run_id": int(run_id), "run_attempt": attempt}
    require(all(proof[key] == value for key, value in expected.items())
            and number(proof["run_id"]) and number(proof["run_attempt"]) and sha(proof["workflow_blob"])
            and proof["event"] in ("push", "workflow_dispatch")
            and proof["head_branch"] == "improve/release-evidence-parallel-20261013",
            "Parallel proof does not bind the exact candidate workflow.")
    artifact = proof["artifact"]
    require(type(artifact) is dict and set(artifact) == {"id", "name", "size_in_bytes", "digest",
            "archive_sha256", "manifest_sha256", "created_at", "expires_at"}
            and number(artifact["id"]) and type(artifact["size_in_bytes"]) is int
            and 1 <= artifact["size_in_bytes"] <= 272 * 1024 ** 2
            and artifact["name"] == "browser-build-" + run_id + "-" + str(attempt)
            and all(digest(artifact[key]) for key in ("digest", "archive_sha256", "manifest_sha256")),
            "Parallel proof artifact identity is invalid.")

    def timestamp(value):
        require(isinstance(value, str), "Parallel artifact timestamp is invalid.")
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z", value)
        require(match is not None, "Parallel artifact timestamp is invalid.")
        try:
            date = datetime.strptime(match[1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            return (date, int((match[2] or "").ljust(9, "0")))
        except ValueError as exc:
            raise ReleaseError("Parallel artifact timestamp is invalid.") from exc

    require(timestamp(artifact["created_at"]) < timestamp(artifact["expires_at"]),
            "Parallel proof artifact lifetime is invalid.")
    jobs = proof["jobs"]
    require(type(jobs) is list and len(jobs) == 5, "Parallel proof requires five jobs.")
    identifiers = set()
    browsers = ("desktop-chromium", "mobile-chromium", "mobile-webkit")
    for job, name in zip(jobs, ("build", *browsers, "verify")):
        require(type(job) is dict and set(job) == {"id", "name", "log_sha256", "steps_sha256"}
                and number(job["id"]) and job["id"] not in identifiers and job["name"] == name
                and digest(job["log_sha256"]) and digest(job["steps_sha256"]),
                "Parallel proof job identity or evidence digest is invalid.")
        identifiers.add(job["id"])
    receipts = proof["receipts"]
    require(type(receipts) is list and len(receipts) == 4, "Parallel proof requires four receipts.")
    for receipt, browser in zip(receipts, (None, *browsers)):
        expected_receipt = {
            "schema": "tickets-browser-build/v2", "kind": "producer" if browser is None else "consumer",
            "browser": browser, "repository": repository, "source_sha": candidate, "source_tree": tree,
            "workflow_sha": candidate, "audit_trusted_base": proof["audit_trusted_base"],
            "run_id": run_id, "run_attempt": str(attempt), "artifact_id": str(artifact["id"]),
            "artifact_digest": artifact["digest"], "archive_sha256": artifact["archive_sha256"],
            "manifest_sha256": artifact["manifest_sha256"],
        }
        require(type(receipt) is dict and receipt == expected_receipt,
                "Parallel proof receipt differs from its exact shared artifact.")
    hashes = proof["metadata_sha256"]
    require(type(hashes) is dict and set(hashes) == {"run", "jobs", "artifact"}
            and all(digest(value) for value in hashes.values()), "Parallel proof metadata digests are invalid.")
    return proof


def verify_parallel_candidate(args, candidate, jobs, source_tree):
    """Authenticated online evidence is required; local receipts are not trust."""
    try:
        modules = authenticated_parallel_modules(args.source)
        previous = None
        output = Path(args.output)
        if os.path.lexists(output):
            require(output.is_file() and not output.is_symlink(), "Previous parallel proof must be regular.")
            prior = strict_json(output.read_bytes())
            require(type(prior) is dict and "candidateVerification" in prior,
                    "Previous provenance has no selected parallel proof.")
            previous = validate_parallel_proof(prior["candidateVerification"], repository=args.repository,
                candidate=candidate["head_sha"], tree=source_tree, run_id=args.candidate_run,
                attempt=candidate["run_attempt"], baseline=os.environ["BECORE_TRUSTED_BASE"])
        proof = modules["parallel_candidate_control"].collect_or_verify(
            modules["runtime_release"].GitHub(), Path(args.metadata) / "parallel-evidence",
            root=Path.cwd(), source=args.source, candidate=candidate["head_sha"],
            trusted_baseline=os.environ["BECORE_TRUSTED_BASE"], run_id=args.candidate_run,
            attempt=str(candidate["run_attempt"]), verifier=modules["parallel_candidate"], expected_proof=previous)
        validate_parallel_proof(proof, repository=args.repository, candidate=candidate["head_sha"],
                                tree=source_tree, run_id=args.candidate_run,
                                attempt=candidate["run_attempt"], baseline=os.environ["BECORE_TRUSTED_BASE"])
        require({job["name"]: job["id"] for job in jobs}
                == {job["name"]: job["id"] for job in proof["jobs"]},
                "Parallel collector job IDs differ from selected exact-attempt metadata.")
        return proof
    except ReleaseError:
        raise
    except Exception as exc:
        raise ReleaseError("Authenticated parallel candidate verification failed.") from exc


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
    candidate_mode = getattr(args, "candidate_mode", "legacy")
    require(candidate_mode in ("legacy", "parallel-v1"), "Unknown candidate verification mode.")
    workflow = "candidate-checks.yml" if candidate_mode == "legacy" else "candidate-parallel-checks.yml"
    if candidate_mode == "legacy":
        verify_run(candidate, workflow=workflow, repository=args.repository)
    require(str(runtime.get("id")) == args.runtime_run and str(candidate.get("id")) == args.candidate_run,
            "Workflow run IDs do not match inputs.")
    runtime_jobs = strict_json((metadata / "runtime-jobs.json").read_bytes())
    candidate_jobs = strict_json((metadata / "candidate-jobs.json").read_bytes())
    verify_job_identity(runtime_jobs, runtime)
    if candidate_mode == "legacy":
        verify_job_identity(candidate_jobs, candidate)
        verify_jobs(runtime_jobs, candidate_jobs)
    else:
        verify_runtime_jobs(runtime_jobs)
        verify_parallel_run(candidate, candidate_jobs, repository=args.repository)
    source_tree = git("rev-parse", args.source + "^{tree}")
    require(source_tree == git("rev-parse", candidate["head_sha"] + "^{tree}"),
            "Candidate browser source tree differs from runtime source tree.")
    changes = vetted_changes(args.expected, args.source)
    candidate_verification = (verify_parallel_candidate(args, candidate, candidate_jobs, source_tree)
                              if candidate_mode == "parallel-v1" else None)
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
    if candidate_verification is not None:
        provenance["candidateVerification"] = candidate_verification
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
    if specification.get("path") == HOST_BRAND_IDENTITY_PATH:
        # A single byte-pinned ALTER/UPDATE exception, not a new SQL grammar.
        expected = dict(path=HOST_BRAND_IDENTITY_PATH, **REVIEWED_MIGRATIONS[HOST_BRAND_IDENTITY_PATH])
        require(specification == expected and hashlib.sha256(raw).hexdigest() == expected["sha256"]
                and hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == expected["blob"],
                "Host brand migration differs from the exact reviewed source.")
        statements, pending = [], ""
        for character in raw.decode("utf-8"):
            pending += character
            if character == ";" and sqlite3.complete_statement(pending):
                statements.append(pending)
                pending = ""
        require(not pending.strip() and len(statements) == 3,
                "Host brand migration has an unexpected statement inventory.")
        return statements, []
    if specification.get("path") in WORKSPACE_SCHEMA_PATHS:
        # Only these immutable statements may alter an existing table or replace
        # triggers. This is not an extension of the additive SQL grammar.
        path = specification["path"]
        expected = dict(path=path, **REVIEWED_MIGRATIONS[path])
        require(specification == expected and hashlib.sha256(raw).hexdigest() == expected["sha256"]
                and hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == expected["blob"],
                "Workspace schema migration differs from the exact reviewed source.")
        statements, pending = [], ""
        for character in raw.decode("utf-8"):
            pending += character
            if character == ";" and sqlite3.complete_statement(pending):
                statements.append(pending)
                pending = ""
        require(not pending.strip() and len(statements) == (2 if path == RECOVERABLE_ARCHIVE_PATH else 4),
                "Workspace schema migration has an unexpected statement inventory.")
        return statements, []
    if specification.get("path") == HOST_RSVP_PUSH_PATH:
        # One byte-pinned additive migration only. Never broaden the generic
        # grammar to accept arbitrary triggers on existing registration tables.
        expected = dict(path=HOST_RSVP_PUSH_PATH, **REVIEWED_MIGRATIONS[HOST_RSVP_PUSH_PATH])
        require(specification == expected and hashlib.sha256(raw).hexdigest() == expected["sha256"]
                and hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == expected["blob"],
                "Host RSVP push migration differs from the exact reviewed source.")
        statements, pending = [], ""
        for character in raw.decode("utf-8"):
            pending += character
            if character == ";" and sqlite3.complete_statement(pending):
                statements.append(pending)
                pending = ""
        require(not pending.strip() and len(statements) == 7,
                "Host RSVP push migration has an unexpected statement inventory.")
        with closing(sqlite3.connect(":memory:")) as temporary:
            # Schema-only stand-in; never created/changed in the live database.
            temporary.execute("CREATE TABLE event_registrations(id TEXT, event_slug TEXT, kind TEXT, status TEXT)")
            before = schema_rows(temporary)
            for statement in statements:
                temporary.execute(statement)
            rows = [row for row in schema_rows(temporary) if row not in before]
        require(len(rows) == 7 and schema_digest(rows) == expected["schemaSha256"]
                and {row[1] for row in rows if row[0] == "table"} == set(expected["tables"])
                and {row[1]: row[2] for row in rows if row[0] == "trigger"} == expected["triggers"],
                "Host RSVP push schema differs from the exact reviewed source.")
        return statements, rows
    if specification.get("kind") == "pink-edition-confirmed":
        expected = dict(path=PINK_EDITION_PATH, **REVIEWED_MIGRATIONS[PINK_EDITION_PATH])
        require(specification == expected and hashlib.sha256(raw).hexdigest() == expected["sha256"]
                and hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == expected["blob"],
                "Pink Edition migration differs from the exact reviewed source.")
        return [], []
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


PINK_EDITION_BUSINESS_TRIGGERS = {
    "curated_event_records": {
        "apple_wallet_event_refresh": "54e57e889240610c7e7bd466235cb92581a5c6551dc2f0b0b6dd709a16cd550f",
        "curated_events_verify_insert": "54aa368c97db09e17c5480c477cf23ef903e0dcf6bcc34bad5f0ba582d8892ad",
        "curated_events_verify_update": "211f00db14c4bb69da57d79a699cfca64e07b30adc8eb2e4e70ddfb6b4555eec",
        "operations_cancelled_event_guard": "af63b8b295ebc210a1355ca97cec102ecb40a38a311b34df74ce8f42d36346a9",
        "removed_event_stays_removed": "1ac7d479203de4aad271d6660201d30c9a37c8dfd08acb78dd47f1995d12b015",
    },
    "party_submissions": {
        "owner_event_draft_submitted": "4e39fb52c9075f383c44c056de69d50f28cd6a117109ff902607a48d66dfb31f",
        "owner_event_review_created": "e913c5bb74a74040995b7291c6c7960da3965e0b9083d3a693426efaaefddc1b",
    },
}


def confirm_pink_edition(connection, raw):
    """Apply only the owner's exact event update, preserving other rows and fields."""
    require(connection.in_transaction, "Event correction requires the migration transaction.")
    slug = "sun-chasers-labadi"
    allowed = {
        "curated_event_records": {"starts_at", "ends_at", "schedule_status", "schedule_label", "sales_open_at", "sales_close_at", "image_url", "venue", "area", "lineup", "curation_note", "updated_at"},
        "event_registration_settings": {"accepting", "allow_undated_rsvp", "updated_at"},
        "party_submissions": {"starts_at", "ends_at", "venue_name", "area", "lineup", "updated_at"},
        "event_updates": {"title", "body", "published_by"},
    }
    control = connection.execute("SELECT id,frozen,transfer_id FROM _bct_handover_state ORDER BY id").fetchall()
    require(len(control) == 1 and control[0][0:2] == (1, 0), "Event correction requires the active VPS writer.")
    control_schema = connection.execute("SELECT sql FROM sqlite_schema WHERE type='table' AND name='_bct_handover_state'").fetchone()
    require(control_schema and hashlib.sha256(control_schema[0].encode()).hexdigest() == HOST_WRITER_CONTROL_SCHEMA,
            "Event correction requires the exact handover control schema.")
    before_schema = schema_rows(connection)
    snapshots = {}
    # Preserve the exact existing wallet refresh, including its writer guards.
    # Only target passes may receive a new tag/timestamp; other wallet data is
    # checked byte-for-value below. The clock advances once only when needed.
    wallet = {"apple_wallet_passes": "id", "apple_wallet_update_clock": "id"}
    for table in (*allowed, *wallet):
        columns = connection.execute('PRAGMA table_xinfo("' + table + '")').fetchall()
        require(columns and all(column[6] == 0 for column in columns), "Event correction requires ordinary existing tables.")
        columns = [column[1] for column in columns]
        key = "event_slug" if table == "event_registration_settings" else "id"
        rows = connection.execute('SELECT * FROM "' + table + '" ORDER BY "' + key + '"').fetchall()
        snapshots[table] = (columns, key, rows)
        guards = connection.execute("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?", (table,)).fetchall()
        expected = dict(PINK_EDITION_BUSINESS_TRIGGERS.get(table, {}))
        for operation in ("insert", "update", "delete"):
            name = "_bct_guard_" + table + "_" + operation
            sql = ('CREATE TRIGGER "' + name + '" BEFORE ' + operation.upper() + ' ON "' + table
                   + '" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,\'Source writer is paused for verified handover\'); END')
            expected[name] = hashlib.sha256(sql.encode()).hexdigest()
        observed = {name: hashlib.sha256(sql.encode()).hexdigest() for name, sql in guards}
        require(observed == expected, "Event correction refuses missing or unknown writer guards or business triggers.")
    wallet_columns, _, wallet_rows = snapshots["apple_wallet_passes"]
    target_passes = sum(row[wallet_columns.index("event_slug")] == slug for row in wallet_rows)
    clock_columns, _, clock_rows = snapshots["apple_wallet_update_clock"]
    require(len(clock_rows) == 1 and clock_rows[0][clock_columns.index("id")] == 1,
            "Event correction requires the single wallet update clock.")
    clock = clock_rows[0][clock_columns.index("value")]
    require(type(clock) is int and 1 <= clock < 9223372036854775807,
            "Event correction requires a valid wallet update clock.")
    expected_clock = clock + int(target_passes > 0)
    wallet_time_before = connection.execute("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')").fetchone()[0]
    columns, _, events = snapshots["curated_event_records"]
    targets = [dict(zip(columns, row)) for row in events if row[columns.index("slug")] == slug]
    require(len(targets) == 1 and targets[0]["status"] == "published" and targets[0]["removed_at"] is None,
            "Exact published Pink Edition event is missing or ambiguous.")
    require(connection.execute("SELECT mode FROM event_registration_settings WHERE event_slug=?", (slug,)).fetchall() == [("rsvp",)],
            "Event correction requires the existing RSVP mode.")
    identities = {"curated_event_records": targets[0]["id"], "event_registration_settings": slug,
                  "party_submissions": targets[0]["submission_id"], "event_updates": "update:" + slug + ":preview"}
    def authorize(action, table, column, database, origin):
        if action == sqlite3.SQLITE_UPDATE:
            permitted = database == "main" and (
                (table in allowed and column in allowed[table] and origin is None)
                or (origin == "apple_wallet_event_refresh" and (
                    (table == "apple_wallet_update_clock" and column == "value")
                    or (table == "apple_wallet_passes" and column in {"update_tag", "updated_at"}))))
        else:
            permitted = action in (sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT) or (
                action == sqlite3.SQLITE_FUNCTION and ((column == "current_timestamp" and origin is None)
                or (column == "strftime" and origin == "apple_wallet_event_refresh")
                or (column == "raise" and origin in (
                    {"_bct_guard_" + name + "_update" for name in (*allowed, *wallet)}
                    | {"removed_event_stays_removed"}))))
        return sqlite3.SQLITE_OK if permitted else sqlite3.SQLITE_DENY
    connection.set_authorizer(authorize)
    try:
        # execute each fixed statement without executescript's implicit COMMIT.
        for statement in raw.decode("utf-8").split("--> statement-breakpoint"):
            connection.execute(statement)
    finally:
        connection.set_authorizer(None)
    wallet_time_after = connection.execute("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')").fetchone()[0]
    for table, (columns, key, before) in snapshots.items():
        after = connection.execute('SELECT * FROM "' + table + '" ORDER BY "' + key + '"').fetchall()
        require(len(before) == len(after), "Event correction changed a row count.")
        for old, new in zip(before, after):
            if table in wallet:
                for index, column in enumerate(columns):
                    if table == "apple_wallet_update_clock" and column == "value":
                        valid = new[index] == expected_clock
                    elif table == "apple_wallet_passes" and old[columns.index("event_slug")] == slug and column == "update_tag":
                        valid = new[index] == expected_clock
                    elif table == "apple_wallet_passes" and old[columns.index("event_slug")] == slug and column == "updated_at":
                        valid = isinstance(new[index], str) and wallet_time_before <= new[index] <= wallet_time_after
                    else:
                        valid = old[index] == new[index]
                    require(valid, "Event correction changed wallet data outside its reviewed refresh.")
                continue
            target = old[columns.index(key)] == identities[table]
            for index, column in enumerate(columns):
                require(old[index] == new[index] or (target and column in allowed[table]),
                        "Event correction changed unrelated data.")
    require(schema_rows(connection) == before_schema
            and connection.execute("SELECT id,frozen,transfer_id FROM _bct_handover_state ORDER BY id").fetchall() == control,
            "Event correction changed schema or writer state.")
    return {"eventSlug": slug, "preservedOnCodeRollback": True}


def workspace_writer_state(connection, table):
    """Recognize the active original handover writer without editing its guards."""
    control = connection.execute("SELECT sql FROM sqlite_schema WHERE type='table' AND name='_bct_handover_state'").fetchone()
    require(control and hashlib.sha256(control[0].encode()).hexdigest() == HOST_WRITER_CONTROL_SCHEMA,
            "Workspace schema migration requires the exact handover control schema.")
    state = connection.execute("SELECT id,frozen,transfer_id FROM _bct_handover_state ORDER BY id").fetchall()
    require(len(state) == 1 and state[0][:2] == (1, 0),
            "Workspace schema migration requires the active VPS writer.")
    expected = {}
    for operation in ("insert", "update", "delete"):
        name = "_bct_guard_" + table + "_" + operation
        expected[name] = ('CREATE TRIGGER "' + name + '" BEFORE ' + operation.upper() + ' ON "' + table
                          + '" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,\'Source writer is paused for verified handover\'); END')
    guards = connection.execute("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?", (table,)).fetchall()
    require({name: sql for name, sql in guards if name.startswith("_bct_guard_")} == expected
            and not connection.execute("SELECT 1 FROM sqlite_temp_schema WHERE type='trigger' AND tbl_name=?", (table,)).fetchall(),
            "Workspace schema migration refuses missing or drifted writer guards.")
    return state


def apply_workspace_schema(connection, specification, statements):
    """Perform one exact old-to-new schema transition, never a data correction."""
    require(connection.in_transaction, "Workspace schema changes require the migration transaction.")
    path = specification["path"]
    archive = path == RECOVERABLE_ARCHIVE_PATH
    table = "curated_event_records" if archive else "event_registrations"
    writer = workspace_writer_state(connection, table)
    before = schema_rows(connection)
    names = specification["objects"]
    if not archive:
        require(schema_digest([row for row in before if row[1] in OWNER_NOTIFICATION_PREREQUISITES])
                == OWNER_NOTIFICATION_PREREQUISITES_SHA256,
                "Owner notification prerequisites differ from the exact reviewed schema.")
    observed = schema_digest([row for row in before if row[1] in names])
    require(observed in (specification["beforeSchemaSha256"], specification["schemaSha256"]),
            "Workspace schema is partial or differs from the exact reviewed old/new state.")
    if observed == specification["schemaSha256"]:
        return False  # Preserve populated archive fields, devices and deliveries.
    changes = connection.total_changes
    for statement in statements:
        connection.execute(statement)
    after = schema_rows(connection)
    require(schema_digest([row for row in after if row[1] in names]) == specification["schemaSha256"]
            and [row for row in after if row[1] not in names] == [row for row in before if row[1] not in names]
            and connection.total_changes == changes
            and workspace_writer_state(connection, table) == writer,
            "Workspace schema migration changed unreviewed schema, rows or writer state.")
    if archive:
        require(connection.execute("SELECT 1 FROM curated_event_records WHERE archived_at IS NOT NULL LIMIT 1").fetchone() is None,
                "Archive migration must not backfill existing events.")
    return True


def apply_host_brand_identity(connection, specification, statements):
    """Add only the reviewed nullable fields and brand the exact existing host."""
    require(connection.in_transaction, "Host brand changes require the migration transaction.")
    require(len(statements) == 3, "Host brand migration requires exactly three reviewed statements.")
    writer = host_writer_state(connection)
    before_schema = schema_rows(connection)
    observed = schema_digest([row for row in before_schema if row[1] == "hosts"])
    require(observed in (specification["beforeSchemaSha256"], specification["schemaSha256"]),
            "Host brand schema is partial or differs from the exact reviewed old/new state.")
    columns = [row[1] for row in connection.execute("PRAGMA table_xinfo(hosts)")]
    before = connection.execute("SELECT * FROM hosts ORDER BY id").fetchall()
    identity, slug, updated = (columns.index(name) for name in ("id", "slug", "updated_at"))
    targets = [index for index, row in enumerate(before)
               if row[identity] == "host:kofi-bills" or row[slug] == "kofi-bills"]
    require(len(targets) == 1 and before[targets[0]][identity] == "host:kofi-bills"
            and before[targets[0]][slug] == "kofi-bills",
            "Exact existing Kofi Bills host identity is missing or ambiguous.")
    target = targets[0]
    brand = ("The Yorke Way", "/hosts/the-yorke-way.svg")
    changed = observed == specification["beforeSchemaSha256"]
    if not changed:
        require(tuple(before[target][columns.index(name)] for name in ("brand_name", "brand_logo_url")) == brand,
                "Host brand values are partial or differ from the exact reviewed replay state.")
        return {"hostId": "host:kofi-bills", "changed": False, "preservedOnCodeRollback": True}
    changes = connection.total_changes
    for statement in statements[:2]:
        connection.execute(statement)
    after_schema = schema_rows(connection)
    require(schema_digest([row for row in after_schema if row[1] == "hosts"]) == specification["schemaSha256"]
            and [row for row in after_schema if row[1] != "hosts"]
                == [row for row in before_schema if row[1] != "hosts"]
            and connection.total_changes == changes,
            "Host brand schema change modified unreviewed schema or rows.")
    earliest = connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0]
    def authorize(action, table, column, database, origin):
        if action == sqlite3.SQLITE_UPDATE:
            allowed = (database == "main" and table == "hosts" and origin is None
                       and column in ("brand_name", "brand_logo_url", "updated_at"))
        else:
            allowed = action in (sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT) or (
                action == sqlite3.SQLITE_FUNCTION and (
                    (column == "current_timestamp" and origin is None)
                    or (column == "raise" and origin == "_bct_guard_hosts_update")))
        return sqlite3.SQLITE_OK if allowed else sqlite3.SQLITE_DENY
    connection.set_authorizer(authorize)
    try:
        cursor = connection.execute(statements[2])
    finally:
        connection.set_authorizer(None)
    require(cursor.rowcount == 1 and connection.total_changes - changes == 1,
            "Host brand correction did not change exactly one row.")
    latest = connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0]
    after = connection.execute("SELECT * FROM hosts ORDER BY id").fetchall()
    require(len(after) == len(before), "Host brand correction changed the host row count.")
    timestamp = after[target][updated]
    require(isinstance(timestamp, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", timestamp)
            and earliest <= timestamp <= latest, "Host brand correction timestamp is unexpected.")
    expected = [row + (None, None) for row in before]
    row = list(expected[target])
    row[updated], row[-2], row[-1] = timestamp, *brand
    expected[target] = tuple(row)
    require(after == expected and schema_rows(connection) == after_schema,
            "Host brand correction changed unrelated host values or database schema.")
    require(host_writer_state(connection) == writer,
            "Host brand correction changed preserved handover control values.")
    return {"hostId": "host:kofi-bills", "changed": True, "preservedOnCodeRollback": True}


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
    reviewed, additions, corrections, transitions = [], [], [], []
    host_brand = None
    for specification, raw in migrations:
        statements, rows = reviewed_migration(raw, specification)
        if specification.get("path") == HOST_BRAND_IDENTITY_PATH:
            require(len(migrations) == 1, "Host brand identity must be the only migration in its release.")
            host_brand = (specification, statements)
            continue
        if specification.get("path") in WORKSPACE_SCHEMA_PATHS:
            transitions.append((specification, statements))
            continue
        reviewed.extend(statements)
        additions.extend(rows)
        if specification.get("kind"):
            corrections.append((specification["kind"], raw))
    require(not corrections or len(corrections) == len(migrations) == 1,
            "The exact host correction must be the only migration in its release.")
    paths = [specification["path"] for specification, _ in transitions]
    require(not transitions or (len(transitions) == len(migrations) and paths == sorted(set(paths))),
            "Workspace schema transitions require an isolated, ordered, non-duplicate migration plan.")
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
        correction = None
        if corrections:
            kind, raw = corrections[0]
            correction = (confirm_pink_edition(connection, raw) if kind == "pink-edition-confirmed"
                          else correct_host_verification(connection, raw))
        transitioned = [apply_workspace_schema(connection, specification, statements)
                        for specification, statements in transitions]
        brand_result = apply_host_brand_identity(connection, *host_brand) if host_brand else None
        after = schema_rows(connection)
        transition_names = {name for specification, _ in transitions for name in specification["objects"]}
        if host_brand:
            transition_names.add("hosts")
        require(sorted(row for row in after if row[1] in names) == sorted(additions)
                and [row for row in after if row[1] not in names and row[1] not in transition_names]
                    == [row for row in before if row[1] not in names and row[1] not in transition_names],
                "An existing database schema changed during additive migration.")
        require(connection.execute("PRAGMA foreign_key_check").fetchall() == [],
                "Additive migration failed foreign-key verification.")
        connection.commit()
    result = {"phase": "verified", "backupSha256": digest_file(backup),
              "schemaSha256": schema_digest(sorted(additions + [row for row in after if row[1] in transition_names])),
              "created": any(transitioned) or bool(brand_result and brand_result["changed"])
                         or (bool(additions) and not bool(present)), "tablesPreservedOnRollback": True,
              "migrations": [specification for specification, _ in migrations]}
    if correction is not None:
        result["publicEventCorrection" if corrections[0][0] == "pink-edition-confirmed" else "publicHostCorrection"] = correction
    if brand_result is not None:
        result["publicHostBrand"] = brand_result
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
        if "candidateVerification" in self.proof:
            validate_parallel_proof(self.proof["candidateVerification"], repository=self.proof.get("repository"),
                                    candidate=self.proof.get("candidateSha"), tree=self.proof["sourceTree"],
                                    run_id=self.proof.get("candidateRun"), attempt=self.proof.get("candidateAttempt"))
            require(self.proof["candidateVerification"]["audit_trusted_base"] != self.source,
                    "Parallel source cannot be its own trusted control baseline.")
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
        if any(item.get("kind") == "pink-edition-confirmed" for item in self.migrations):
            require(len(self.migrations) == 1,
                    "Pink Edition correction requires its isolated code-first migration boundary.")
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
        require(not self.record.get("lastCodeRelease", {}).get("pendingDataMigrations"),
                "A prior event correction is pending; inspect its private evidence before another release.")
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
        # This data-only correction needs the new opening-time enforcement and
        # flyer asset. Commit the independently verified compatible runtime
        # first; never expose these fields to the old application on rollback.
        pink_after_code = bool(self.migrations) and all(
            item.get("kind") == "pink-edition-confirmed" for item in self.migrations)
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
        if not pink_after_code:
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
            if pink_after_code:
                for public in (False, True):
                    for path, expected_digest in PINK_EDITION_ASSETS.items():
                        status, body = self.system.request(path, public)
                        require(status == 200 and hashlib.sha256(body).hexdigest() == expected_digest,
                                "Compatible event flyer verification failed: " + path)
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
            if self.migrations and not pink_after_code:
                key = "reviewedDataMigrations" if any(item.get("kind") for item in self.migrations) else "additiveMigrations"
                record["lastCodeRelease"][key] = self.migrations
                record["lastCodeRelease"]["databaseBackupSha256"] = self.migration_result["backupSha256"]
            if pink_after_code:
                record["lastCodeRelease"]["pendingDataMigrations"] = self.migrations
            require(self.file(self.journal, private=True) == self.before["journal"], "Handover journal drifted before commit.")
            journal_after = (json.dumps(record, sort_keys=True) + "\n").encode()
            atomic_write(self.journal, journal_after)
            self.evidence("code-verified-event-pending" if pink_after_code else "verified")
            if self.approval is not None:
                self.approval.consume()
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

        # The code transaction is committed. A failure from here must retain
        # this healthy compatible runtime, never roll back to old RSVP logic.
        # SQLite handles a failed data transaction; no live database is copied
        # over customer writes. Ambiguous completion requires operator review.
        if pink_after_code:
            try:
                require(self.system.property("WorkingDirectory") == str(self.release),
                        "Compatible event runtime changed before correction.")
                ready(self.system, self.source, candidate=True)
                require(self.file(self.journal, private=True) == journal_after,
                        "Release journal drifted before event correction.")
                self.migrate()
                require(self.file(self.journal, private=True) == journal_after,
                        "Release journal drifted during event correction.")
                del record["lastCodeRelease"]["pendingDataMigrations"]
                record["lastCodeRelease"]["reviewedDataMigrations"] = self.migrations
                record["lastCodeRelease"]["databaseBackupSha256"] = self.migration_result["backupSha256"]
                atomic_write(self.journal, (json.dumps(record, sort_keys=True) + "\n").encode())
                self.evidence("verified")
            except BaseException as failure:
                self.evidence("event-correction-needs-attention")
                raise ReleaseError("Compatible runtime retained; event correction needs review. No old-code rollback or database restore was performed.") from failure
        return {"released": self.source, "previous": self.expected, "active": True,
                "runtime": "vps", "publicVerified": True, "dataMigration": bool(self.migrations),
                "cryptoEnabledRequested": self.enable_crypto}

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
    verify.add_argument("--candidate-mode", choices=("legacy", "parallel-v1"), default="legacy")
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
