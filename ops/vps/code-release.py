#!/usr/bin/env python3
"""Explicit Tickets VPS release with narrowly reviewed database changes.

The CI verifier binds successful main-runtime and browser runs to exact Git trees.
The host transaction runs under the existing deployment lock, keeps private rollback
snapshots, and never edits the private credential bridge or original handover fields.
"""
import argparse
import copy
from contextlib import closing
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
# retention.py protects current/previous and has a two-day grace. A release must
# retain at least one hour of that grace before any pointer can lose protection.
RETENTION_SAFE_AGE = 2 * 86400 - 3600
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

REVIEWED_APPLICATION_BLOBS = {
    "ops/vps/test_release_source.py": "ec8a7a5bbbe585941583f50624823b85ec51e586",
    "scripts/checkbox-hotfix-audit-policy.json": "7447247befa4b9ef0a274b27352afdce690e9e1e",
    "ops/vps/test_runtime_workflow_contract.py": "eef0b25e667f6be123c0ed6c5bca774158d390d8",
    "tests/repository-boundaries.test.mjs": "45c323bca8ade5518051d7a7b3e0cafff8be5b99",
    "tests/preview-data-inventory.test.mjs": "35f897420e6afe6b50c4bfa8aedd6eeeb370283d",
    "scripts/inspect-preview-data.mjs": "e6c8e9f07262a8088d6daca199e69a6f24c46af5",
    "scripts/inspect-vps-handoff.mjs": "88c049b7357ee319222580d0de63fd079c07ab98",
    ".github/workflows/tickets-handover.yml": "5bef3d7019966a548ef4ae515a0309d9ff6e2847",
    "ops/vps/test_public_runtime_guard.py": "eb1fd8a6909c7c0634326da1d35c7a4606fbebe7",
    "ops/vps/public_runtime_guard.py": "9a9739f1bd88cbd02dc420001efa3de5b85e3538",
    "tests/test_caption_source.py": "a11c4986e185f883ff2a296b38bb99fd7c275d59",
    "scripts/caption-source-manifest.json": "1b178a1a371ae047f8bf26498d249e272c11497d",
    "scripts/verify-caption-source.py": "fa474c5d8cfaad8df53e77004c063e1511ed0b68",
    ".github/scripts/verify-caption-control.py": "19366f37243794bba916dd6cff0b7731aaec8f1c",
    ".github/backup/backup_release.py": "64330f28dd1561fa591efd6582704285348af1ea",
    ".github/backup/test_backup_release.py": "cd805866b06b0a70ab3bf384db19990d96a0dffd",
    ".github/workflows/backup-transport-checks.yml": "7e32458428475121554f43c8a3f646e70d11161e",
    ".github/workflows/deploy.yml": "f698c67d2015e8172f98562d840c80a96fbd8d0d",
    ".github/workflows/tickets-backup.yml": "9077f257dbcfb1a8842dcf54a2bf3dff084461d6",
    "ops/vps/test_runtime_packaging.py": "b43d7208a4127cba6bc712a871c4dc11632a6746",
    ".github/workflows/tickets-code-release.yml": "caf28c195613496857e70193b525a4f36f927c2f",
    "scripts/audit-analytics.mjs": "e8da0ec9f7ef0e9c857c60b059ebaabbc1710baf",
    "playwright.config.ts": "458baa39707043948474dae29bd5341c7ea5a883",
    "ops/vps/test_candidate_evidence.py": "7fd1baecfab2f8500926b510e7e6b5ea695e5bc1",
    "ops/vps/test_runtime_release.py": "210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14",
    "ops/vps/candidate_evidence.py": "d65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba",
    "ops/vps/runtime_release.py": "043e310a41ff28d23adc20383c88566b181232a6",
    ".github/workflows/tickets-release-operator-checks.yml": "99adefeef3c6c4829ef7385d0597f66a2ebae0c4",
    ".github/workflows/vps-runtime.yml": "e5ff3784b3d987f13cbcb2259d6c85acdc80e4e9",
    ".github/workflows/browser-audit.yml": "4e0293b58478326e6c22e653f69272ce6e64f7e3",
    ".github/workflows/candidate-checks.yml": "999b09f8daab5bfa44d0a88e81ceb1ec6efdfd30",
    ".github/workflows/dependency-security.yml": "dc3be8220217d4c6db65549d4e179374cd2b5fda",
    ".github/workflows/full-audit-capacity.yml": "67ea27fb202cf216596bd27d73e51515f656b19c",
    ".github/workflows/tickets-readiness-audit.yml": "f47378c33914b0005ec15598fb0f9110d6882c6d",
    "README.md": "d104e3598aadc56d2d410dedf7c25b95570bc90c",
    "app/access-polish.css": "d565de3c7a828d9c415421a2ec954128cdf0fad6",
    "app/account/privacy/privacy-settings.tsx": "b04b3a832f8e0acdc33e95952875801191a579ef",
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
    "app/api/admin/check-in/route.ts": "cc4a9a5c8385ef45b40a61f5dcd69f8e150d62e2",
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
    "app/api/customer/recovery/claim/route.ts": "3e0156f04c0ea06dc74f94970f22203663f7b499",
    "app/api/customer/recovery/route.ts": "0f2059fcb5c20222756c6ec9174c10ac58a7cdae",
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
    "app/api/organizer/workspace/route.ts": "cc4d7ed4ee18f6c8c3ef5084865cdab314e6e672",
    "app/api/payments/initialize/route.ts": "abbb1f8040a09c7c094e3319ca360dae80c8cc29",
    "app/api/payments/quote/route.ts": "9b483e873c82a3c2dccddfba55fa455a06c1386d",
    "app/api/payments/seevplus/webhook/route.ts": "bfe1b94c32768cf5689c823195f0fd1e45064d68",
    "app/api/payments/webhook/route.ts": "9197d6f67bcd7d172e2d344c744ba77012efda3f",
    "app/api/promoter/route.ts": "9037908c9b60c828b79136674289b9fe48e221e2",
    "app/api/public/events/route.ts": "7893a675d91939964c96808f30b87d1a71aeb26a",
    "app/api/registrations/claim/route.ts": "ab509df1fa78aafe06655505a9ec69f8b5eb5d7a",
    "app/api/registrations/route.ts": "2fa745f4f4fc205390f351fc235e4bb6e84fe20e",
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
    "app/globals.css": "40f080f5629b811b1a877bebdeadb97e02af0b07",
    "app/help/help-centre.tsx": "f0b4617a6a6b704aefc81bfa1e2744377c18b026",
    "app/home-screen.tsx": "b629019108100f15889edaccd6ac1ee21d4e436d",
    "app/hosts/page.tsx": "f5d2b1129968ba51dc95a6208a408e60f200b05b",
    "app/iphone-interface.css": "3dd3b6b529819123cbc6fa9e71f48a95b193cb1d",
    "app/layout.tsx": "056b004843736b4c37bf6f1ea256fd1b8ab9e0b7",
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
    "app/registration-form.tsx": "892574dd3198a410d5fea00232e607783d2e77df",
    "app/registration-manager.tsx": "cd0b22d16d2ff9bd45adbd917744a3248e2cb04e",
    "app/room-demo.css": "c3d871ed75945a72df7fb32f7c13c962ee4876de",
    "app/room-overlay.tsx": "97d273e63be52e8154925512524d25062237d69b",
    "app/room-preview-carousel.tsx": "c77a4021be9ea6c29b6a8215e49326f2522e9491",
    "app/room/[slug]/room-client.tsx": "043000a1a4d51ea07acd170046f4898894a3945e",
    "app/rsvp/[slug]/page.tsx": "40ba4869d74f15e722834a9e682bc0867e2b054a",
    "app/rsvp/access/page.tsx": "02c302374244f4e73436acdc2dc80d99e8326d86",
    "app/scan/layout.tsx": "d66e9b510543e73deb36c7d56b39dac83b60afa2",
    "app/scan/page.tsx": "14c9facaac5aadd32c63bea083b8bf5c2d034874",
    "app/scan/scanner.tsx": "69d9bf7cf154bc7b7aaeca6a7bf26ab5d083a085",
    "app/segmented-control.css": "b4b85d7656046b56447728a292b2f70e30127c14",
    "app/segmented-control.tsx": "d68e0038b37928467b25f62780a91ffd61b82eac",
    "app/support-email.tsx": "98bc769b8cb2b34ae363a488b1e6c343c6399921",
    "app/terms/page.tsx": "419f0978b0e03084cc99738a6404c3f132f93bef",
    "app/use-header-panel.ts": "24a3e6e3fb54ed67b28c348d77f1b92e60310448",
    "app/use-layer-history.ts": "8f6421c896a29e90ff1f2bd5742f677c6543a2d2",
    "app/use-room-demo.ts": "7ea2ec4191b5f5b9dff10cdfa2925a69514a434f",
    "app/workspace-chrome.tsx": "f6b90f36cec6914e9b36570c52dd9c53870a5e70",
    "app/workspace.css": "8c3881d31c50a13246219e74262c27b542e36880",
    "db/schema.ts": "ee50c0c9821c0d4f47e5b0bfb86df6b902e11afb",
    "lib/admin-session.ts": "2e587fc729a69c667fb851d69d0053f0ac58527b",
    "lib/background-health.ts": "4793c1cd2a5204371e75495d9d1b218f24a0a092",
    "lib/customer-screen.ts": "9546a787d811e4a8351e16e30693639c26743b26",
    "lib/email-delivery.ts": "6046a9696d8f3002c23d0af54e08fa93179e0ee5",
    "lib/event-guest.ts": "376bf08ff8b52898a4bbc3ab913ea0350134d1db",
    "lib/operational-finance.ts": "7e910e7765074c174695ca32338dee0fd9ae0681",
    "lib/operations-exceptions.ts": "ad4ba837129ba67ffa08745bdb3ff6ea4c838800",
    "lib/organizer-team.ts": "0214111d285e2bb19ee95af1934df68307126919",
    "lib/payment-operations.ts": "9935707757fe77069210f2f72b510ad09656b781",
    "lib/provider-operation-tracking.ts": "63288d84fa93f0a97ee01909a68a654272151cbb",
    "lib/registration-draft.ts": "633cdb6e22cb28a1c8002fab96da0bf9fe6eb91b",
    "lib/registration-guidance.ts": "16bf24b5c2c23fa18e1dd16d14563cbed33164b2",
    "lib/request-body.ts": "3a948295f1551a837bd71e6cb45b46548db38c27",
    "lib/scanner-sync.ts": "68d45f670f1cf1d3a26c9ff10c5fbdbf21bb8243",
    "mobile/src/adapters/navigation.tsx": "475edbb849c70e265e5fbdff6931511b40138f52",
    "mobile/src/screen-catalogue.ts": "3c7030e0374696f31af397e7970be77173418194",
    "mobile/tests/app.spec.ts": "8dc775ae5404008dbe34714639a0c0bd0a3fe904",
    "mobile/tests/screen-catalogue.test.ts": "2fa5352cac4af250d6ac5a85cf880b0630020d61",
    "mobile/tsconfig.json": "be7802b84428c49a3ddeb14b79373b8cdae64234",
    "mobile/vite.config.ts": "985e6a0bab112aeb54e470a7bd6a34bdeccf0b5e",
    "ops/vps/audit-readiness.py": "0de0b0f96343bbd6acb3b2f800ec2e2983505d22",
    "ops/vps/test_audit_readiness.py": "226ab932b1b851a4b2c0eb6ede8bc17e66e5bfa9",
    "public/devices/iphone-titanium-front.svg": "9b3995ea6e27f358d03816d603f96466fa8e9acd",
    "runtime/vps/queue.mjs": "67018da3a3683aca80661e29e64f0fd3e5a37e9c",
    "runtime/vps/server.mjs": "bdbea3652bed999a03adfba96df5fcb56dd07c6c",
    "scripts/capture-iphone-layouts.mjs": "4abbb15794097eed900e009c2af956e06b96c340",
    "scripts/iphone-layout-evidence.mjs": "42daec5963ef6da3f1394fe499c79ba53c647a4d",
    "scripts/verify-vps-runtime.mjs": "cce13d6b123abb4a7da7341a854de54f049fadef",
    "styles/customer.css": "c6d3cc402fcb37287444c9ac75777424ceeac891",
    "styles/workspace.css": "a3e99468e1ad940dfdea923fd535d7421570a2bc",
    "worker/background.ts": "b266dec887de9f00a426ff78ab79ff9bb3af6a3b",
    "worker/security-response.ts": "3d9d92746405583edcd173694d763c868a1b09fd",
    "worker/the-room.ts": "e6c0a8b1e39e20b939e3e322ebc44675b8bab7ed",
    "scripts/audit-checkbox-hotfix.py": "5313d8cdc4076b36d434fe8017cc0e7b4824e876",
    "tests/test_checkbox_hotfix_audit.py": "421ec5fd992b1ba258e357ff4a65f6c3a647d2ce",
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
    "Verify exact source ancestry before executing checkout code",
    "Run npm audit --audit-level=moderate",
    "Prepare verified runtime without development dependencies",
    "Publish verified public runtime release",
}
RUNTIME_HANDOFF_STEPS = {
    "Verify exact source ancestry before executing checkout code",
    "Inspect current data and private connection readiness",
}
CANDIDATE_CORE_STEPS = {
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


class Deployment:
    def __init__(self, *, source, expected, run_id, attempt, archive, provenance,
                 archive_digest, provenance_digest, enable_crypto=False, recover_prepared=None,
                 root=Path("/"), system=None):
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

    def file(self, path, private=False, owner=None):
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == (os.geteuid() if owner is None else owner),
                "Expected owned regular file: " + str(path))
        require(not private or stat.S_IMODE(info.st_mode) == 0o600,
                "Private file must have mode 0600: " + str(path))
        return path.read_bytes()

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

    def retention_safe(self):
        require(all(target.is_dir() and not target.is_symlink()
                    and time.time() - target.stat().st_mtime < RETENTION_SAFE_AGE
                    for target in self.rollback_releases),
                "Rollback release is outside the safe retention grace; inspect before releasing.")

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
        self.evidence("prepared")
        self.unpack()  # no service/configuration changes before archive validation
        try:
            self.migrate()
        except BaseException:
            self.evidence("migration-failed")
            raise
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
            # Keep both old pointers pinned through health verification. Only after
            # readiness, and with one hour of retention grace left, commit pointers.
            self.retention_safe()
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
            return self.transact()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    operator = commands.add_parser("verify-operator")
    operator.add_argument("--source", required=True)
    verify = commands.add_parser("verify-ci")
    for name in ("source", "expected", "repository", "metadata", "runtime-run", "candidate-run", "archive", "output"):
        verify.add_argument("--" + name, required=True)
    apply = commands.add_parser("apply")
    for name in ("source", "expected", "run-id", "attempt", "archive", "provenance", "archive-digest", "provenance-digest"):
        apply.add_argument("--" + name, required=True)
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
