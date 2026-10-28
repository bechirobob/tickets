"""Filesystem/service mocks only: these tests never contact a VPS or provider."""
import argparse
import copy
from contextlib import contextmanager
import fcntl
import importlib.util
import io
import json
import marshal
import os
import re
import sys
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile
import textwrap
import types
import unittest
from unittest.mock import call, patch

spec = importlib.util.spec_from_file_location("code_release", Path(__file__).with_name("code-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
# Test-only selection of the separately reviewed application. An actual source
# checkout is never redirected unless every application byte remains the exact
# independently selected controls baseline and only these two controls changed.
CONTROL_CHECK_BASE = "ae76d2d69e27a0ad9c8e07d98e3955ab8e2e75af"
CONTROL_CHECK_TREE = "dfca7a11184d75c91e1cc13d5fa3b5edf027e450"
REVIEWED_APP_SNAPSHOT = "991217dedb580ffd007d6a9d999b96bc59b1d0b3"
REVIEWED_APP_TREE = "a5709436005ba1aaa7df67cd23eb3611f08ae983"
CONTROL_CHECK_FILES = {"ops/vps/code-release.py", "ops/vps/test_code_release.py"}


class TransactionalMailAdmissionTests(unittest.TestCase):
    """Exercise the unchanged source gate with isolated real Git objects."""
    admitted = {
        "lib/email-delivery.ts": "dcad73b8a824af75949a8b02cba9977d00b182f8",
        "lib/transactional-email.ts": "6d7ea0dda0b1b0538e07be352b0b7ae39de1d8ce",
        "worker/background.ts": "d5683c2699242330cec52fe5962614e33e635bdb",
    }

    def test_only_exact_mail_outputs_are_admitted(self):
        for name, blob in self.admitted.items():
            self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], blob)
            self.assertNotIn(name, release.APPLICATION_FILES)

    def test_mail_source_gate_rejects_mutation_unrelated_path_and_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous = Path.cwd()
            os.chdir(root)
            self.addCleanup(os.chdir, previous)
            def git(*args):
                return subprocess.check_output(["git", *args], text=True,
                    stderr=subprocess.DEVNULL).strip()
            def write(name, content):
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content)
                return file
            def commit():
                git("add", "-A")
                git("commit", "-qm", "isolated admission fixture")
                return git("rev-parse", "HEAD")
            git("init", "-q")
            git("config", "user.name", "Release tests")
            git("config", "user.email", "tests@example.invalid")
            write("README.md", "baseline\n")
            baseline = commit()
            for name in self.admitted:
                write(name, "reviewed fixture " + name + "\n")
            candidate = commit()
            pins = {name: git("rev-parse", candidate + ":" + name) for name in self.admitted}
            with patch.dict(release.REVIEWED_APPLICATION_BLOBS, pins):
                release.vetted_changes(baseline, candidate)
                for name in self.admitted:
                    git("reset", "--hard", candidate)
                    file = root / name
                    file.write_text(file.read_text() + "x")
                    changed = commit()
                    with self.subTest(path=name), self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
                        release.vetted_changes(baseline, changed)
                git("reset", "--hard", candidate)
                write("lib/unreviewed-mail.ts", "not admitted\n")
                with self.assertRaisesRegex(release.ReleaseError, "Unvetted source path"):
                    release.vetted_changes(baseline, commit())
                git("reset", "--hard", candidate)
                (root / "lib/transactional-email.ts").chmod(0o755)
                with self.assertRaisesRegex(release.ReleaseError, "New executable"):
                    release.vetted_changes(baseline, commit())
            os.chdir(previous)


def checkout_git(root, *args):
    return subprocess.check_output(["git", "--no-replace-objects", "-C", str(root), *args],
        stderr=subprocess.DEVNULL, env=release.git_environment(), timeout=60)


# Advisory benchmark additions are exact test-source pins, not release authority.
# All-or-none recognition lets the unchanged application-family assertions run
# against this tooling increment. Deployment admission is deliberately unchanged.
BENCHMARK_FILE_BLOBS = {'.github/workflows/candidate-parallel-checks.yml': '313182fc21841d8a059be596c7c31e0a0b179a33', 'ops/vps/candidate_build.py': '5820b026f9747961081fc3e8b8e5531bf546621a', 'ops/vps/test_candidate_build.py': '332079c682451af3c3e1ac36feef0129d1975b29', 'scripts/release-timing.py': '27f76adcc0ef2ad71b9e9696eb050ff643232d28', 'tests/test_release_timing.py': '874dc439367e2600fc764ba0d26e8fb3c93b37dd', 'docs/reliability/release-timing.md': '4f2bfabd835257370f55b50fa03bb272127436fa', 'docs/reliability/parallel-candidate-benchmark.md': 'c7706b3ffea9fbd2c73a435cc516e3d8c3bde289', 'tests/test_candidate_parallel_workflow.py': '26f56b2aca434e930718cb75db3a4a9863131411'}


def benchmark_checkout_files(root):
    present = {name for name in BENCHMARK_FILE_BLOBS if os.path.lexists(root / name)}
    if not present:
        return set()
    if present != set(BENCHMARK_FILE_BLOBS):
        raise ValueError("Incomplete benchmark tooling family")
    for name, expected in BENCHMARK_FILE_BLOBS.items():
        path = root / name
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o111
                or any(parent.is_symlink() for parent in (path, *path.parents))):
            raise ValueError("Nonregular benchmark tooling")
        raw = path.read_bytes()
        actual = release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        if actual != expected:
            raise ValueError("Unreviewed benchmark tooling bytes")
    return present


# Complete staged B inventory, including scripts not used by a particular test.
# The parallel family replaces exact outputs as a whole; it cannot select an
# older per-file variant or hide an unexpected staged file.
PARALLEL_STAGED_BASE = {'.github/scripts/verify-audit-control.py': ('100644', '87cd21e095c76efc9e607484b8c0836db9bc58b5'),
 '.github/scripts/verify-caption-control.py': ('100644', '19366f37243794bba916dd6cff0b7731aaec8f1c'),
 '.github/workflows/candidate-checks.yml': ('100644', 'dc127e63338b3ac2f8498a2114fe7a465c64344b'),
 '.github/workflows/deploy.yml': ('100644', 'e90f3ab46d499cfe6a03f859452046ca3a026993'),
 '.github/workflows/tickets-code-release.yml': ('100644', '808e8014f7af281b3370e411be1f6a3808d2e88b'),
 '.github/workflows/tickets-release-operator-checks.yml': ('100644',
                                                           'e1674c3407ac586aeaf67a2166a9ad32c7cd5bef'),
 '.github/workflows/vps-runtime.yml': ('100644', '3041cf9b68ba250429e8f58e5404d10b2f9330a0'),
 'ops/vps/audit-readiness.py': ('100644', '69c7dff10fc2b8d1046b84e0a43dbdb4dacb3ecf'),
 'ops/vps/backup.mjs': ('100644', 'ca2c1a0fa1aa4cb075fa0b90d9d46218666c7967'),
 'ops/vps/becore-tickets-preview.service': ('100644', '889233505917ae749ee276050d7f9060c975ed4a'),
 'ops/vps/becore-tickets-retention.service': ('100644', '68f4ab992f05742a086f23af7983f9c5561b1b13'),
 'ops/vps/becore-tickets-retention.timer': ('100644', '7d77baf5059b0fc725976e8d4eceeb53a53ed2ff'),
 'ops/vps/candidate_build.py': ('100644', '5820b026f9747961081fc3e8b8e5531bf546621a'),
 'ops/vps/candidate_evidence.py': ('100644', 'd65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba'),
 'ops/vps/code-release.py': ('100644', 'f8ac599c8affb7d3f1781d4903db3f71f20c1600'),
 'ops/vps/initialize-preview.mjs': ('100644', '6171616a2d73ed536aad0896d3016d2d41a6ba95'),
 'ops/vps/install-preview.py': ('100644', '0fb837d72409234a074b2891c784f0f7605e600f'),
 'ops/vps/journal-limits.conf': ('100644', 'bd9c88d6d78144830b5d4ce26dce2d86825b84e5'),
 'ops/vps/prepare-origin.py': ('100644', '8939073562dd7e73073f092a09c3c973003c6b63'),
 'ops/vps/public_runtime_guard.py': ('100644', '9a9739f1bd88cbd02dc420001efa3de5b85e3538'),
 'ops/vps/restore-backup.mjs': ('100644', '0a05f18c17205ef4c2f59e2d50bd06180035b8c6'),
 'ops/vps/retention.py': ('100644', '9ab0304f00d2a96fd6fbb8e4c992d96db5eb08a1'),
 'ops/vps/runtime_release.py': ('100644', '043e310a41ff28d23adc20383c88566b181232a6'),
 'ops/vps/test_audit_readiness.py': ('100644', '086ab0cb48aa88ce934daefb54d60486925d36f8'),
 'ops/vps/test_candidate_build.py': ('100644', '332079c682451af3c3e1ac36feef0129d1975b29'),
 'ops/vps/test_candidate_evidence.py': ('100644', 'f63544c3ea061f75db1f544c85cddaae109a0f4e'),
 'ops/vps/test_code_release.py': ('100644', '179178468f872f7d5958165b78d0731b528379bb'),
 'ops/vps/test_pink_edition.py': ('100644', 'be26c898ac1e19f7f737dbe5112c5e40b6e90c68'),
 'ops/vps/test_public_runtime_guard.py': ('100644', 'eb1fd8a6909c7c0634326da1d35c7a4606fbebe7'),
 'ops/vps/test_release_approval.py': ('100644', '48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f'),
 'ops/vps/test_release_source.py': ('100644', 'ec8a7a5bbbe585941583f50624823b85ec51e586'),
 'ops/vps/test_retention.py': ('100644', 'f35d71212ec6ae521e3144c57e708297c513dce0'),
 'ops/vps/test_runtime_packaging.py': ('100644', '6f215f441ff1d9b92b3c870a6f438a54e5ccc1a1'),
 'ops/vps/test_runtime_release.py': ('100644', '210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14'),
 'ops/vps/test_runtime_workflow_contract.py': ('100644', 'eef0b25e667f6be123c0ed6c5bca774158d390d8'),
 'scripts/audit-checkbox-hotfix.py': ('100644', '5313d8cdc4076b36d434fe8017cc0e7b4824e876'),
 'scripts/audit-release-dependencies.py': ('100644', '47c7951e8db95ac666680bd2bf32fde3f1748c8e'),
 'scripts/audit-release-manifest.json': ('100644', 'bcb787e744f9fc5fc201e8068d553c1543b35b86'),
 'scripts/caption-source-manifest.json': ('100644', '1b178a1a371ae047f8bf26498d249e272c11497d'),
 'scripts/verify-audit-release-source.py': ('100644', '129d7bdbd2d631ad385a9edd7be4ea9895f173cf'),
 'scripts/verify-caption-source.py': ('100644', 'fa474c5d8cfaad8df53e77004c063e1511ed0b68'),
 'tests/test_audit_release_dependencies.py': ('100644', '6983998bf40fc1cb424e6dafbb7ba35e5653336d'),
 'tests/test_audit_release_source.py': ('100644', '6516f3f4b8582d3874ceda34e1fc3e3b799fec8d'),
 'tests/test_caption_source.py': ('100644', '6871fcc1ab410acaa74d8bd953ac9e0e61f4f670'),
 'tests/test_checkbox_hotfix_audit.py': ('100644', '421ec5fd992b1ba258e357ff4a65f6c3a647d2ce')}


# The operator can be independently pinned here because neither control file
# is in the production 13-output manifest. Only this test file self-exempts.
PARALLEL_OPERATOR_BLOB = 'd39435b192b4b38dfb097c4111a89b2703ca1148'
LEGACY_ORIGINAL_STAGED_BASE = {'.github/scripts/verify-audit-control.py': ('100644', '87cd21e095c76efc9e607484b8c0836db9bc58b5'),
 '.github/scripts/verify-caption-control.py': ('100644', '19366f37243794bba916dd6cff0b7731aaec8f1c'),
 '.github/workflows/candidate-checks.yml': ('100644', 'dc127e63338b3ac2f8498a2114fe7a465c64344b'),
 '.github/workflows/deploy.yml': ('100644', 'e90f3ab46d499cfe6a03f859452046ca3a026993'),
 '.github/workflows/tickets-code-release.yml': ('100644', '808e8014f7af281b3370e411be1f6a3808d2e88b'),
 '.github/workflows/tickets-release-operator-checks.yml': ('100644',
                                                           'e1674c3407ac586aeaf67a2166a9ad32c7cd5bef'),
 '.github/workflows/vps-runtime.yml': ('100644', '06d83690ed40675dae9f5e423cfcc73b3022fc1f'),
 'ops/vps/audit-readiness.py': ('100644', '0de0b0f96343bbd6acb3b2f800ec2e2983505d22'),
 'ops/vps/backup.mjs': ('100644', 'ca2c1a0fa1aa4cb075fa0b90d9d46218666c7967'),
 'ops/vps/becore-tickets-preview.service': ('100644', '889233505917ae749ee276050d7f9060c975ed4a'),
 'ops/vps/becore-tickets-retention.service': ('100644', '68f4ab992f05742a086f23af7983f9c5561b1b13'),
 'ops/vps/becore-tickets-retention.timer': ('100644', '7d77baf5059b0fc725976e8d4eceeb53a53ed2ff'),
 'ops/vps/candidate_evidence.py': ('100644', 'd65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba'),
 'ops/vps/code-release.py': ('100644', '26034251d8d3ca0156a434aca5ae4fb790db66e6'),
 'ops/vps/initialize-preview.mjs': ('100644', '6171616a2d73ed536aad0896d3016d2d41a6ba95'),
 'ops/vps/install-preview.py': ('100644', '0fb837d72409234a074b2891c784f0f7605e600f'),
 'ops/vps/journal-limits.conf': ('100644', 'bd9c88d6d78144830b5d4ce26dce2d86825b84e5'),
 'ops/vps/prepare-origin.py': ('100644', '8939073562dd7e73073f092a09c3c973003c6b63'),
 'ops/vps/public_runtime_guard.py': ('100644', '9a9739f1bd88cbd02dc420001efa3de5b85e3538'),
 'ops/vps/restore-backup.mjs': ('100644', '0a05f18c17205ef4c2f59e2d50bd06180035b8c6'),
 'ops/vps/retention.py': ('100644', '9ab0304f00d2a96fd6fbb8e4c992d96db5eb08a1'),
 'ops/vps/runtime_release.py': ('100644', '043e310a41ff28d23adc20383c88566b181232a6'),
 'ops/vps/test_audit_readiness.py': ('100644', '226ab932b1b851a4b2c0eb6ede8bc17e66e5bfa9'),
 'ops/vps/test_candidate_evidence.py': ('100644', 'f63544c3ea061f75db1f544c85cddaae109a0f4e'),
 'ops/vps/test_code_release.py': ('100644', '3d413b8b530f7eee378f88cb540475c2973b8b22'),
 'ops/vps/test_public_runtime_guard.py': ('100644', 'eb1fd8a6909c7c0634326da1d35c7a4606fbebe7'),
 'ops/vps/test_release_approval.py': ('100644', '48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f'),
 'ops/vps/test_release_source.py': ('100644', 'ec8a7a5bbbe585941583f50624823b85ec51e586'),
 'ops/vps/test_retention.py': ('100644', 'f35d71212ec6ae521e3144c57e708297c513dce0'),
 'ops/vps/test_runtime_packaging.py': ('100644', 'c7bb8a5bdb6a17c547a29d1289d15bdce4a57228'),
 'ops/vps/test_runtime_release.py': ('100644', '210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14'),
 'ops/vps/test_runtime_workflow_contract.py': ('100644', 'eef0b25e667f6be123c0ed6c5bca774158d390d8'),
 'scripts/audit-checkbox-hotfix.py': ('100644', '5313d8cdc4076b36d434fe8017cc0e7b4824e876'),
 'scripts/audit-release-dependencies.py': ('100644', '47c7951e8db95ac666680bd2bf32fde3f1748c8e'),
 'scripts/audit-release-manifest.json': ('100644', 'bcb787e744f9fc5fc201e8068d553c1543b35b86'),
 'scripts/caption-source-manifest.json': ('100644', '1b178a1a371ae047f8bf26498d249e272c11497d'),
 'scripts/verify-audit-release-source.py': ('100644', '129d7bdbd2d631ad385a9edd7be4ea9895f173cf'),
 'scripts/verify-caption-source.py': ('100644', 'fa474c5d8cfaad8df53e77004c063e1511ed0b68'),
 'tests/test_audit_release_dependencies.py': ('100644', '6983998bf40fc1cb424e6dafbb7ba35e5653336d'),
 'tests/test_audit_release_source.py': ('100644', '9d987c3d720d119d1bc3834d04af20a1e8efdc6c'),
 'tests/test_caption_source.py': ('100644', '6871fcc1ab410acaa74d8bd953ac9e0e61f4f670'),
 'tests/test_checkbox_hotfix_audit.py': ('100644', '421ec5fd992b1ba258e357ff4a65f6c3a647d2ce')}


def legacy_staged_manifests():
    """Whole historical families, never a per-file union of fingerprints."""
    variants = (release.REVIEWED_CONTROL_BLOBS,
                {name: release.REVIEWED_APPLICATION_BLOBS[name] for name in release.REVIEWED_CONTROL_BLOBS})
    prebenchmark = {name: entry for name, entry in PARALLEL_STAGED_BASE.items()
                    if name not in {"ops/vps/candidate_build.py", "ops/vps/test_candidate_build.py"}}
    families = []
    for base in (LEGACY_ORIGINAL_STAGED_BASE, prebenchmark, PARALLEL_STAGED_BASE):
        for variant in variants:
            manifest = dict(base)
            manifest.update({name: ("100644", value) for name, value in variant.items()})
            manifest["ops/vps/test_code_release.py"] = ("100644", None)
            families.append((manifest, variant))
    return families


def validate_staged_inventory(root, manifest):
    """Allow only the complete archive and genuine generated Python caches."""
    expected = set(manifest)
    directories = {parent.as_posix() for name in expected for parent in Path(name).parents if parent != Path('.')}
    python_sources = {name for name in expected if name.endswith('.py')}
    cache_directories = {str(Path(name).parent / '__pycache__') for name in python_sources}
    found = set()
    for path in root.rglob('*'):
        name = path.relative_to(root).as_posix()
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode):
            if name not in directories and (name not in cache_directories or not any(path.iterdir())):
                raise AssertionError("Unexpected staged directory")
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise AssertionError("Staged family requires regular single-link files")
        if name in expected:
            found.add(name)
            continue
        if str(Path(name).parent) not in cache_directories or info.st_mode & 0o111 or info.st_size > 16 * 1024**2:
            raise AssertionError("Unexpected staged file")
        suffix = '.' + sys.implementation.cache_tag
        match = re.fullmatch(r'(.+)' + re.escape(suffix) + r'(?:\.opt-([12]))?\.pyc', path.name)
        source_name = str(Path(name).parent.parent / (match[1] + '.py')) if match else ''
        if source_name not in python_sources:
            raise AssertionError("Cache has no pinned Python source")
        raw = path.read_bytes(); source = root / source_name
        source_info = source.stat()
        if (len(raw) < 16 or raw[:4] != importlib.util.MAGIC_NUMBER or raw[4:8] != bytes(4)
                or int.from_bytes(raw[8:12], 'little') != int(source_info.st_mtime) & 0xffffffff
                or int.from_bytes(raw[12:16], 'little') != source_info.st_size & 0xffffffff):
            raise AssertionError("Cache header is not the exact generated source cache")
        try:
            stream = io.BytesIO(raw[16:])
            cached = marshal.load(stream)
            if stream.read():
                raise AssertionError("Unexpected trailing cache content")
            filenames = {str(source), source_name, os.path.relpath(source)}
            if (not isinstance(cached, types.CodeType) or cached.co_filename not in filenames
                    or cached != compile(source.read_bytes(), cached.co_filename, 'exec', dont_inherit=True,
                                         optimize=int(match[2] or 0))):
                raise AssertionError("Cache code differs from its pinned Python source")
        except (ValueError, TypeError, EOFError, SyntaxError) as exc:
            raise AssertionError("Invalid generated Python cache") from exc
    if found != expected:
        raise AssertionError("Staged inventory differs from complete source family")


# Test-only, independently reviewed operational additions. This is not a
# production release allowlist. Every addition is pinned by path, mode and blob.
PURO_EXCESO_TEST_OVERLAY = {'.github/workflows/puro-exceso-listing.yml': ('100644', '8bf87a0ee41e69c44b10b092fd2f7b238b301af0'),
 '.github/workflows/puro-exceso-publish.yml': ('100644', '285efaf42ccbb5caf50673b08e6751a8733b2117'),
 'ops/handover/puro_exceso/activate.sha256': ('100644', 'e378ea429c22d4fe465246f53aa44cdb0f41a9c5'),
 'ops/handover/puro_exceso/apply.py': ('100644', 'e4d4f2ddacf5b4ab41aaed934a830af19a74c574'),
 'ops/handover/puro_exceso/event_insert.py': ('100644', '25d640e70488bb7ea7be014876c27caf50a7a951'),
 'ops/handover/puro_exceso/flyer.jpeg.b64': ('100644', '63563463aa0fd7a62e9490449f44420d48328604'),
 'ops/handover/puro_exceso/inspect.py': ('100644', 'da1d66b3a6d833d43d9ad1675dbd3cec16a57af0'),
 'ops/handover/puro_exceso/test_event_insert.py': ('100644', 'e7219b9b15312c9e1dbb1cd685156ee691cee050'),
 'ops/handover/puro_exceso/test_inspect.py': ('100644', '27ae56c68f2aea1b5020a99cdcda3ee95a8798d5'),
 'ops/handover/puro_exceso/verify_public.py': ('100644', 'd3abfefb3bc9e24398c1bc31b7c74b3c89d9f6cb')}


# Separate exact recovery test family. Existing historical families stay frozen.
CINCO_RECOVERY_OPERATOR_BLOB = '9728276850df89f9fe7b8a902656165488e9923d'
CINCO_RECOVERY_STAGED_BASE = {'.github/scripts/verify-audit-control.py': ('100644', '87cd21e095c76efc9e607484b8c0836db9bc58b5'),
 '.github/scripts/verify-caption-control.py': ('100644', '19366f37243794bba916dd6cff0b7731aaec8f1c'),
 '.github/workflows/candidate-checks.yml': ('100644', 'dc127e63338b3ac2f8498a2114fe7a465c64344b'),
 '.github/workflows/candidate-parallel-checks.yml': ('100644', '81bad0f7a602c579fc14c961aa8e26e32f75767d'),
 '.github/workflows/deploy.yml': ('100644', 'e90f3ab46d499cfe6a03f859452046ca3a026993'),
 '.github/workflows/tickets-code-release.yml': ('100644', '9c5ca1129fe7e97215b3d895060a4f01256473bf'),
 '.github/workflows/tickets-release-operator-checks.yml': ('100644',
                                                           '019ec9b3ac73bec979d3ab62725a3d1208ca765f'),
 '.github/workflows/vps-runtime.yml': ('100644', '3041cf9b68ba250429e8f58e5404d10b2f9330a0'),
 'ops/vps/audit-readiness.py': ('100644', '69c7dff10fc2b8d1046b84e0a43dbdb4dacb3ecf'),
 'ops/vps/backup.mjs': ('100644', 'ca2c1a0fa1aa4cb075fa0b90d9d46218666c7967'),
 'ops/vps/becore-tickets-preview.service': ('100644', '889233505917ae749ee276050d7f9060c975ed4a'),
 'ops/vps/becore-tickets-retention.service': ('100644', '68f4ab992f05742a086f23af7983f9c5561b1b13'),
 'ops/vps/becore-tickets-retention.timer': ('100644', '7d77baf5059b0fc725976e8d4eceeb53a53ed2ff'),
 'ops/vps/candidate_build.py': ('100644', '502b3f8cddc2038113498824e430620eb1b55d0f'),
 'ops/vps/candidate_evidence.py': ('100644', 'd65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba'),
 'ops/vps/code-release.py': ('100644', 'd39435b192b4b38dfb097c4111a89b2703ca1148'),
 'ops/vps/initialize-preview.mjs': ('100644', '6171616a2d73ed536aad0896d3016d2d41a6ba95'),
 'ops/vps/install-preview.py': ('100644', '0fb837d72409234a074b2891c784f0f7605e600f'),
 'ops/vps/journal-limits.conf': ('100644', 'bd9c88d6d78144830b5d4ce26dce2d86825b84e5'),
 'ops/vps/parallel_candidate.py': ('100644', '08e44556ad630ee5227463b74bce990f943d939f'),
 'ops/vps/parallel_candidate_control.py': ('100644', '1000acb20a4e8b3a0d9c5771ea5269db006805a4'),
 'ops/vps/prepare-origin.py': ('100644', '8939073562dd7e73073f092a09c3c973003c6b63'),
 'ops/vps/public_runtime_guard.py': ('100644', '9a9739f1bd88cbd02dc420001efa3de5b85e3538'),
 'ops/vps/restore-backup.mjs': ('100644', '0a05f18c17205ef4c2f59e2d50bd06180035b8c6'),
 'ops/vps/retention.py': ('100644', '9ab0304f00d2a96fd6fbb8e4c992d96db5eb08a1'),
 'ops/vps/runtime_release.py': ('100644', '043e310a41ff28d23adc20383c88566b181232a6'),
 'ops/vps/test_audit_readiness.py': ('100644', '086ab0cb48aa88ce934daefb54d60486925d36f8'),
 'ops/vps/test_candidate_build.py': ('100644', 'a9920c4d21804074d4ab176c541247787b46639f'),
 'ops/vps/test_candidate_evidence.py': ('100644', 'f63544c3ea061f75db1f544c85cddaae109a0f4e'),
 'ops/vps/test_code_release.py': ('100644', '78e5b6aa4b9de23652566846f7dc7995a88c9ee7'),
 'ops/vps/test_parallel_admission.py': ('100644', '35b8fb438193184f8e1654d44981f6c3564d0ca0'),
 'ops/vps/test_parallel_candidate.py': ('100644', '3af28a1b01a08c19a97155229f6e0b5efc592fc0'),
 'ops/vps/test_parallel_candidate_control.py': ('100644', '6ddbd74138168c8538406920d9fda7432ce67f49'),
 'ops/vps/test_parallel_source_family.py': ('100644', '54ac92e721b51dda03bca69862816fa78d1c0737'),
 'ops/vps/test_pink_edition.py': ('100644', 'be26c898ac1e19f7f737dbe5112c5e40b6e90c68'),
 'ops/vps/test_public_runtime_guard.py': ('100644', 'eb1fd8a6909c7c0634326da1d35c7a4606fbebe7'),
 'ops/vps/test_release_approval.py': ('100644', '48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f'),
 'ops/vps/test_release_source.py': ('100644', 'ec8a7a5bbbe585941583f50624823b85ec51e586'),
 'ops/vps/test_retention.py': ('100644', 'f35d71212ec6ae521e3144c57e708297c513dce0'),
 'ops/vps/test_runtime_packaging.py': ('100644', '6f215f441ff1d9b92b3c870a6f438a54e5ccc1a1'),
 'ops/vps/test_runtime_release.py': ('100644', '210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14'),
 'ops/vps/test_runtime_workflow_contract.py': ('100644', 'eef0b25e667f6be123c0ed6c5bca774158d390d8'),
 'scripts/audit-checkbox-hotfix.py': ('100644', '5313d8cdc4076b36d434fe8017cc0e7b4824e876'),
 'scripts/audit-release-dependencies.py': ('100644', '47c7951e8db95ac666680bd2bf32fde3f1748c8e'),
 'scripts/audit-release-manifest.json': ('100644', 'bcb787e744f9fc5fc201e8068d553c1543b35b86'),
 'scripts/caption-source-manifest.json': ('100644', '1b178a1a371ae047f8bf26498d249e272c11497d'),
 'scripts/verify-audit-release-source.py': ('100644', '129d7bdbd2d631ad385a9edd7be4ea9895f173cf'),
 'scripts/verify-caption-source.py': ('100644', 'fa474c5d8cfaad8df53e77004c063e1511ed0b68'),
 'tests/test_audit_release_dependencies.py': ('100644', '6983998bf40fc1cb424e6dafbb7ba35e5653336d'),
 'tests/test_audit_release_source.py': ('100644', '6516f3f4b8582d3874ceda34e1fc3e3b799fec8d'),
 'tests/test_caption_source.py': ('100644', '6871fcc1ab410acaa74d8bd953ac9e0e61f4f670'),
 'tests/test_checkbox_hotfix_audit.py': ('100644', '421ec5fd992b1ba258e357ff4a65f6c3a647d2ce')}


def cinco_recovery_source_family(root):
    """Recognize only the complete recovery C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    selected = any(os.path.lexists(root / name) for name in release.CINCO_RECOVERY_ADVISORY_BLOBS)
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != CINCO_RECOVERY_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.CINCO_RECOVERY_ADVISORY_BASE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.CINCO_RECOVERY_ADVISORY_TREE):
                raise AssertionError('Recovery family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Recovery baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            for name, blob in release.CINCO_RECOVERY_ADVISORY_BLOBS.items():
                if manifest.get(name) != ('100644', blob):
                    raise AssertionError('Recovery advisory baseline changed')
            application = release.CINCO_RECOVERY_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Recovery application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked | untracked != set(manifest):
                raise AssertionError('Recovery full inventory differs from complete C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.CINCO_RECOVERY_CONTROL_FILES and mode != '100644')
                        or (name not in release.CINCO_RECOVERY_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Recovery index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Recovery family requires its independently pinned baseline') from exc
    else:
        manifest = dict(CINCO_RECOVERY_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', CINCO_RECOVERY_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Recovery family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Recovery family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Recovery family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Separate exact security-controls/UI test family; historical families stay frozen.
FLASHES_OPERATOR_BLOB = '302a5db1025bc8bd0a068a4eee097dbc940aada3'
FLASHES_STAGED_BASE = dict(CINCO_RECOVERY_STAGED_BASE)


def flashes_source_family(root):
    """Recognize only the complete Flashes C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    selected = any(os.path.lexists(root / name) for name in release.FLASHES_ADVISORY_BLOBS)
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != FLASHES_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.FLASHES_ADVISORY_BASE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.FLASHES_ADVISORY_TREE):
                raise AssertionError('Flashes family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Flashes baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            for name, blob in release.FLASHES_ADVISORY_BLOBS.items():
                if manifest.get(name) != ('100644', blob):
                    raise AssertionError('Flashes advisory baseline changed')
            manifest.update({name: ('100644', blob) for name, blob in release.FLASHES_SECURITY_BLOBS.items()})
            application = release.FLASHES_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Flashes application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked | untracked != set(manifest):
                raise AssertionError('Flashes full inventory differs from complete C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.FLASHES_CONTROL_FILES and mode != '100644')
                        or (name not in release.FLASHES_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Flashes index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Flashes family requires its independently pinned baseline') from exc
    else:
        manifest = dict(FLASHES_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', FLASHES_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Flashes family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Flashes family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Flashes family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Exact navigation C/P test family, independent of historical Flashes fixtures.
NAVIGATION_OPERATOR_BLOB = 'a4bcaa6045f6858179a96a1dbb67b9765e9eb1fd'
NAVIGATION_STAGED_BASE = dict(FLASHES_STAGED_BASE)


def navigation_source_family(root):
    """Recognize only the complete Navigation C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    selected = any(os.path.lexists(root / name) for name in release.NAVIGATION_APPLICATION_INPUTS
                   if release.NAVIGATION_APPLICATION_INPUTS[name] is None)
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != NAVIGATION_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.NAVIGATION_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.NAVIGATION_RELEASE_BASE_TREE):
                raise AssertionError('Navigation family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Navigation baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update({name: ('100644', blob)
                             for name, blob in release.NAVIGATION_PREREQUISITE_BLOBS.items()})
            application = release.NAVIGATION_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Navigation application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked | untracked != set(manifest):
                raise AssertionError('Navigation full inventory differs from complete C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.NAVIGATION_CONTROL_FILES and mode != '100644')
                        or (name not in release.NAVIGATION_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Navigation index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Navigation family requires its independently pinned baseline') from exc
    else:
        manifest = dict(NAVIGATION_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', NAVIGATION_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Navigation family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Navigation family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Navigation family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Exact filters/Room C/P test family, independent of historical Navigation fixtures.
FILTERS_ROOM_OPERATOR_BLOB = '78707a643af695ab0b2cce81c3d7808e4b15c6fa'
FILTERS_ROOM_STAGED_BASE = dict(NAVIGATION_STAGED_BASE)


def filters_room_source_family(root):
    """Recognize only the complete Filters/Room C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # Running this filters/Room test file selects its family even if an operator
    # is replaced by a historically valid operator with otherwise identical staging.
    selected = ((root / 'ops/vps/test_code_release.py').resolve() == Path(__file__).resolve()
                or any(os.path.lexists(root / name) for name in release.FILTERS_ROOM_APPLICATION_INPUTS
                       if release.FILTERS_ROOM_APPLICATION_INPUTS[name] is None))
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != FILTERS_ROOM_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.FILTERS_ROOM_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.FILTERS_ROOM_RELEASE_BASE_TREE):
                raise AssertionError('Filters/Room family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Filters/Room baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            application = release.FILTERS_ROOM_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Filters/Room application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Filters/Room full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.FILTERS_ROOM_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.FILTERS_ROOM_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Filters/Room index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Filters/Room family requires its independently pinned baseline') from exc
    else:
        manifest = dict(FILTERS_ROOM_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', FILTERS_ROOM_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Filters/Room family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Filters/Room family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Filters/Room family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Exact recovery/audit C/P test family; historical families remain independent.
RECOVERY_AUDIT_OPERATOR_BLOB = '4757b410b0ee0f545f7bf6ff4ad0fb43607f1384'
RECOVERY_AUDIT_STAGED_BASE = dict(FILTERS_ROOM_STAGED_BASE)
RECOVERY_AUDIT_TEST_FILE = Path(__file__).resolve()


def recovery_audit_source_family(root):
    """Recognize only the complete Recovery/audit C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == RECOVERY_AUDIT_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != RECOVERY_AUDIT_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.RECOVERY_AUDIT_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.RECOVERY_AUDIT_RELEASE_BASE_TREE):
                raise AssertionError('Recovery/audit family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Recovery/audit baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            application = release.RECOVERY_AUDIT_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Recovery/audit application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Recovery/audit full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.RECOVERY_AUDIT_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.RECOVERY_AUDIT_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Recovery/audit index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Recovery/audit family requires its independently pinned baseline') from exc
    else:
        manifest = dict(RECOVERY_AUDIT_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', RECOVERY_AUDIT_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Recovery/audit family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Recovery/audit family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Recovery/audit family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Exact integrated-experience C/P test family; historical families remain independent.
INTEGRATED_EXPERIENCE_OPERATOR_BLOB = 'bb4d5baf326bacd6f4eaa42b496ee96b6f974487'
INTEGRATED_EXPERIENCE_STAGED_BASE = dict(RECOVERY_AUDIT_STAGED_BASE)
INTEGRATED_EXPERIENCE_STAGED_BASE['.github/workflows/tickets-release-operator-checks.yml'] = (
    '100644', '33a7e8cc3e38dc6f58f10113dd12f1c7c3042ce1')
INTEGRATED_EXPERIENCE_TEST_FILE = Path(__file__).resolve()


def integrated_experience_source_family(root):
    """Recognize only the complete Integrated experience C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == INTEGRATED_EXPERIENCE_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != INTEGRATED_EXPERIENCE_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.INTEGRATED_EXPERIENCE_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.INTEGRATED_EXPERIENCE_RELEASE_BASE_TREE):
                raise AssertionError('Integrated experience family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Integrated experience baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update({name: ('100644', blob)
                             for name, blob in release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS.items()})
            application = release.INTEGRATED_EXPERIENCE_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Integrated experience application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Integrated experience full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.INTEGRATED_EXPERIENCE_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.INTEGRATED_EXPERIENCE_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Integrated experience index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Integrated experience family requires its independently pinned baseline') from exc
    else:
        manifest = dict(INTEGRATED_EXPERIENCE_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', INTEGRATED_EXPERIENCE_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Integrated experience family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Integrated experience family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Integrated experience family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Exact camera looks C/P test family; historical families remain independent.
CAMERA_LOOKS_OPERATOR_BLOB = '04fbca9db63458859cf3b49bb4504e916cbda58e'
CAMERA_LOOKS_STAGED_BASE = dict(INTEGRATED_EXPERIENCE_STAGED_BASE)
CAMERA_LOOKS_TEST_FILE = Path(__file__).resolve()


def camera_looks_source_family(root):
    """Recognize only the complete Camera looks C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == CAMERA_LOOKS_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != CAMERA_LOOKS_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.CAMERA_LOOKS_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.CAMERA_LOOKS_RELEASE_BASE_TREE):
                raise AssertionError('Camera looks family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Camera looks baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update({name: ('100644', blob)
                             for name, blob in release.CAMERA_LOOKS_PREREQUISITE_BLOBS.items()})
            application = release.CAMERA_LOOKS_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Camera looks application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Camera looks full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.CAMERA_LOOKS_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.CAMERA_LOOKS_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Camera looks index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Camera looks family requires its independently pinned baseline') from exc
    else:
        manifest = dict(CAMERA_LOOKS_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', CAMERA_LOOKS_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Camera looks family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Camera looks family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Camera looks family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Exact first-host receipt C/P test family; historical families remain independent.
FIRST_HOST_OPERATOR_BLOB = '22d216793a884fc3112fd9b14e7aab3af83789a9'
FIRST_HOST_STAGED_BASE = dict(CAMERA_LOOKS_STAGED_BASE)
FIRST_HOST_STAGED_BASE[".github/workflows/tickets-code-release.yml"] = ("100644", "9326b937cfb42f3056c5187e498563c63720c392")
FIRST_HOST_TEST_FILE = Path(__file__).resolve()


def first_host_source_family(root):
    """Recognize only the complete First host C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == FIRST_HOST_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != FIRST_HOST_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.FIRST_HOST_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.FIRST_HOST_RELEASE_BASE_TREE):
                raise AssertionError('First host family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('First host baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update({name: ('100644', blob) for name, blob in release.FIRST_HOST_PREREQUISITE_BLOBS.items()})
            application = release.FIRST_HOST_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('First host application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('First host full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.FIRST_HOST_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.FIRST_HOST_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('First host index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('First host family requires its independently pinned baseline') from exc
    else:
        manifest = dict(FIRST_HOST_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', FIRST_HOST_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('First host family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('First host family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('First host family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}




ROOM_MAIL_FOCUS_OPERATOR_BLOB = 'acc19beab52aaec58e9de12c33a2c6ca7be39ca5'
ROOM_MAIL_FOCUS_STAGED_BASE = dict(FIRST_HOST_STAGED_BASE)
ROOM_MAIL_FOCUS_STAGED_BASE['ops/vps/recover-puro-first-host-20261024.py'] = ("100644", 'e4d2fecee02ad2b24304beec755f1b161ad6b4b0')
ROOM_MAIL_FOCUS_STAGED_BASE['ops/vps/test_first_host_recovery.py'] = ("100644", '66c7234648a239e66df42dfa9093d0b5eab97c13')
ROOM_MAIL_FOCUS_TEST_FILE = Path(__file__).resolve()

def room_mail_focus_source_family(root):
    """Recognize only the complete Room/mail focus C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == ROOM_MAIL_FOCUS_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != ROOM_MAIL_FOCUS_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.ROOM_MAIL_FOCUS_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.ROOM_MAIL_FOCUS_RELEASE_BASE_TREE):
                raise AssertionError('Room/mail focus family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Room/mail focus baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update({name: ('100644', blob) for name, blob in release.ROOM_MAIL_FOCUS_PREREQUISITE_BLOBS.items()})
            application = release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Room/mail focus application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Room/mail focus full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.ROOM_MAIL_FOCUS_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.ROOM_MAIL_FOCUS_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Room/mail focus index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Room/mail focus family requires its independently pinned baseline') from exc
    else:
        manifest = dict(ROOM_MAIL_FOCUS_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', ROOM_MAIL_FOCUS_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Room/mail focus family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Room/mail focus family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Room/mail focus family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}




ROOM_MAIL_VPS_OPERATOR_BLOB = '3ce9952c547073a76b5bfb43a8996d1c9c65af1e'
ROOM_MAIL_VPS_STAGED_BASE = dict(ROOM_MAIL_FOCUS_STAGED_BASE)
ROOM_MAIL_VPS_STAGED_BASE['ops/email/mailer.py'] = ("100644", 'fc99c522457e487837e276d5acdd31b2cce2fcd0')
ROOM_MAIL_VPS_STAGED_BASE['ops/vps/inspect-bounce-codes-readonly.py'] = ("100644", '6e344e7047c9897047c9dffda27e0f699d25e893')
ROOM_MAIL_VPS_STAGED_BASE['ops/vps/inspect-mail-service-readonly.py'] = ("100644", '819baa97ef82c687c52ed288daf49db6486f0a21')
ROOM_MAIL_VPS_STAGED_BASE['ops/vps/test_bounce_codes_readonly.py'] = ("100644", '6d105f85df2362711ab5b128592d3d3a18342d02')
ROOM_MAIL_VPS_STAGED_BASE['ops/vps/test_mail_service_readonly.py'] = ("100644", 'f02a6d1e30d0dfe464af9d3d4ade87726e67eb94')
ROOM_MAIL_VPS_STAGED_BASE['ops/vps/test_mail_upgrade.py'] = ("100644", '56067f377765b39d5ec7b6029e42fc9ec3bd146e')
ROOM_MAIL_VPS_STAGED_BASE['ops/vps/upgrade-room-mail.py'] = ("100644", '0f8b77d5bf2ed3df86a17475923cd1ea5a0d1358')
ROOM_MAIL_VPS_STAGED_BASE['.github/workflows/tickets-release-operator-checks.yml'] = ('100644', 'a0099e4403e2f7f84e1ee5651899cdbe1823866b')
ROOM_MAIL_VPS_STAGED_BASE['.github/workflows/tickets-code-release.yml'] = ('100644', '8e516ab2b92cf9c9fdb59cf3ef802f23fc2b5879')
# Test-only main-branch overlay; deployment admission remains pinned to C/P.
ROOM_MAIL_VPS_TRANSPORT_OVERLAY = {
    '.github/workflows/tickets-room-helper-transport.yml': ('100644', 'eb6275216ab5c32e47862977d451bbd4da4d18a2'),
    'tests/test_room_helper_transport.py': ('100644', 'a7c2934eaf8313812664f94b15a2323d4059ad6c'),
}
# Exact test-only overlay for reviewed Node build pins; production admission,
# historical families, permissions and runtime behavior remain unchanged.
NODE_SECURITY_TEST_OVERLAY = {'scripts/prepare-registration-browser-fixture.mjs': ('100644', '5d49aebfee687434c862995af02e644e21bf419f'),
 'tests/e2e/host-profile.spec.ts': ('100644', 'c2639565bdafaa37beb2633e6432a95a81cabe1f'),
 'tests/test_room_helper_transport.py': ('100644', '1c68e111f7f33f9f1e4af78973a49f5424acfccf'),
 '.github/workflows/android-release.yml': ('100644', 'ff22317244e60ff2a14b1f5144d26763cd718e97'),
 '.github/workflows/booking-consent-previews.yml': ('100644', '5ebf94ff4d93e263bb8c43f2c1074dc785bd3bc5'),
 '.github/workflows/browser-audit.yml': ('100644', '5da482ecf6c528672b4eb8cd1db13b09eee5ac34'),
 '.github/workflows/browser-followup.yml': ('100644', '3ccfe2fbf5eef9d453d69db33971d6df35f846f3'),
 '.github/workflows/candidate-checks.yml': ('100644', 'c45d7dae42734fbbc8919435c16473115bf8f06c'),
 '.github/workflows/candidate-parallel-checks.yml': ('100644', '19c44c8a0f569c1ae4ebf4e694987946fded2fd0'),
 '.github/workflows/cinco-confirmation-release-20261019.yml': ('100644', '74de2fb8f81cd6b307726f2a3999ad1189a2656f'),
 '.github/workflows/customer-email-previews.yml': ('100644', '80f0f8c13b1849701aa6dcab4275904fbeef2732'),
 '.github/workflows/d1-recovery-rehearsal.yml': ('100644', '9dad97c137e0c3796513f57d2c2681e1d4af7d5e'),
 '.github/workflows/dependency-security.yml': ('100644', '6007258c74d03c80bb4610640e15f1479740d856'),
 '.github/workflows/deploy.yml': ('100644', 'b18eb81d65fd5a93fabebe7ae98c6cf99067076e'),
 '.github/workflows/event-capacity.yml': ('100644', '50f9ec58b466ba4b679da8acf891016e68c43579'),
 '.github/workflows/fallback-infrastructure.yml': ('100644', 'd958b6fa9e7764917791ef3093db657ce15985ca'),
 '.github/workflows/full-audit-capacity.yml': ('100644', '507041f4c51a58f32820adf4d0fccc3a67627cc4'),
 '.github/workflows/handover-preflight.yml': ('100644', 'a26ce0eaad2984caf9a137b2ea33c64a7595cbf1'),
 '.github/workflows/handover-return-diagnose.yml': ('100644', 'a2114b798f788379deed067a8ca531420119df20'),
 '.github/workflows/handover-return-prepare.yml': ('100644', '4cfcb4543d405f61f37d917b6c8baeb373d2eb24'),
 '.github/workflows/handover-return-verify.yml': ('100644', '2077acba8c886bfc1ed92ad9afd0ca02cba1a964'),
 '.github/workflows/handover-tools.yml': ('100644', 'e68a712931374eb7bdd318bb631469d3011f6b22'),
 '.github/workflows/hosted-capacity.yml': ('100644', '1ba1ce79dfcffe1bd78d367197d385f9ae57a3a6'),
 '.github/workflows/input-modality-checks.yml': ('100644', '0b3f912c08daf5fc9fe6eb626c16b8b4f0467c58'),
 '.github/workflows/ios-release.yml': ('100644', '45b6e424d350e0a7a991d95ad61fffc8667c0774'),
 '.github/workflows/iphone-layouts.yml': ('100644', 'b596a2b98a2c174523de26c2757f0af6585d0094'),
 '.github/workflows/marketing-connection.yml': ('100644', '06dd5680dc6790d6464636d3e6436caff67f9f77'),
 '.github/workflows/native-apps.yml': ('100644', 'd95f31938c1dbb0ce8e6818a3ceb7eecd0852fac'),
 '.github/workflows/preview-data-inventory.yml': ('100644', '300d1707f12bb4c8c71be0dab813d140b0b6334d'),
 '.github/workflows/puro-access-release-20261019.yml': ('100644', 'bbb319a7598fbce4cd99d3344b37893f75a3e5bf'),
 '.github/workflows/tickets-code-release.yml': ('100644', '45ba3acf065c330da75f67d1f39d98e1fe300ce9'),
 '.github/workflows/tickets-room-helper-transport.yml': ('100644', '216b30db72dff72c66fdfaea7fa123cf1ccd4a23'),
 '.github/workflows/vps-runtime.yml': ('100644', '06bdc48477eb0977ed471e549630bd6070758a95'),
 'ops/vps/test_first_host_recovery.py': ('100644', '9f9579d7ffa30b54249a5126b85f60032c9f7d05'),
 'ops/vps/test_runtime_workflow_contract.py': ('100644', 'c9620eeb200133ee94c76accc5328ecce28b4b75')}

def historical_node_workflow(name, raw):
    raw = parallel_gate_historical_workflow(name, raw)
    expected = NODE_SECURITY_TEST_OVERLAY.get(name)
    digest = lambda value: release.hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
    # Exact combined Yorkeway transport only. Never normalize candidate-chosen
    # mutations, duplicate transfers, permissions, commands or partial Node pins.
    if name == '.github/workflows/tickets-code-release.yml' and digest(raw) == '227200c0e27f4c0d207ebacc66083bb44b8afc44':
        helper = b'''          tailscale ssh root@hermes "umask 022; cat > '$stage/inspect-mail-service-readonly.py'" < "$RUNNER_TEMP/tickets-operator/ops/vps/inspect-mail-service-readonly.py"\n'''
        raw = raw.replace(helper, b'', 1)
    if expected and digest(raw) == expected[1]:
        return raw.replace(b'node-version: 24.22.1\n', b'node-version: 24.21.0\n').replace(
            b'node-version: 22.23.4\n', b'node-version: 22\n')
    return raw

ROOM_MAIL_VPS_TEST_FILE = Path(__file__).resolve()

def room_mail_vps_source_family(root):
    """Recognize only the complete Room VPS mail C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == ROOM_MAIL_VPS_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != ROOM_MAIL_VPS_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    # Bind to the actual reviewed baseline, never choose policy from candidate bytes.
    # Synthetic historical fixtures replace the baseline and retain their own pins.
    node_security = (release.ROOM_MAIL_VPS_RELEASE_BASELINE == '885bd1b2d97ff687fe884c86314ae9b368d4abff'
                     and release.ROOM_MAIL_VPS_RELEASE_BASE_TREE == '187c9e53e052cc70062065ed7388f7786a17b9ca'
                     and ROOM_MAIL_VPS_OPERATOR_BLOB == '3ce9952c547073a76b5bfb43a8996d1c9c65af1e')
    if full:
        try:
            baseline = release.ROOM_MAIL_VPS_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.ROOM_MAIL_VPS_RELEASE_BASE_TREE):
                raise AssertionError('Room VPS mail family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Room VPS mail baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update({name: ('100644', blob) for name, blob in release.ROOM_MAIL_VPS_PREREQUISITE_BLOBS.items()})
            manifest.update({name: ('100644', blob) for name, blob in release.ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS.items()})
            application = release.ROOM_MAIL_VPS_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Room VPS mail application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            # Accept only the complete independently pinned transport pair.
            # Existing index, mode and byte checks below validate both additions.
            if tracked & ROOM_MAIL_VPS_TRANSPORT_OVERLAY.keys():
                manifest.update(ROOM_MAIL_VPS_TRANSPORT_OVERLAY)
            if node_security:
                manifest.update(NODE_SECURITY_TEST_OVERLAY)
            if tracked != set(manifest) or untracked:
                raise AssertionError('Room VPS mail full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.ROOM_MAIL_VPS_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.ROOM_MAIL_VPS_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Room VPS mail index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Room VPS mail family requires its independently pinned baseline') from exc
    else:
        manifest = dict(ROOM_MAIL_VPS_STAGED_BASE)
        if node_security:
            manifest.update({name: item for name, item in NODE_SECURITY_TEST_OVERLAY.items() if name in manifest})
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', ROOM_MAIL_VPS_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Room VPS mail family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Room VPS mail family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Room VPS mail family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Complete Yorkeway C/P test inventory; independent production admission is
# defined in code-release.py. Only this executing test file cannot self-pin.
YORKEWAY_OPERATOR_BLOB = '62ed438a1ca9f7229a57fbc48228fa22f51068e7'
YORKEWAY_STAGED_BASE = {'.github/scripts/verify-audit-control.py': ('100644', '87cd21e095c76efc9e607484b8c0836db9bc58b5'),
 '.github/scripts/verify-caption-control.py': ('100644', '19366f37243794bba916dd6cff0b7731aaec8f1c'),
 '.github/workflows/candidate-checks.yml': ('100644', 'c45d7dae42734fbbc8919435c16473115bf8f06c'),
 '.github/workflows/candidate-parallel-checks.yml': ('100644',
                                                     '19c44c8a0f569c1ae4ebf4e694987946fded2fd0'),
 '.github/workflows/deploy.yml': ('100644', 'b18eb81d65fd5a93fabebe7ae98c6cf99067076e'),
 '.github/workflows/tickets-code-release.yml': ('100644', '227200c0e27f4c0d207ebacc66083bb44b8afc44'),
 '.github/workflows/tickets-release-operator-checks.yml': ('100644',
                                                           'a0099e4403e2f7f84e1ee5651899cdbe1823866b'),
 '.github/workflows/vps-runtime.yml': ('100644', '06bdc48477eb0977ed471e549630bd6070758a95'),
 'ops/email/mailer.py': ('100644', 'fc99c522457e487837e276d5acdd31b2cce2fcd0'),
 'ops/vps/audit-readiness.py': ('100644', '2cc3374dade0210e76b386ce7387cd51fdc02f05'),
 'ops/vps/backup.mjs': ('100644', 'ca2c1a0fa1aa4cb075fa0b90d9d46218666c7967'),
 'ops/vps/becore-tickets-preview.service': ('100644', '889233505917ae749ee276050d7f9060c975ed4a'),
 'ops/vps/becore-tickets-retention.service': ('100644', '68f4ab992f05742a086f23af7983f9c5561b1b13'),
 'ops/vps/becore-tickets-retention.timer': ('100644', '7d77baf5059b0fc725976e8d4eceeb53a53ed2ff'),
 'ops/vps/candidate_build.py': ('100644', '502b3f8cddc2038113498824e430620eb1b55d0f'),
 'ops/vps/candidate_evidence.py': ('100644', 'd65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba'),
 'ops/vps/code-release.py': ('100644', '3ce9952c547073a76b5bfb43a8996d1c9c65af1e'),
 'ops/vps/initialize-preview.mjs': ('100644', '6171616a2d73ed536aad0896d3016d2d41a6ba95'),
 'ops/vps/inspect-bounce-codes-readonly.py': ('100644', '6e344e7047c9897047c9dffda27e0f699d25e893'),
 'ops/vps/inspect-mail-service-readonly.py': ('100644', '819baa97ef82c687c52ed288daf49db6486f0a21'),
 'ops/vps/install-preview.py': ('100644', '0fb837d72409234a074b2891c784f0f7605e600f'),
 'ops/vps/journal-limits.conf': ('100644', 'bd9c88d6d78144830b5d4ce26dce2d86825b84e5'),
 'ops/vps/parallel_candidate.py': ('100644', '08e44556ad630ee5227463b74bce990f943d939f'),
 'ops/vps/parallel_candidate_control.py': ('100644', '1000acb20a4e8b3a0d9c5771ea5269db006805a4'),
 'ops/vps/prepare-origin.py': ('100644', '8939073562dd7e73073f092a09c3c973003c6b63'),
 'ops/vps/public_runtime_guard.py': ('100644', '9a9739f1bd88cbd02dc420001efa3de5b85e3538'),
 'ops/vps/recover-puro-first-host-20261024.py': ('100644', 'e4d2fecee02ad2b24304beec755f1b161ad6b4b0'),
 'ops/vps/restore-backup.mjs': ('100644', '0a05f18c17205ef4c2f59e2d50bd06180035b8c6'),
 'ops/vps/retention.py': ('100644', '9ab0304f00d2a96fd6fbb8e4c992d96db5eb08a1'),
 'ops/vps/runtime_release.py': ('100644', '043e310a41ff28d23adc20383c88566b181232a6'),
 'ops/vps/test_audit_readiness.py': ('100644', '7a431017c03e99ad0b358b17399b1313cd935606'),
 'ops/vps/test_bounce_codes_readonly.py': ('100644', '6d105f85df2362711ab5b128592d3d3a18342d02'),
 'ops/vps/test_candidate_build.py': ('100644', 'a9920c4d21804074d4ab176c541247787b46639f'),
 'ops/vps/test_candidate_evidence.py': ('100644', 'f63544c3ea061f75db1f544c85cddaae109a0f4e'),
 'ops/vps/test_code_release.py': ('100644', 'bbddb86fdd88a72bea8198604e79db82286ef638'),
 'ops/vps/test_first_host_recovery.py': ('100644', '9f9579d7ffa30b54249a5126b85f60032c9f7d05'),
 'ops/vps/test_mail_service_readonly.py': ('100644', 'f02a6d1e30d0dfe464af9d3d4ade87726e67eb94'),
 'ops/vps/test_mail_upgrade.py': ('100644', '56067f377765b39d5ec7b6029e42fc9ec3bd146e'),
 'ops/vps/test_parallel_admission.py': ('100644', '35b8fb438193184f8e1654d44981f6c3564d0ca0'),
 'ops/vps/test_parallel_candidate.py': ('100644', '3af28a1b01a08c19a97155229f6e0b5efc592fc0'),
 'ops/vps/test_parallel_candidate_control.py': ('100644', '6ddbd74138168c8538406920d9fda7432ce67f49'),
 'ops/vps/test_parallel_source_family.py': ('100644', '54ac92e721b51dda03bca69862816fa78d1c0737'),
 'ops/vps/test_pink_edition.py': ('100644', 'be26c898ac1e19f7f737dbe5112c5e40b6e90c68'),
 'ops/vps/test_public_runtime_guard.py': ('100644', 'eb1fd8a6909c7c0634326da1d35c7a4606fbebe7'),
 'ops/vps/test_release_approval.py': ('100644', '48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f'),
 'ops/vps/test_release_source.py': ('100644', 'ec8a7a5bbbe585941583f50624823b85ec51e586'),
 'ops/vps/test_retention.py': ('100644', 'f35d71212ec6ae521e3144c57e708297c513dce0'),
 'ops/vps/test_runtime_packaging.py': ('100644', '6f215f441ff1d9b92b3c870a6f438a54e5ccc1a1'),
 'ops/vps/test_runtime_release.py': ('100644', '210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14'),
 'ops/vps/test_runtime_workflow_contract.py': ('100644', 'c9620eeb200133ee94c76accc5328ecce28b4b75'),
 'ops/vps/test_yorkeway_release.py': ('100644', '79548763aa68c226943f3f20908f754154e0e196'),
 'ops/vps/upgrade-room-mail.py': ('100644', '0f8b77d5bf2ed3df86a17475923cd1ea5a0d1358'),
 'scripts/audit-checkbox-hotfix.py': ('100644', '5313d8cdc4076b36d434fe8017cc0e7b4824e876'),
 'scripts/audit-release-dependencies.py': ('100644', '47c7951e8db95ac666680bd2bf32fde3f1748c8e'),
 'scripts/audit-release-manifest.json': ('100644', 'bcb787e744f9fc5fc201e8068d553c1543b35b86'),
 'scripts/caption-source-manifest.json': ('100644', '1b178a1a371ae047f8bf26498d249e272c11497d'),
 'scripts/verify-audit-release-source.py': ('100644', '129d7bdbd2d631ad385a9edd7be4ea9895f173cf'),
 'scripts/verify-caption-source.py': ('100644', 'fa474c5d8cfaad8df53e77004c063e1511ed0b68'),
 'tests/test_audit_release_dependencies.py': ('100644', '6983998bf40fc1cb424e6dafbb7ba35e5653336d'),
 'tests/test_audit_release_source.py': ('100644', '6516f3f4b8582d3874ceda34e1fc3e3b799fec8d'),
 'tests/test_caption_source.py': ('100644', '6871fcc1ab410acaa74d8bd953ac9e0e61f4f670'),
 'tests/test_checkbox_hotfix_audit.py': ('100644', '421ec5fd992b1ba258e357ff4a65f6c3a647d2ce')}
YORKEWAY_TEST_FILE = Path(__file__).resolve()

def yorkeway_source_family(root):
    """Recognize only the complete Yorkeway C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == YORKEWAY_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != YORKEWAY_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.YORKEWAY_MAIN_SNAPSHOT
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.YORKEWAY_MAIN_TREE):
                raise AssertionError('Yorkeway family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Yorkeway baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update({name: ('100644', blob) for name, blob in release.YORKEWAY_CONTROL_BLOBS.items()})
            application = release.YORKEWAY_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Yorkeway application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Yorkeway full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.YORKEWAY_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.YORKEWAY_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Yorkeway index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Yorkeway family requires its independently pinned baseline') from exc
    else:
        manifest = dict(YORKEWAY_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', YORKEWAY_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Yorkeway family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Yorkeway family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Yorkeway family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


OWNER_PUSH_OPERATOR_BLOB = '1cb80310e216ed7991c4f6a98cad0f5fa8eb7444'
OWNER_PUSH_TEST_BLOB = '3b98c6e268f21c8eea74928e63034095e6f2d97e'
OWNER_PUSH_STAGED_BASE = {'.github/scripts/verify-audit-control.py': ('100644',
                                             '87cd21e095c76efc9e607484b8c0836db9bc58b5'),
 '.github/scripts/verify-caption-control.py': ('100644',
                                               '19366f37243794bba916dd6cff0b7731aaec8f1c'),
 '.github/workflows/candidate-checks.yml': ('100644',
                                            'c45d7dae42734fbbc8919435c16473115bf8f06c'),
 '.github/workflows/candidate-parallel-checks.yml': ('100644',
                                                     '19c44c8a0f569c1ae4ebf4e694987946fded2fd0'),
 '.github/workflows/deploy.yml': ('100644',
                                  'b18eb81d65fd5a93fabebe7ae98c6cf99067076e'),
 '.github/workflows/tickets-code-release.yml': ('100644',
                                                '227200c0e27f4c0d207ebacc66083bb44b8afc44'),
 '.github/workflows/tickets-release-operator-checks.yml': ('100644',
                                                           'a0099e4403e2f7f84e1ee5651899cdbe1823866b'),
 '.github/workflows/vps-runtime.yml': ('100644',
                                       '06bdc48477eb0977ed471e549630bd6070758a95'),
 'ops/email/mailer.py': ('100644', 'e5abf1bda64ea8b3b6829df09eed22bf81ac78bb'),
 'ops/vps/audit-readiness.py': ('100644',
                                '2cc3374dade0210e76b386ce7387cd51fdc02f05'),
 'ops/vps/backup.mjs': ('100644', 'ca2c1a0fa1aa4cb075fa0b90d9d46218666c7967'),
 'ops/vps/becore-tickets-preview.service': ('100644',
                                            '889233505917ae749ee276050d7f9060c975ed4a'),
 'ops/vps/becore-tickets-retention.service': ('100644',
                                              '68f4ab992f05742a086f23af7983f9c5561b1b13'),
 'ops/vps/becore-tickets-retention.timer': ('100644',
                                            '7d77baf5059b0fc725976e8d4eceeb53a53ed2ff'),
 'ops/vps/candidate_build.py': ('100644',
                                '502b3f8cddc2038113498824e430620eb1b55d0f'),
 'ops/vps/candidate_evidence.py': ('100644',
                                   'd65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba'),
 'ops/vps/code-release.py': ('100644',
                             '62ed438a1ca9f7229a57fbc48228fa22f51068e7'),
 'ops/vps/initialize-preview.mjs': ('100644',
                                    '6171616a2d73ed536aad0896d3016d2d41a6ba95'),
 'ops/vps/inspect-bounce-codes-readonly.py': ('100644',
                                              '6e344e7047c9897047c9dffda27e0f699d25e893'),
 'ops/vps/inspect-mail-service-readonly.py': ('100644',
                                              '819baa97ef82c687c52ed288daf49db6486f0a21'),
 'ops/vps/install-preview.py': ('100644',
                                '0fb837d72409234a074b2891c784f0f7605e600f'),
 'ops/vps/journal-limits.conf': ('100644',
                                 'bd9c88d6d78144830b5d4ce26dce2d86825b84e5'),
 'ops/vps/parallel_candidate.py': ('100644',
                                   '08e44556ad630ee5227463b74bce990f943d939f'),
 'ops/vps/parallel_candidate_control.py': ('100644',
                                           '1000acb20a4e8b3a0d9c5771ea5269db006805a4'),
 'ops/vps/prepare-origin.py': ('100644',
                               '8939073562dd7e73073f092a09c3c973003c6b63'),
 'ops/vps/public_runtime_guard.py': ('100644',
                                     '9a9739f1bd88cbd02dc420001efa3de5b85e3538'),
 'ops/vps/recover-puro-first-host-20261024.py': ('100644',
                                                 'e4d2fecee02ad2b24304beec755f1b161ad6b4b0'),
 'ops/vps/restore-backup.mjs': ('100644',
                                '0a05f18c17205ef4c2f59e2d50bd06180035b8c6'),
 'ops/vps/retention.py': ('100644', '9ab0304f00d2a96fd6fbb8e4c992d96db5eb08a1'),
 'ops/vps/runtime_release.py': ('100644',
                                '043e310a41ff28d23adc20383c88566b181232a6'),
 'ops/vps/test_audit_readiness.py': ('100644',
                                     '7a431017c03e99ad0b358b17399b1313cd935606'),
 'ops/vps/test_bounce_codes_readonly.py': ('100644',
                                           '6d105f85df2362711ab5b128592d3d3a18342d02'),
 'ops/vps/test_candidate_build.py': ('100644',
                                     'a9920c4d21804074d4ab176c541247787b46639f'),
 'ops/vps/test_candidate_evidence.py': ('100644',
                                        'f63544c3ea061f75db1f544c85cddaae109a0f4e'),
 'ops/vps/test_code_release.py': ('100644',
                                  '952c1a101b07813489d20b86578689a388a99eeb'),
 'ops/vps/test_first_host_recovery.py': ('100644',
                                         '9f9579d7ffa30b54249a5126b85f60032c9f7d05'),
 'ops/vps/test_mail_service_readonly.py': ('100644',
                                           'f02a6d1e30d0dfe464af9d3d4ade87726e67eb94'),
 'ops/vps/test_mail_upgrade.py': ('100644',
                                  'bed5cdca2491fe06345044f395721d82b09029e0'),
 'ops/vps/test_parallel_admission.py': ('100644',
                                        '35b8fb438193184f8e1654d44981f6c3564d0ca0'),
 'ops/vps/test_parallel_candidate.py': ('100644',
                                        '3af28a1b01a08c19a97155229f6e0b5efc592fc0'),
 'ops/vps/test_parallel_candidate_control.py': ('100644',
                                                '6ddbd74138168c8538406920d9fda7432ce67f49'),
 'ops/vps/test_parallel_source_family.py': ('100644',
                                            '54ac92e721b51dda03bca69862816fa78d1c0737'),
 'ops/vps/test_pink_edition.py': ('100644',
                                  'be26c898ac1e19f7f737dbe5112c5e40b6e90c68'),
 'ops/vps/test_public_runtime_guard.py': ('100644',
                                          'eb1fd8a6909c7c0634326da1d35c7a4606fbebe7'),
 'ops/vps/test_release_approval.py': ('100644',
                                      '48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f'),
 'ops/vps/test_release_source.py': ('100644',
                                    'ec8a7a5bbbe585941583f50624823b85ec51e586'),
 'ops/vps/test_retention.py': ('100644',
                               'f35d71212ec6ae521e3144c57e708297c513dce0'),
 'ops/vps/test_runtime_packaging.py': ('100644',
                                       '6f215f441ff1d9b92b3c870a6f438a54e5ccc1a1'),
 'ops/vps/test_runtime_release.py': ('100644',
                                     '210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14'),
 'ops/vps/test_runtime_workflow_contract.py': ('100644',
                                               'c9620eeb200133ee94c76accc5328ecce28b4b75'),
 'ops/vps/test_yorkeway_mail_upgrade.py': ('100644',
                                           'e3cfbdcb713204e0c71c13ff40fb3d4eb3bf5c89'),
 'ops/vps/test_yorkeway_release.py': ('100644',
                                      '3b98c6e268f21c8eea74928e63034095e6f2d97e'),
 'ops/vps/upgrade-room-mail.py': ('100644',
                                  '0f8b77d5bf2ed3df86a17475923cd1ea5a0d1358'),
 'ops/vps/upgrade-yorkeway-mail.py': ('100644',
                                      '9c3fc4896f10e25eb61b7937eea2035b0757ad4f'),
 'scripts/audit-checkbox-hotfix.py': ('100644',
                                      '5313d8cdc4076b36d434fe8017cc0e7b4824e876'),
 'scripts/audit-release-dependencies.py': ('100644',
                                           '47c7951e8db95ac666680bd2bf32fde3f1748c8e'),
 'scripts/audit-release-manifest.json': ('100644',
                                         'bcb787e744f9fc5fc201e8068d553c1543b35b86'),
 'scripts/caption-source-manifest.json': ('100644',
                                          '1b178a1a371ae047f8bf26498d249e272c11497d'),
 'scripts/verify-audit-release-source.py': ('100644',
                                            '129d7bdbd2d631ad385a9edd7be4ea9895f173cf'),
 'scripts/verify-caption-source.py': ('100644',
                                      'fa474c5d8cfaad8df53e77004c063e1511ed0b68'),
 'tests/test_audit_release_dependencies.py': ('100644',
                                              '6983998bf40fc1cb424e6dafbb7ba35e5653336d'),
 'tests/test_audit_release_source.py': ('100644',
                                        '6516f3f4b8582d3874ceda34e1fc3e3b799fec8d'),
 'tests/test_caption_source.py': ('100644',
                                  '6871fcc1ab410acaa74d8bd953ac9e0e61f4f670'),
 'tests/test_checkbox_hotfix_audit.py': ('100644',
                                         '421ec5fd992b1ba258e357ff4a65f6c3a647d2ce')}
OWNER_PUSH_TEST_FILE = Path(__file__).resolve()

def owner_push_source_family(root):
    """Recognize only the complete Owner push C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == OWNER_PUSH_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != OWNER_PUSH_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.OWNER_PUSH_RELEASE_BASELINE
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.OWNER_PUSH_BASE_TREE):
                raise AssertionError('Owner push family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Owner push baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest['ops/vps/test_yorkeway_release.py'] = ('100644', OWNER_PUSH_TEST_BLOB)
            manifest.update({name: ('100644', blob) for name, blob in release.OWNER_PUSH_PREREQUISITE_BLOBS.items()})
            application = release.OWNER_PUSH_APPLICATION_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Owner push application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Owner push full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.OWNER_PUSH_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.OWNER_PUSH_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Owner push index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Owner push family requires its independently pinned baseline') from exc
    else:
        manifest = dict(OWNER_PUSH_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', OWNER_PUSH_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    manifest['ops/vps/test_yorkeway_release.py'] = ('100644', OWNER_PUSH_TEST_BLOB)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Owner push family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Owner push family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Owner push family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


SECURITY_OPERATOR_BLOB = '695dced2a5a013acc617bcf87c6d56e7cb33ceab'
SECURITY_TEST_BLOB = '69521792dfce290e85c70120fbe11bca8353b1f4'
SECURITY_STAGED_BASE = {'.github/scripts/verify-audit-control.py': ('100644',
                                             '87cd21e095c76efc9e607484b8c0836db9bc58b5'),
 '.github/scripts/verify-caption-control.py': ('100644',
                                               '19366f37243794bba916dd6cff0b7731aaec8f1c'),
 '.github/workflows/candidate-checks.yml': ('100644',
                                            'c45d7dae42734fbbc8919435c16473115bf8f06c'),
 '.github/workflows/candidate-parallel-checks.yml': ('100644',
                                                     '19c44c8a0f569c1ae4ebf4e694987946fded2fd0'),
 '.github/workflows/deploy.yml': ('100644',
                                  'b18eb81d65fd5a93fabebe7ae98c6cf99067076e'),
 '.github/workflows/tickets-code-release.yml': ('100644',
                                                '227200c0e27f4c0d207ebacc66083bb44b8afc44'),
 '.github/workflows/tickets-release-operator-checks.yml': ('100644',
                                                           'a0099e4403e2f7f84e1ee5651899cdbe1823866b'),
 '.github/workflows/vps-runtime.yml': ('100644',
                                       '06bdc48477eb0977ed471e549630bd6070758a95'),
 'ops/email/mailer.py': ('100644', 'e5abf1bda64ea8b3b6829df09eed22bf81ac78bb'),
 'ops/vps/audit-readiness.py': ('100644',
                                '2cc3374dade0210e76b386ce7387cd51fdc02f05'),
 'ops/vps/backup.mjs': ('100644', 'ca2c1a0fa1aa4cb075fa0b90d9d46218666c7967'),
 'ops/vps/becore-tickets-preview.service': ('100644',
                                            '889233505917ae749ee276050d7f9060c975ed4a'),
 'ops/vps/becore-tickets-retention.service': ('100644',
                                              '68f4ab992f05742a086f23af7983f9c5561b1b13'),
 'ops/vps/becore-tickets-retention.timer': ('100644',
                                            '7d77baf5059b0fc725976e8d4eceeb53a53ed2ff'),
 'ops/vps/candidate_build.py': ('100644',
                                '502b3f8cddc2038113498824e430620eb1b55d0f'),
 'ops/vps/candidate_evidence.py': ('100644',
                                   'd65fcd4941bf8b2b5eb7eadae1e92fcd13d0b3ba'),
 'ops/vps/code-release.py': ('100644',
                             '62ed438a1ca9f7229a57fbc48228fa22f51068e7'),
 'ops/vps/initialize-preview.mjs': ('100644',
                                    '6171616a2d73ed536aad0896d3016d2d41a6ba95'),
 'ops/vps/inspect-bounce-codes-readonly.py': ('100644',
                                              '6e344e7047c9897047c9dffda27e0f699d25e893'),
 'ops/vps/inspect-mail-service-readonly.py': ('100644',
                                              '819baa97ef82c687c52ed288daf49db6486f0a21'),
 'ops/vps/install-preview.py': ('100644',
                                '0fb837d72409234a074b2891c784f0f7605e600f'),
 'ops/vps/journal-limits.conf': ('100644',
                                 'bd9c88d6d78144830b5d4ce26dce2d86825b84e5'),
 'ops/vps/parallel_candidate.py': ('100644',
                                   '08e44556ad630ee5227463b74bce990f943d939f'),
 'ops/vps/parallel_candidate_control.py': ('100644',
                                           '1000acb20a4e8b3a0d9c5771ea5269db006805a4'),
 'ops/vps/prepare-origin.py': ('100644',
                               '8939073562dd7e73073f092a09c3c973003c6b63'),
 'ops/vps/public_runtime_guard.py': ('100644',
                                     '9a9739f1bd88cbd02dc420001efa3de5b85e3538'),
 'ops/vps/recover-puro-first-host-20261024.py': ('100644',
                                                 'e4d2fecee02ad2b24304beec755f1b161ad6b4b0'),
 'ops/vps/restore-backup.mjs': ('100644',
                                '0a05f18c17205ef4c2f59e2d50bd06180035b8c6'),
 'ops/vps/retention.py': ('100644', '9ab0304f00d2a96fd6fbb8e4c992d96db5eb08a1'),
 'ops/vps/runtime_release.py': ('100644',
                                '043e310a41ff28d23adc20383c88566b181232a6'),
 'ops/vps/test_audit_readiness.py': ('100644',
                                     '7a431017c03e99ad0b358b17399b1313cd935606'),
 'ops/vps/test_bounce_codes_readonly.py': ('100644',
                                           '6d105f85df2362711ab5b128592d3d3a18342d02'),
 'ops/vps/test_candidate_build.py': ('100644',
                                     'a9920c4d21804074d4ab176c541247787b46639f'),
 'ops/vps/test_candidate_evidence.py': ('100644',
                                        'f63544c3ea061f75db1f544c85cddaae109a0f4e'),
 'ops/vps/test_code_release.py': ('100644',
                                  '952c1a101b07813489d20b86578689a388a99eeb'),
 'ops/vps/test_first_host_recovery.py': ('100644',
                                         '9f9579d7ffa30b54249a5126b85f60032c9f7d05'),
 'ops/vps/test_mail_service_readonly.py': ('100644',
                                           'f02a6d1e30d0dfe464af9d3d4ade87726e67eb94'),
 'ops/vps/test_mail_upgrade.py': ('100644',
                                  'bed5cdca2491fe06345044f395721d82b09029e0'),
 'ops/vps/test_parallel_admission.py': ('100644',
                                        '35b8fb438193184f8e1654d44981f6c3564d0ca0'),
 'ops/vps/test_parallel_candidate.py': ('100644',
                                        '3af28a1b01a08c19a97155229f6e0b5efc592fc0'),
 'ops/vps/test_parallel_candidate_control.py': ('100644',
                                                '6ddbd74138168c8538406920d9fda7432ce67f49'),
 'ops/vps/test_parallel_source_family.py': ('100644',
                                            '54ac92e721b51dda03bca69862816fa78d1c0737'),
 'ops/vps/test_pink_edition.py': ('100644',
                                  'be26c898ac1e19f7f737dbe5112c5e40b6e90c68'),
 'ops/vps/test_public_runtime_guard.py': ('100644',
                                          'eb1fd8a6909c7c0634326da1d35c7a4606fbebe7'),
 'ops/vps/test_release_approval.py': ('100644',
                                      '48a8e82d6bf64e21a8bd5f99719f6f0d1022de6f'),
 'ops/vps/test_release_source.py': ('100644',
                                    'ec8a7a5bbbe585941583f50624823b85ec51e586'),
 'ops/vps/test_retention.py': ('100644',
                               'f35d71212ec6ae521e3144c57e708297c513dce0'),
 'ops/vps/test_runtime_packaging.py': ('100644',
                                       '6f215f441ff1d9b92b3c870a6f438a54e5ccc1a1'),
 'ops/vps/test_runtime_release.py': ('100644',
                                     '210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14'),
 'ops/vps/test_runtime_workflow_contract.py': ('100644',
                                               'c9620eeb200133ee94c76accc5328ecce28b4b75'),
 'ops/vps/test_yorkeway_mail_upgrade.py': ('100644',
                                           'e3cfbdcb713204e0c71c13ff40fb3d4eb3bf5c89'),
 'ops/vps/test_yorkeway_release.py': ('100644',
                                      '69521792dfce290e85c70120fbe11bca8353b1f4'),
 'ops/vps/upgrade-room-mail.py': ('100644',
                                  '0f8b77d5bf2ed3df86a17475923cd1ea5a0d1358'),
 'ops/vps/upgrade-yorkeway-mail.py': ('100644',
                                      '9c3fc4896f10e25eb61b7937eea2035b0757ad4f'),
 'scripts/audit-checkbox-hotfix.py': ('100644',
                                      '5313d8cdc4076b36d434fe8017cc0e7b4824e876'),
 'scripts/audit-release-dependencies.py': ('100644',
                                           '47c7951e8db95ac666680bd2bf32fde3f1748c8e'),
 'scripts/audit-release-manifest.json': ('100644',
                                         'bcb787e744f9fc5fc201e8068d553c1543b35b86'),
 'scripts/caption-source-manifest.json': ('100644',
                                          '1b178a1a371ae047f8bf26498d249e272c11497d'),
 'scripts/verify-audit-release-source.py': ('100644',
                                            '129d7bdbd2d631ad385a9edd7be4ea9895f173cf'),
 'scripts/verify-caption-source.py': ('100644',
                                      'fa474c5d8cfaad8df53e77004c063e1511ed0b68'),
 'tests/test_audit_release_dependencies.py': ('100644',
                                              '6983998bf40fc1cb424e6dafbb7ba35e5653336d'),
 'tests/test_audit_release_source.py': ('100644',
                                        '6516f3f4b8582d3874ceda34e1fc3e3b799fec8d'),
 'tests/test_caption_source.py': ('100644',
                                  '6871fcc1ab410acaa74d8bd953ac9e0e61f4f670'),
 'tests/test_checkbox_hotfix_audit.py': ('100644',
                                         '421ec5fd992b1ba258e357ff4a65f6c3a647d2ce')}
SECURITY_TEST_FILE = Path(__file__).resolve()

def security_source_family(root):
    """Recognize only the complete Yorke Way security C/P family for local test execution."""
    root = Path(root)
    operator = root / 'ops/vps/code-release.py'
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    # The executing new test family cannot downgrade to a historical operator.
    # Capture its real module path once, independent of historical fixture mocks.
    selected = (root / 'ops/vps/test_code_release.py').resolve() == SECURITY_TEST_FILE
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != SECURITY_OPERATOR_BLOB):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            baseline = release.SECURITY_PATCH_SNAPSHOT
            if (checkout_git(root, 'rev-parse', baseline + '^{tree}').decode().strip()
                    != release.SECURITY_PATCH_TREE):
                raise AssertionError('Yorke Way security family baseline tree changed')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', baseline).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Yorke Way security baseline contains unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest['ops/vps/test_yorkeway_release.py'] = ('100644', SECURITY_TEST_BLOB)
            application = release.SECURITY_PATCH_BLOBS
            observed = {}
            for name in application:
                path = root / name
                observed[name] = digest(path.read_bytes()) if path.is_file() and not path.is_symlink() else None
            if observed == application:
                manifest.update({name: ('100644', blob) for name, blob in application.items()})
            elif any(observed[name] != manifest.get(name, (None, None))[1] for name in application):
                raise AssertionError('Yorke Way security application family has partial or unreviewed bytes')
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Yorke Way security full inventory differs from complete tracked C/P family')
            # A restored worktree cannot conceal staged application changes.
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if not record:
                    continue
                metadata, raw_name = record.split(b'\t', 1)
                mode, blob, stage = metadata.decode().split()
                name = os.fsdecode(raw_name)
                if (stage != '0' or name not in manifest
                        or (name in release.SECURITY_CONTROL_FILES
                            and (mode != '100644' or blob != digest((root / name).read_bytes())))
                        or (name not in release.SECURITY_CONTROL_FILES and manifest[name] != (mode, blob))):
                    raise AssertionError('Yorke Way security index differs from complete application family')
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError('Yorke Way security family requires its independently pinned baseline') from exc
    else:
        manifest = dict(SECURITY_STAGED_BASE)
    # Only this test file cannot self-pin; production binds both controls to C.
    manifest['ops/vps/code-release.py'] = ('100644', SECURITY_OPERATOR_BLOB)
    manifest['ops/vps/test_code_release.py'] = ('100644', None)
    manifest['ops/vps/test_yorkeway_release.py'] = ('100644', SECURITY_TEST_BLOB)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Yorke Way security family requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError('Yorke Way security family is incomplete') from exc
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Yorke Way security family has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


# Test-only complete source recognition for the approved next CI controls.
# These pins grant no production source admission and cannot select application bytes.
PARALLEL_GATE_BASELINE = 'ab92219f25d10e133b77778e83e8a69e17d6e418'
PARALLEL_GATE_BASE_TREE = '903d4424205ee199bc7e344b8e17426e434cf38b'
PARALLEL_GATE_OUTPUTS = {'.github/workflows/booking-consent-previews.yml': ('100644',
                                                    '07a3832723e242021bd1886069eb582b51a3f0b8'),
 '.github/workflows/candidate-checks.yml': ('100644',
                                            'fce0c733744bf53af146a1c707d347935ce80fd3'),
 '.github/workflows/candidate-parallel-checks.yml': ('100644',
                                                     'dce7d33d0e6054d2cad285146b4afa258dd0d8d0'),
 '.github/workflows/tickets-code-release.yml': ('100644',
                                                'e3d0e157cacaf5b4aede03d257c7f7bb0fb16656'),
 'ops/vps/code-release.py': ('100644',
                             'd925d570a4560645a0acaa56922c4f1b72f24de3'),
 'ops/vps/parallel_candidate.py': ('100644',
                                   'a63444b9c650da5a13c770efd2a286af634304f4'),
 'ops/vps/parallel_candidate_control.py': ('100644',
                                           '28fce119dc22b65780a3461ca5da9d1b435bca46'),
 'ops/vps/test_candidate_evidence.py': ('100644',
                                        '5683f38b8cb10b02abc687f35be02a8a6749b996'),
 'ops/vps/test_parallel_admission.py': ('100644',
                                        'ec9fc0edd8abc210749b4eb6f962ad8a898dd4a8'),
 'ops/vps/test_parallel_candidate.py': ('100644',
                                        '808359153e33f74681056bba586dbcf7c8df7601'),
 'ops/vps/test_parallel_candidate_control.py': ('100644',
                                                '87dac06c7b8f71332e32e89a1e2858d5f849abf6'),
 'ops/vps/test_yorkeway_release.py': ('100644',
                                      '8145296d9863c4788a486081acde67ccb1e5de9e'),
 'package.json': ('100644', 'cd080a08e3350d17b414e6e62015c9b31cced055'),
 'scripts/browser-environment.json': ('100644',
                                      '5364ab400ce4a79e05ac45cfadf322dd9d97cca8'),
 'scripts/verify-browser-environment.mjs': ('100644',
                                            '53eba71962ec08f37723096e4320c0634d7ec151'),
 'tests/browser-environment.test.mjs': ('100644',
                                        '08279cdc7c970991447c6a5ef782c6cc9226d3f7'),
 'tests/e2e/my-nights-studio.spec.ts': ('100644',
                                        '85ae6c972144274551a18493976a90ee39d21b86'),
 'tests/repository-boundaries.test.mjs': ('100644',
                                          '46a6e6a0c166b1c3e1561ccdad714c2c1fa4d493'),
 'tests/test_candidate_parallel_workflow.py': ('100644',
                                               'c0b4c9802d97921e7d2b7a29fae296a7f5e5a924')}
PARALLEL_GATE_TEST_FILE = Path(__file__).resolve()
PARALLEL_GATE_STAGED_ADDITIONS = frozenset()


PARALLEL_GATE_WORKFLOW_BASE = {'.github/workflows/tickets-code-release.yml': '227200c0e27f4c0d207ebacc66083bb44b8afc44',
 '.github/workflows/tickets-release-operator-checks.yml': 'a0099e4403e2f7f84e1ee5651899cdbe1823866b'}
PARALLEL_GATE_WORKFLOW_REVERSE = {'.github/workflows/tickets-code-release.yml': ((b'        default: false\n        type: boolean'
                                                 b'\n      candidate_mode:\n        description: '
                                                 b'Authenticated parallel evidence by default; lega'
                                                 b'cy is an explicit fallback\n        required:'
                                                 b' false\n        default: parallel-v1\n        '
                                                 b'type: choice\n        options: [legacy, paral'
                                                 b'lel-v1]\n      expected_active:\n',
                                                 b'        default: false\n        type: boolean'
                                                 b'\n      candidate_mode:\n        description: '
                                                 b'Explicit browser evidence contract; legacy remai'
                                                 b'ns the default\n        required: false\n     '
                                                 b'   default: legacy\n        type: choice\n    '
                                                 b'    options: [legacy, parallel-v1]\n      exp'
                                                 b'ected_active:\n'),
                                                (b'      EXPECTED_ACTIVE: ${{ inputs.expected_activ'
                                                 b'e }}\n      RUNTIME_RUN: ${{ inputs.runtime_r'
                                                 b'un }}\n      CANDIDATE_RUN: ${{ inputs.candid'
                                                 b'ate_run }}\n      CANDIDATE_MODE: ${{ inputs.'
                                                 b"candidate_mode || 'parallel-v1' }}\n      VER"
                                                 b"IFY_ONLY: ${{ inputs.verify_only && 'true' || 'f"
                                                 b"alse' }}\n      INSPECT_MODE: ${{ inputs.insp"
                                                 b"ect_failed_release && 'true' || 'false' }}\n "
                                                 b'     RECOVER_PREPARED: ${{ inputs.recover_prepar'
                                                 b'ed }}\n',
                                                 b'      EXPECTED_ACTIVE: ${{ inputs.expected_activ'
                                                 b'e }}\n      RUNTIME_RUN: ${{ inputs.runtime_r'
                                                 b'un }}\n      CANDIDATE_RUN: ${{ inputs.candid'
                                                 b'ate_run }}\n      CANDIDATE_MODE: ${{ inputs.'
                                                 b"candidate_mode || 'legacy' }}\n      VERIFY_O"
                                                 b"NLY: ${{ inputs.verify_only && 'true' || 'false'"
                                                 b' }}\n      INSPECT_MODE: ${{ inputs.inspect_f'
                                                 b"ailed_release && 'true' || 'false' }}\n      "
                                                 b'RECOVER_PREPARED: ${{ inputs.recover_prepared }}'
                                                 b'\n'),
                                                (b'    if: ${{ !inputs.verify_only }}\n    name:'
                                                 b' Verify retired checkout preview (${{ matrix.bro'
                                                 b'wser }})\n    needs: release\n    runs-on: ubu'
                                                 b'ntu-24.04\n    container:\n      image: mcr.mi'
                                                 b'crosoft.com/playwright:v1.62.1-noble@sha256:dcc5'
                                                 b'531e97840b9b5e794f2814476b21571c5124a3fca2267d73'
                                                 b'041f56e7580e\n      options: --user 1001 --sh'
                                                 b'm-size=1g\n    timeout-minutes: 15\n    permis'
                                                 b'sions:\n      contents: read\n',
                                                 b'    if: ${{ !inputs.verify_only }}\n    name:'
                                                 b' Verify retired checkout preview (${{ matrix.bro'
                                                 b'wser }})\n    needs: release\n    runs-on: ubu'
                                                 b'ntu-latest\n    timeout-minutes: 15\n    permi'
                                                 b'ssions:\n      contents: read\n'),
                                                (b'        browser: [desktop-chromium, mobile-chrom'
                                                 b'ium, mobile-webkit]\n    env:\n      E2E_BASE_'
                                                 b'URL: https://tickets.becoreops.com\n    defau'
                                                 b'lts:\n      run:\n        shell: bash\n    step'
                                                 b's:\n      - uses: actions/checkout@11d5960a32'
                                                 b'6750d5838078e36cf38b85af677262\n        with:\n',
                                                 b'        browser: [desktop-chromium, mobile-chrom'
                                                 b'ium, mobile-webkit]\n    env:\n      E2E_BASE_'
                                                 b'URL: https://tickets.becoreops.com\n    steps'
                                                 b':\n      - uses: actions/checkout@11d5960a326'
                                                 b'750d5838078e36cf38b85af677262\n        with:\n'),
                                                (b'          node-version: 22.23.4\n          ca'
                                                 b'che: npm\n      - run: npm ci\n      - name: V'
                                                 b'erify prepared browser engines\n        run: '
                                                 b'node scripts/verify-browser-environment.mjs chro'
                                                 b'mium webkit\n      - name: Verify only the re'
                                                 b'moved preview page and API\n        run: npx '
                                                 b'playwright test tests/e2e/checkout-preview-retir'
                                                 b'ed.spec.ts --project ${{ matrix.browser }} --wor'
                                                 b'kers=1 --retries=0\n      # This endpoint-onl'
                                                 b'y smoke gate has no distributable build output. '
                                                 b'Its\n',
                                                 b'          node-version: 22.23.4\n          ca'
                                                 b'che: npm\n      - run: npm ci\n      - name: I'
                                                 b'nstall browser engines\n        run: npx play'
                                                 b'wright install --with-deps chromium webkit\n '
                                                 b'     - name: Verify only the removed preview pag'
                                                 b'e and API\n        run: npx playwright test t'
                                                 b'ests/e2e/checkout-preview-retired.spec.ts --proj'
                                                 b'ect ${{ matrix.browser }} --workers=1 --retries='
                                                 b'0\n      # This endpoint-only smoke gate has '
                                                 b'no distributable build output. Its\n'))}

def parallel_gate_historical_workflow(name, raw):
    """Reverse only the complete exact approved CI delta for historical assertions."""
    raw = operator_retry_historical_workflow(name, raw)
    expected = PARALLEL_GATE_OUTPUTS.get(name)
    digest = lambda value: release.hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
    if name not in PARALLEL_GATE_WORKFLOW_REVERSE or expected is None or digest(raw) != expected[1]:
        return raw
    for current, historical in PARALLEL_GATE_WORKFLOW_REVERSE[name]:
        if raw.count(current) != 1:
            raise AssertionError('Parallel gate workflow reverse is ambiguous or incomplete')
        raw = raw.replace(current, historical, 1)
    if digest(raw) != PARALLEL_GATE_WORKFLOW_BASE[name]:
        raise AssertionError('Parallel gate workflow did not reconstruct the pinned baseline')
    return raw


def parallel_gate_source_family(root):
    """Require the exact baseline plus the independently reviewed finite CI delta."""
    root = Path(root)
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    operator = root / 'ops/vps/code-release.py'
    selected = (root / 'ops/vps/test_code_release.py').resolve() == PARALLEL_GATE_TEST_FILE
    expected_operator = PARALLEL_GATE_OUTPUTS['ops/vps/code-release.py'][1]
    if not selected and (not operator.is_file() or operator.is_symlink()
                         or digest(operator.read_bytes()) != expected_operator):
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            if checkout_git(root, 'rev-parse', PARALLEL_GATE_BASELINE + '^{tree}').decode().strip() != PARALLEL_GATE_BASE_TREE:
                raise AssertionError('Parallel gate baseline tree differs')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', PARALLEL_GATE_BASELINE).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Parallel gate baseline has unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update(PARALLEL_GATE_OUTPUTS)
            manifest['ops/vps/test_code_release.py'] = ('100644', None)
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Parallel gate full inventory differs')
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, blob, stage = metadata.decode().split()
                    name = os.fsdecode(name)
                    expected = manifest.get(name)
                    if expected == ('100644', None):
                        expected = ('100644', digest((root / name).read_bytes()))
                    if stage != '0' or expected != (mode, blob):
                        raise AssertionError('Parallel gate index differs from complete reviewed family')
        except (OSError, subprocess.CalledProcessError) as error:
            raise AssertionError('Parallel gate requires its exact independent baseline') from error
    else:
        manifest = dict(SECURITY_STAGED_BASE)
        # The staging command includes all tracked ops/vps files and only its
        # explicitly enumerated workflows/scripts. No arbitrary new paths ship.
        manifest.update({name: value for name, value in PARALLEL_GATE_OUTPUTS.items()
                         if name in manifest or name in PARALLEL_GATE_STAGED_ADDITIONS})
        manifest['ops/vps/test_code_release.py'] = ('100644', None)
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Parallel gate requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as error:
            raise AssertionError('Parallel gate source is incomplete') from error
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Parallel gate has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


class ParallelGateWorkflowHistoryTests(unittest.TestCase):
    def test_only_exact_reviewed_workflow_reconstructs_pinned_baseline(self):
        root = Path(__file__).resolve().parents[2]
        for name in PARALLEL_GATE_WORKFLOW_REVERSE:
            raw = (root/name).read_bytes()
            before = parallel_gate_historical_workflow(name, raw)
            digest = lambda value: release.hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
            self.assertEqual(digest(before), PARALLEL_GATE_WORKFLOW_BASE[name])
            self.assertNotEqual(before, raw)
            mutations = (raw + b'\n# unrelated mutation\n', raw.replace(b'contents: read', b'contents: write', 1),
                         raw.replace(b'tar -x', b'tar --wildcards -x', 1), raw.replace(b'node-version:', b'node-version-bad:', 1))
            for changed in mutations:
                self.assertNotEqual(changed, raw)
                self.assertEqual(parallel_gate_historical_workflow(name, changed), changed)


class ParallelGateSourceFamilyTests(unittest.TestCase):
    """Real isolated Git inventories: the finite CI delta cannot hide app drift."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.files = {'package.json': b'{}\n', 'package-lock.json': b'locked\n',
                      'tests/e2e/journey.spec.ts': b'original browser assertions\n',
                      'app/page.tsx': b'application\n', 'drizzle/0001.sql': b'schema\n',
                      'wrangler.json': b'configuration\n', '.github/workflows/candidate-parallel-checks.yml': b'workflow\n',
                      'ops/vps/code-release.py': b'old operator\n',
                      'ops/vps/test_code_release.py': b'control tests\n'}
        self.git('init', '-q'); self.git('config', 'user.name', 'Isolated controls tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        for name, raw in self.files.items(): self.write(name, raw)
        self.git('add', '-A'); self.git('commit', '-qm', 'independent baseline')
        baseline = self.git('rev-parse', 'HEAD'); tree = self.git('rev-parse', 'HEAD^{tree}')
        self.outputs = {'ops/vps/code-release.py': ('100644', self.blob(b'new operator\n')),
                       'tests/e2e/journey.spec.ts': ('100644', self.blob(b'original browser assertions\nawait readiness\n')),
                       '.github/workflows/candidate-parallel-checks.yml': ('100644', self.blob(b'new workflow\n'))}
        staged = {name: ('100644', self.blob(raw)) for name, raw in self.files.items() if name.startswith(('ops/', '.github/'))}
        for name, value in (('PARALLEL_GATE_BASELINE', baseline), ('PARALLEL_GATE_BASE_TREE', tree),
                            ('PARALLEL_GATE_OUTPUTS', self.outputs), ('SECURITY_STAGED_BASE', staged),
                            ('PARALLEL_GATE_TEST_FILE', self.root/'ops/vps/test_code_release.py')):
            patcher = patch.object(sys.modules[__name__], name, value)
            patcher.start(); self.addCleanup(patcher.stop)
        self.write('ops/vps/code-release.py', b'new operator\n')
        self.write('tests/e2e/journey.spec.ts', b'original browser assertions\nawait readiness\n')
        self.write('.github/workflows/candidate-parallel-checks.yml', b'new workflow\n')
        self.git('add', '-A'); self.git('commit', '-qm', 'exact CI delta')

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    def write(self, name, raw):
        path = self.root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)

    def test_exact_complete_family_and_historical_operator_do_not_alias(self):
        result = parallel_gate_source_family(self.root)
        self.assertEqual(result['ops/vps/code-release.py'], self.outputs['ops/vps/code-release.py'][1])
        self.assertEqual(set(result), set(self.files)-{'ops/vps/test_code_release.py'})
        self.write('ops/vps/code-release.py', b'old operator\n')
        with self.assertRaises(AssertionError): parallel_gate_source_family(self.root)

    def test_changed_application_dependencies_schema_config_workflow_and_modes_reject(self):
        for name in self.files:
            if name == 'ops/vps/test_code_release.py': continue
            self.git('reset', '--hard', '-q', 'HEAD')
            self.write(name, b'unreviewed\n')
            with self.subTest(name=name), self.assertRaises(AssertionError): parallel_gate_source_family(self.root)
            self.git('add', name)
            with self.subTest(staged=name), self.assertRaises(AssertionError): parallel_gate_source_family(self.root)
        self.git('reset', '--hard', '-q', 'HEAD')
        (self.root/'app/page.tsx').chmod(0o755)
        with self.assertRaises(AssertionError): parallel_gate_source_family(self.root)

    def test_missing_extra_symlink_and_restored_worktree_cannot_hide_index_drift(self):
        for mutation in ('missing', 'extra', 'symlink', 'index'):
            self.git('reset', '--hard', '-q', 'HEAD'); (self.root/'extra').unlink(missing_ok=True)
            path = self.root/'app/page.tsx'
            if mutation == 'missing': path.unlink()
            elif mutation == 'extra': self.write('extra', b'untracked')
            elif mutation == 'symlink': path.unlink(); path.symlink_to('../package.json')
            else:
                path.write_bytes(b'wrong staged content'); self.git('add', 'app/page.tsx'); path.write_bytes(self.files['app/page.tsx'])
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError): parallel_gate_source_family(self.root)

    def test_staged_archive_rejects_partial_extra_mode_and_wrong_operator(self):
        for mutation in (None, 'missing', 'extra', 'mode', 'operator'):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in SECURITY_STAGED_BASE:
                    destination = root/name; destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes((self.root/name).read_bytes())
                if mutation == 'missing': (root/'.github/workflows/candidate-parallel-checks.yml').unlink()
                elif mutation == 'extra': (root/'extra').mkdir()
                elif mutation == 'mode': (root/'ops/vps/code-release.py').chmod(0o755)
                elif mutation == 'operator': (root/'ops/vps/code-release.py').write_bytes(b'old operator\n')
                with patch.object(sys.modules[__name__], 'PARALLEL_GATE_TEST_FILE', root/'ops/vps/test_code_release.py'):
                    if mutation is None: self.assertIsNotNone(parallel_gate_source_family(root))
                    else:
                        with self.subTest(mutation=mutation), self.assertRaises(AssertionError): parallel_gate_source_family(root)

    def test_wrong_independent_tree_pin_rejects(self):
        with patch.object(sys.modules[__name__], 'PARALLEL_GATE_BASE_TREE', 'f'*40), self.assertRaises(AssertionError):
            parallel_gate_source_family(self.root)


# Separate finite continuation of the merged stage1 family. No production
# admission changes and no mutation of any earlier family's source pins.
PREPARED_BROWSER_STAGE2_BASELINE = '670eaec9c36ce826a08b26697875a05d577111af'
PREPARED_BROWSER_STAGE2_BASE_TREE = '096a23f14cbffd0b9f4edec0eb3396b31e8ca57a'
PREPARED_BROWSER_STAGE2_OUTPUTS = {'.github/workflows/browser-followup.yml': ('100644',
                                            '6476c6d3313354731a83686fbc90fa3f4e754aec'),
 '.github/workflows/customer-email-previews.yml': ('100644',
                                                   'b667d6f54ee7a2d230c474c26d3a8a2855a0d4a3'),
 '.github/workflows/input-modality-checks.yml': ('100644',
                                                 '74c855d9ad7eb75821b20ea8f3a81caccf2fc350'),
 '.github/workflows/native-apps.yml': ('100644',
                                       '77eb667c29f5e8ad4b73d3e17825ad67d496f00f'),
 '.github/workflows/yorkeway-previews.yml': ('100644',
                                             'b3b0872fcc9348d9c192eb7c8fad5ade12bf4afd'),
 'tests/browser-environment.test.mjs': ('100644',
                                        '7692439ced79cc5e5794bdf6c301fe658f92fca5')}
PREPARED_BROWSER_STAGE2_TEST_FILE = Path(__file__).resolve()
PREPARED_BROWSER_STAGE2_STAGED_ADDITIONS = frozenset()
PREPARED_BROWSER_STAGE2_STAGED_BASE = dict(SECURITY_STAGED_BASE)
PREPARED_BROWSER_STAGE2_STAGED_BASE.update({name: value for name, value in PARALLEL_GATE_OUTPUTS.items()
    if name in PREPARED_BROWSER_STAGE2_STAGED_BASE or name in PARALLEL_GATE_STAGED_ADDITIONS})


def prepared_browser_stage2_source_family(root):
    """Require the exact baseline plus the independently reviewed finite stage2 CI delta."""
    root = Path(root)
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    operator = root / 'ops/vps/code-release.py'
    selected = (root / 'ops/vps/test_code_release.py').resolve() == PREPARED_BROWSER_STAGE2_TEST_FILE
    # Stage2 does not change the operator, so that hash cannot distinguish it
    # from stage1. A partial exact stage2 marker selects the stricter full family;
    # the executing control never falls back when any current byte is changed.
    marked = any((root / name).is_file() and not (root / name).is_symlink()
                 and digest((root / name).read_bytes()) == value[1]
                 for name, value in PREPARED_BROWSER_STAGE2_OUTPUTS.items())
    if not selected and not marked:
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            if checkout_git(root, 'rev-parse', PREPARED_BROWSER_STAGE2_BASELINE + '^{tree}').decode().strip() != PREPARED_BROWSER_STAGE2_BASE_TREE:
                raise AssertionError('Prepared browser stage2 baseline tree differs')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', PREPARED_BROWSER_STAGE2_BASELINE).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Prepared browser stage2 baseline has unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update(PREPARED_BROWSER_STAGE2_OUTPUTS)
            manifest['ops/vps/test_code_release.py'] = ('100644', None)
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Prepared browser stage2 full inventory differs')
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, blob, stage = metadata.decode().split()
                    name = os.fsdecode(name)
                    expected = manifest.get(name)
                    if expected == ('100644', None):
                        expected = ('100644', digest((root / name).read_bytes()))
                    if stage != '0' or expected != (mode, blob):
                        raise AssertionError('Prepared browser stage2 index differs from complete reviewed family')
        except (OSError, subprocess.CalledProcessError) as error:
            raise AssertionError('Prepared browser stage2 requires its exact independent baseline') from error
    else:
        manifest = dict(PREPARED_BROWSER_STAGE2_STAGED_BASE)
        # The staging command includes all tracked ops/vps files and only its
        # explicitly enumerated workflows/scripts. No arbitrary new paths ship.
        manifest.update({name: value for name, value in PREPARED_BROWSER_STAGE2_OUTPUTS.items()
                         if name in manifest or name in PREPARED_BROWSER_STAGE2_STAGED_ADDITIONS})
        manifest['ops/vps/test_code_release.py'] = ('100644', None)
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Prepared browser stage2 requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as error:
            raise AssertionError('Prepared browser stage2 source is incomplete') from error
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Prepared browser stage2 has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


class PreparedBrowserStage2SourceFamilyTests(ParallelGateSourceFamilyTests):
    """The exact stage2 family also rejects every existing inventory mutation."""
    def setUp(self):
        super().setUp()
        for name, value in (
                ('PREPARED_BROWSER_STAGE2_BASELINE', PARALLEL_GATE_BASELINE),
                ('PREPARED_BROWSER_STAGE2_BASE_TREE', PARALLEL_GATE_BASE_TREE),
                ('PREPARED_BROWSER_STAGE2_OUTPUTS', PARALLEL_GATE_OUTPUTS),
                ('PREPARED_BROWSER_STAGE2_TEST_FILE', PARALLEL_GATE_TEST_FILE),
                ('PREPARED_BROWSER_STAGE2_STAGED_BASE', SECURITY_STAGED_BASE),
                ('parallel_gate_source_family', prepared_browser_stage2_source_family)):
            patcher = patch.object(sys.modules[__name__], name, value)
            patcher.start(); self.addCleanup(patcher.stop)

    def test_wrong_independent_tree_pin_rejects(self):
        with patch.object(sys.modules[__name__], 'PREPARED_BROWSER_STAGE2_BASE_TREE', 'f'*40), self.assertRaises(AssertionError):
            prepared_browser_stage2_source_family(self.root)

    def test_stage1_without_any_stage2_marker_is_not_reclassified(self):
        other = self.root / 'unrelated-archive'
        other.mkdir()
        self.assertIsNone(prepared_browser_stage2_source_family(other))

    def test_partial_stage2_overlay_never_falls_back_to_stage1(self):
        self.write('tests/e2e/journey.spec.ts', self.files['tests/e2e/journey.spec.ts'])
        self.git('add', 'tests/e2e/journey.spec.ts')
        with self.assertRaises(AssertionError): prepared_browser_stage2_source_family(self.root)


# Separate finite test-only continuation for operator CI retry boundaries.
# This family grants no production release authority or cross-attempt evidence.
OPERATOR_RETRY_BASELINE = '694be41b4b8c0f9b4abf96e6a50f515a1101ebd6'
OPERATOR_RETRY_BASE_TREE = '12b1a9fd6fcb92cdb290ba7c888ed59474b7f852'
OPERATOR_RETRY_OUTPUTS = {'.github/workflows/tickets-release-operator-checks.yml': ('100644',
                                                           'df578c820a2102b6749c2296a1933a47e494f52e'),
 'tests/test_operator_retry_workflow.py': ('100644', '7c5405ab3309f091ee32ff13dd1b628a5217db10')}
OPERATOR_RETRY_WORKFLOW = '.github/workflows/tickets-release-operator-checks.yml'
OPERATOR_RETRY_WORKFLOW_BASE = 'a0099e4403e2f7f84e1ee5651899cdbe1823866b'
OPERATOR_RETRY_WORKFLOW_REVERSE = ((b'      - tests/test_operator_retry_workflow.py\n', b''),
 (b'  source_guards:\n', b'  verify:\n'),
 (b'      - name: Verify operator retry boundaries\n        run: python3 -I -m unittest discover '
  b"-s tests -p 'test_operator_retry_workflow.py' -v\n",
  b''),
 (b'  # Keep source guards as a prerequisite, but give the staged-layout suite its\n  # own retry'
  b' boundary. A failed staged job need not replay successful guards.\n  staged_layout:\n    needs'
  b': source_guards\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - us'
  b'es: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          ref: $'
  b'{{ github.event.pull_request.head.sha || github.sha }}\n          persist-credentials: false\n'
  b'          fetch-depth: 0\n',
  b''),
 (b'  # Preserve the required check name. Skipped, cancelled and failed stages must\n  # never be'
  b"come green through GitHub's default dependency skip behavior.\n  verify:\n    if: ${{ always()"
  b' }}\n    needs: [source_guards, staged_layout]\n    runs-on: ubuntu-latest\n    timeout-minutes'
  b': 2\n    steps:\n      - name: Require both exact-source operator stages\n        env:\n    '
  b'      SOURCE_GUARDS_RESULT: ${{ needs.source_guards.result }}\n          STAGED_LAYOUT_RESULT'
  b': ${{ needs.staged_layout.result }}\n        shell: bash\n        run: |\n          set -euo pi'
  b'pefail\n          test "$SOURCE_GUARDS_RESULT" = success\n          test "$STAGED_LAYOUT_RESUL'
  b'T" = success\n',
  b''))


def operator_retry_historical_workflow(name, raw):
    """Reverse only the exact finite retry delta; no mutated bytes normalize."""
    digest = lambda value: release.hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
    expected = OPERATOR_RETRY_OUTPUTS.get(name)
    if name != OPERATOR_RETRY_WORKFLOW or expected is None or digest(raw) != expected[1]:
        return raw
    for current, historical in OPERATOR_RETRY_WORKFLOW_REVERSE:
        if raw.count(current) != 1:
            raise AssertionError('Operator retry workflow reverse is ambiguous or incomplete')
        raw = raw.replace(current, historical, 1)
    if digest(raw) != OPERATOR_RETRY_WORKFLOW_BASE:
        raise AssertionError('Operator retry workflow did not reconstruct the pinned baseline')
    return raw


OPERATOR_RETRY_TEST_FILE = Path(__file__).resolve()
OPERATOR_RETRY_STAGED_ADDITIONS = frozenset()
OPERATOR_RETRY_STAGED_BASE = dict(PREPARED_BROWSER_STAGE2_STAGED_BASE)
OPERATOR_RETRY_STAGED_BASE.update({name: value for name, value in PREPARED_BROWSER_STAGE2_OUTPUTS.items()
    if name in OPERATOR_RETRY_STAGED_BASE or name in PREPARED_BROWSER_STAGE2_STAGED_ADDITIONS})


def operator_retry_source_family(root):
    """Require the exact baseline plus the independently reviewed finite operator-retry CI delta."""
    root = Path(root)
    def digest(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    operator = root / 'ops/vps/code-release.py'
    selected = (root / 'ops/vps/test_code_release.py').resolve() == OPERATOR_RETRY_TEST_FILE
    # This CI-only change does not alter the operator, so its hash cannot
    # distinguish it from an earlier family. A partial exact operator-retry marker selects the stricter full family;
    # the executing control never falls back when any current byte is changed.
    marked = any((root / name).is_file() and not (root / name).is_symlink()
                 and digest((root / name).read_bytes()) == value[1]
                 for name, value in OPERATOR_RETRY_OUTPUTS.items())
    if not selected and not marked:
        return None
    full = os.path.lexists(root / 'package.json') or os.path.lexists(root / 'app')
    if full:
        try:
            if checkout_git(root, 'rev-parse', OPERATOR_RETRY_BASELINE + '^{tree}').decode().strip() != OPERATOR_RETRY_BASE_TREE:
                raise AssertionError('Operator retry baseline tree differs')
            manifest = {}
            for record in checkout_git(root, 'ls-tree', '-rz', '--full-tree', OPERATOR_RETRY_BASELINE).split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != 'blob' or mode not in ('100644', '100755'):
                        raise AssertionError('Operator retry baseline has unsupported entries')
                    manifest[os.fsdecode(name)] = (mode, blob)
            manifest.update(OPERATOR_RETRY_OUTPUTS)
            manifest['ops/vps/test_code_release.py'] = ('100644', None)
            tracked = set(filter(None, checkout_git(root, 'ls-files', '-z').decode().split('\0')))
            untracked = set(filter(None, checkout_git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
            if tracked != set(manifest) or untracked:
                raise AssertionError('Operator retry full inventory differs')
            for record in checkout_git(root, 'ls-files', '--stage', '-z').split(b'\0'):
                if record:
                    metadata, name = record.split(b'\t', 1)
                    mode, blob, stage = metadata.decode().split()
                    name = os.fsdecode(name)
                    expected = manifest.get(name)
                    if expected == ('100644', None):
                        expected = ('100644', digest((root / name).read_bytes()))
                    if stage != '0' or expected != (mode, blob):
                        raise AssertionError('Operator retry index differs from complete reviewed family')
        except (OSError, subprocess.CalledProcessError) as error:
            raise AssertionError('Operator retry requires its exact independent baseline') from error
    else:
        manifest = dict(OPERATOR_RETRY_STAGED_BASE)
        # The staging command includes all tracked ops/vps files and only its
        # explicitly enumerated workflows/scripts. No arbitrary new paths ship.
        manifest.update({name: value for name, value in OPERATOR_RETRY_OUTPUTS.items()
                         if name in manifest or name in OPERATOR_RETRY_STAGED_ADDITIONS})
        manifest['ops/vps/test_code_release.py'] = ('100644', None)
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == '100755')
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError('Operator retry requires exact regular file modes')
            raw = path.read_bytes()
        except OSError as error:
            raise AssertionError('Operator retry source is incomplete') from error
        if expected is not None and digest(raw) != expected:
            if (name == 'mobile/android/gradlew.bat'
                    and manifest.get('mobile/.gitattributes') == ('100644', '69b47b5ade88fab2dd055b3cfa0858766fb17a47')):
                raw = raw.replace(b'\r\n', b'\n')
            if digest(raw) != expected:
                raise AssertionError('Operator retry has unreviewed bytes: ' + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


class OperatorRetryWorkflowHistoryTests(unittest.TestCase):
    def test_exact_retry_delta_reconstructs_baseline_and_rejects_mutations(self):
        root = Path(__file__).resolve().parents[2]
        raw = (root / OPERATOR_RETRY_WORKFLOW).read_bytes()
        before = operator_retry_historical_workflow(OPERATOR_RETRY_WORKFLOW, raw)
        digest = lambda value: release.hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
        self.assertEqual(digest(before), OPERATOR_RETRY_WORKFLOW_BASE)
        self.assertNotEqual(before, raw)
        for changed in (raw + b'\n# unrelated mutation\n',
                        raw.replace(b'contents: read', b'contents: write', 1),
                        raw.replace(b'needs: source_guards', b'needs: other', 1),
                        raw.replace(b'= success', b'!= failure', 1)):
            self.assertNotEqual(changed, raw)
            self.assertEqual(operator_retry_historical_workflow(OPERATOR_RETRY_WORKFLOW, changed), changed)
        with patch.dict(OPERATOR_RETRY_OUTPUTS, {OPERATOR_RETRY_WORKFLOW: ('100644', digest(raw))}), \
             patch.object(sys.modules[__name__], 'OPERATOR_RETRY_WORKFLOW_BASE', 'f' * 40):
            with self.assertRaises(AssertionError):
                operator_retry_historical_workflow(OPERATOR_RETRY_WORKFLOW, raw)


class OperatorRetrySourceFamilyTests(ParallelGateSourceFamilyTests):
    """The exact operator_retry family also rejects every existing inventory mutation."""
    def setUp(self):
        super().setUp()
        for name, value in (
                ('OPERATOR_RETRY_BASELINE', PARALLEL_GATE_BASELINE),
                ('OPERATOR_RETRY_BASE_TREE', PARALLEL_GATE_BASE_TREE),
                ('OPERATOR_RETRY_OUTPUTS', PARALLEL_GATE_OUTPUTS),
                ('OPERATOR_RETRY_TEST_FILE', PARALLEL_GATE_TEST_FILE),
                ('OPERATOR_RETRY_STAGED_BASE', SECURITY_STAGED_BASE),
                ('parallel_gate_source_family', operator_retry_source_family)):
            patcher = patch.object(sys.modules[__name__], name, value)
            patcher.start(); self.addCleanup(patcher.stop)

    def test_wrong_independent_tree_pin_rejects(self):
        with patch.object(sys.modules[__name__], 'OPERATOR_RETRY_BASE_TREE', 'f'*40), self.assertRaises(AssertionError):
            operator_retry_source_family(self.root)

    def test_earlier_family_without_any_operator_retry_marker_is_not_reclassified(self):
        other = self.root / 'unrelated-archive'
        other.mkdir()
        self.assertIsNone(operator_retry_source_family(other))

    def test_partial_operator_retry_overlay_never_falls_back_to_earlier_family(self):
        self.write('tests/e2e/journey.spec.ts', self.files['tests/e2e/journey.spec.ts'])
        self.git('add', 'tests/e2e/journey.spec.ts')
        with self.assertRaises(AssertionError): operator_retry_source_family(self.root)



def checkout_source_family(root):
    retry = operator_retry_source_family(root)
    if retry is not None:
        return retry
    stage2 = prepared_browser_stage2_source_family(root)
    if stage2 is not None:
        return stage2
    gate = parallel_gate_source_family(root)
    if gate is not None:
        return gate
    security = security_source_family(root)
    if security is not None:
        return security
    owner_push = owner_push_source_family(root)
    if owner_push is not None:
        return owner_push
    yorkeway = yorkeway_source_family(root)
    if yorkeway is not None:
        return yorkeway

    room_mail_vps = room_mail_vps_source_family(root)
    if room_mail_vps is not None:
        return room_mail_vps

    room_mail_focus = room_mail_focus_source_family(root)
    if room_mail_focus is not None:
        return room_mail_focus

    first_host = first_host_source_family(root)
    if first_host is not None:
        return first_host

    camera_looks = camera_looks_source_family(root)
    if camera_looks is not None:
        return camera_looks

    integrated_experience = integrated_experience_source_family(root)
    if integrated_experience is not None:
        return integrated_experience
    recovery_audit = recovery_audit_source_family(root)
    if recovery_audit is not None:
        return recovery_audit
    filters_room = filters_room_source_family(root)
    if filters_room is not None:
        return filters_room
    navigation = navigation_source_family(root)
    if navigation is not None:
        return navigation
    flashes = flashes_source_family(root)
    if flashes is not None:
        return flashes
    recovery = cinco_recovery_source_family(root)
    return recovery if recovery is not None else checkout_parallel_source_family(root)


def checkout_parallel_source_family(root):
    overlay = PURO_EXCESO_TEST_OVERLAY
    selected = any(os.path.lexists(Path(root) / name) for name in overlay)
    result = parallel_source_family(root, overlay=overlay if selected else None)
    if selected and result is None:
        raise AssertionError("Puro overlay requires the complete promoted parallel family")
    return result


def parallel_source_family(root, *, overlay=None):
    """Test-only full/staged C/P recognition. This grants no release authority."""
    root = Path(root)
    markers = ("ops/vps/parallel_candidate.py", "ops/vps/parallel_candidate_control.py",
               "ops/vps/test_parallel_candidate.py", "ops/vps/test_parallel_candidate_control.py",
               "ops/vps/test_parallel_admission.py", release.PARALLEL_PROMOTION_FILE)
    if not any(os.path.lexists(root / name) for name in markers):
        return None
    promoted = os.path.lexists(root / release.PARALLEL_PROMOTION_FILE)
    outputs = {name: (release.PARALLEL_OUTPUT_MODES[name], blob)
               for name, blob in release.PARALLEL_OUTPUT_BLOBS.items()
               if promoted or name != release.PARALLEL_PROMOTION_FILE}
    full = os.path.lexists(root / "package.json") or os.path.lexists(root / "app")
    overlay = dict(overlay or {})
    if overlay and (not full or not promoted):
        raise AssertionError("Puro overlay requires a full promoted parallel family")
    if full:
        try:
            actual_tree = checkout_git(root, "rev-parse", release.PARALLEL_RELEASE_BASELINE + "^{tree}").decode().strip()
            if actual_tree != release.PARALLEL_RELEASE_BASE_TREE:
                raise AssertionError("Parallel family baseline tree changed")
            manifest = {}
            for record in checkout_git(root, "ls-tree", "-rz", "--full-tree", release.PARALLEL_RELEASE_BASELINE).split(b"\0"):
                if record:
                    metadata, name = record.split(b"\t", 1)
                    mode, kind, blob = metadata.decode().split()
                    if kind != "blob" or mode not in ("100644", "100755"):
                        raise AssertionError("Parallel baseline contains unsupported entries")
                    manifest[os.fsdecode(name)] = (mode, blob)
            tracked = set(filter(None, checkout_git(root, "ls-files", "-z").decode().split("\0")))
            untracked = set(filter(None, checkout_git(root, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")))
            if set(overlay) & (set(manifest) | set(outputs) | release.PARALLEL_CONTROL_FILES):
                raise AssertionError("Puro overlay cannot replace parallel family entries")
            if (tracked | untracked) != set(manifest) | set(outputs) | release.PARALLEL_CONTROL_FILES | set(overlay):
                raise AssertionError("Parallel full inventory differs from complete C/P family")
        except (OSError, subprocess.CalledProcessError) as exc:
            raise AssertionError("Parallel family requires its independently pinned B tree") from exc
    else:
        manifest = dict(PARALLEL_STAGED_BASE)
        outputs = {name: entry for name, entry in outputs.items()
                   if name.startswith("ops/vps/") or name.startswith(".github/workflows/")}
    manifest.update(outputs)
    manifest.update(overlay)
    # CINCO's optional six-file application increment is all-or-none and
    # byte-pinned. Control-only CI still checks the unchanged baseline family.
    if full and any(os.path.lexists(root / name) for name in release.CINCO_APPLICATION_BLOBS):
        observed = {}
        for name in release.CINCO_APPLICATION_BLOBS:
            path = root / name
            if not path.is_file() or path.is_symlink():
                raise AssertionError("CINCO application family is incomplete")
            raw = path.read_bytes()
            observed[name] = release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        if observed == release.CINCO_APPLICATION_BLOBS:
            manifest.update({name: ("100644", blob) for name, blob in observed.items()})
        elif any(observed[name] != manifest.get(name, (None, None))[1] for name in observed):
            raise AssertionError("CINCO application family has mixed or unreviewed bytes")
    # Both controls are authenticated against C by production admission. Here
    # the operator is separately pinned; only this test file cannot self-pin.
    manifest["ops/vps/code-release.py"] = ("100644", PARALLEL_OPERATOR_BLOB)
    manifest["ops/vps/test_code_release.py"] = ("100644", None)
    if not full:
        validate_staged_inventory(root, manifest)
    for name, (mode, expected) in manifest.items():
        path = root / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or bool(info.st_mode & 0o111) != (mode == "100755")
                    or any(parent.is_symlink() for parent in (path, *path.parents))):
                raise AssertionError("Parallel family requires exact regular file modes")
            raw = path.read_bytes()
        except OSError as exc:
            raise AssertionError("Parallel family is incomplete") from exc
        actual = release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        if expected is not None and actual != expected:
            # Preserve the repository's one pinned Windows checkout conversion.
            if name == "mobile/android/gradlew.bat" and manifest.get("mobile/.gitattributes") == ("100644", "69b47b5ade88fab2dd055b3cfa0858766fb17a47"):
                raw = raw.replace(b"\r\n", b"\n")
                actual = release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
            if actual != expected:
                raise AssertionError("Parallel family has unreviewed bytes: " + name)
    return {name: blob for name, (_, blob) in manifest.items() if blob is not None}


def exact_application_checkout(root, baseline, tree, controls):
    try:
        controls = set(controls) | benchmark_checkout_files(root)
        if checkout_git(root, "rev-parse", baseline + "^{tree}").decode().strip() != tree:
            return False
        changes = set(filter(None, checkout_git(root, "diff", "--name-only", "-z", baseline, "--").decode().split("\0")))
        staged = set(filter(None, checkout_git(root, "diff", "--cached", "--name-only", "-z", baseline, "--").decode().split("\0")))
        if (not changes <= controls or not staged <= controls
                or checkout_git(root, "ls-files", "--others", "--exclude-standard")
                or not all((root / name).is_file() and not (root / name).is_symlink()
                           for name in controls)):
            return False
        # Read actual bytes too: index assume-unchanged flags cannot conceal an
        # application edit and redirect this test to the historical snapshot.
        for record in checkout_git(root, "ls-tree", "-rz", "--full-tree", baseline).split(b"\0"):
            if not record:
                continue
            metadata, name = record.split(b"\t", 1)
            name = os.fsdecode(name)
            if name in controls:
                continue
            mode, kind, expected = metadata.split()
            file = root / name
            info = file.lstat()
            if kind != b"blob" or mode not in (b"100644", b"100755") or not stat.S_ISREG(info.st_mode):
                return False
            if bool(info.st_mode & 0o111) != (mode == b"100755"):
                return False
            raw = file.read_bytes()
            actual = release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest().encode()
            if actual != expected:
                # Only this baseline-pinned Windows Gradle path has a tracked
                # CRLF checkout contract. Never consult local info/attributes,
                # core.attributesFile or a configured clean/smudge filter.
                if (name != "mobile/android/gradlew.bat"
                        or checkout_git(root, "rev-parse", baseline + ":mobile/.gitattributes").decode().strip()
                        != "69b47b5ade88fab2dd055b3cfa0858766fb17a47"):
                    return False
                raw = raw.replace(b"\r\n", b"\n")
                if release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest().encode() != expected:
                    return False
        return True
    except (subprocess.CalledProcessError, OSError, ValueError):
        return False


def controls_only_checkout(root):
    return exact_application_checkout(root, CONTROL_CHECK_BASE, CONTROL_CHECK_TREE, CONTROL_CHECK_FILES)


def application_bytes(root, name, *, controls_only=False):
    if controls_only and name not in CONTROL_CHECK_FILES:
        if checkout_git(root, "rev-parse", REVIEWED_APP_SNAPSHOT + "^{tree}").decode().strip() != REVIEWED_APP_TREE:
            raise AssertionError("Independently reviewed application tree changed")
        return checkout_git(root, "show", REVIEWED_APP_SNAPSHOT + ":" + name)
    return (root / name).read_bytes()


def staged_family_pins(root):
    # Legacy recognition also validates the whole archive. Removing all parallel
    # markers cannot downgrade mixed new outputs into a three-file legacy match.
    failures = []
    for manifest, selected in legacy_staged_manifests():
        try:
            validate_staged_inventory(root, manifest)
            for name, (mode, expected) in manifest.items():
                path = root / name; info = path.lstat()
                if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                        or bool(info.st_mode & 0o111) != (mode == "100755")
                        or any(parent.is_symlink() for parent in (path, *path.parents))):
                    raise AssertionError("Staged family requires regular files")
                raw = path.read_bytes()
                actual = release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
                if expected is not None and actual != expected:
                    raise AssertionError("Mixed or unknown staged operator source family")
            return selected
        except (OSError, AssertionError) as exc:
            failures.append(str(exc))
    raise AssertionError("Mixed or unknown staged operator source family; complete regular files required")


OLD = "1" * 40
NEW = "2" * 40
ORIGINAL = release.ORIGINAL_TRANSFER_REVISION
TREE = "4" * 40
CREDENTIAL_COMMAND = (
    "busctl", "--system", "--timeout=10", "--no-pager", "--json=short",
    "get-property", "org.freedesktop.systemd1",
    "/org/freedesktop/systemd1/unit/becore_2dtickets_2eservice",
    "org.freedesktop.systemd1.Service", "LoadCredential")
CREDENTIAL_DOCUMENT = '{"type":"a(ss)","data":[["runtime.json","/etc/becore-tickets/runtime.json"]]}'
INVALID_CREDENTIAL_DOCUMENTS = (
    "", " \n", "[unprintable]", "runtime.json:/etc/becore-tickets/runtime.json",
    'a(ss) 1 "runtime.json" "/etc/becore-tickets/runtime.json"',
    "{", CREDENTIAL_DOCUMENT + " trailing", "null", "true", "[]", "{}",
    '{"data":[["runtime.json","/etc/becore-tickets/runtime.json"]]}',
    '{"type":"a(ss)"}',
    '{"type":"a(ss)","data":[]}',
    '{"type":"a(ss)","data":null}',
    '{"type":"a(ss)","data":"runtime.json:/etc/becore-tickets/runtime.json"}',
    '{"type":"a(ss)","data":["runtime.json","/etc/becore-tickets/runtime.json"]}',
    '{"type":"a(ss)","data":[["runtime.json"]]}',
    '{"type":"a(ss)","data":[["runtime.json","/etc/becore-tickets/runtime.json","extra"]]}',
    '{"type":"a(ss)","data":[[null,"/etc/becore-tickets/runtime.json"]]}',
    '{"type":"a(ss)","data":[["runtime.json",true]]}',
    CREDENTIAL_DOCUMENT.replace('"a(ss)"', '"as"'),
    CREDENTIAL_DOCUMENT.replace('"runtime.json"', '"other.json"'),
    CREDENTIAL_DOCUMENT.replace('/etc/becore-tickets/runtime.json', 'etc/becore-tickets/runtime.json'),
    CREDENTIAL_DOCUMENT.replace('/etc/becore-tickets/runtime.json', '/run/becore-tickets-runtime/runtime.json'),
    CREDENTIAL_DOCUMENT.replace('/etc/becore-tickets/runtime.json', '/etc/becore-tickets/runtime.json.bak'),
    CREDENTIAL_DOCUMENT.replace('/etc/becore-tickets/runtime.json', '/etc/becore-tickets/../becore-tickets/runtime.json'),
    CREDENTIAL_DOCUMENT.replace(']]}', '],["runtime.json","/etc/becore-tickets/runtime.json"]]}'),
    CREDENTIAL_DOCUMENT.replace(']]}', '],["extra.json","/etc/becore-tickets/extra.json"]]}'),
    CREDENTIAL_DOCUMENT.replace(']}', '],"extra":true}'),
    CREDENTIAL_DOCUMENT.replace('"type":', '"type":"a(ss)","type":'),
    CREDENTIAL_DOCUMENT.replace('"data":', '"data":[],"data":'),
)


class FakeSystem(release.System):
    def __init__(self, root):
        self.root = root
        self.revision = OLD
        self.restarts = 0
        self.fail = None
        self.requests = []
        self.commands = []
        self.working_directory = str(root / "srv/becore-tickets/releases" / OLD)
        self.active_state = "active"
        self.need_daemon_reload = "no"
        self.credential_document = CREDENTIAL_DOCUMENT
        self.effective_checks = []

    def property(self, name):
        return {"WorkingDirectory": self.working_directory, "ActiveState": self.active_state,
                "NeedDaemonReload": self.need_daemon_reload}[name]

    def run(self, *args):
        self.commands.append(args)
        if args[0] == "busctl":
            if args != CREDENTIAL_COMMAND:
                raise AssertionError("Unexpected credential property command")
            return self.credential_document
        return ""

    def restart(self):
        self.restarts += 1
        override = self.root / "etc/systemd/system/becore-tickets.service.d/scanner-release.conf"
        self.working_directory = next(line.split("=", 1)[1] for line in override.read_text().splitlines()
                                      if line.startswith("WorkingDirectory="))
        self.revision = Path(self.working_directory).name
        if self.fail == "restart" and self.restarts == 1:
            raise RuntimeError("simulated restart failure")

    def request(self, path, public=False):
        self.requests.append((self.revision, path, public))
        if self.revision == NEW:
            if self.fail == "local" or (public and self.fail == "public"):
                raise RuntimeError("simulated unhealthy candidate")
            if self.fail == "route" and path == "/events":
                return 503, b"not ready"
        if path in ("/healthz", "/api/version"):
            return 200, json.dumps({"service": "becore-tickets", "revision": self.revision,
                                    "active": True, "runtime": "vps"}).encode()
        if path in ("/checkout-preview", "/api/payments/preview"):
            return (404 if self.revision == NEW else 200), b""
        return (403 if path.startswith("/api/admin/") else 200), b""

    def application_uid(self):
        return os.geteuid()

    def application_gid(self):
        return os.getegid()

    def verify_database_binding(self):
        pass

    def verify_effective_config(self, expected):
        self.effective_checks.append(expected)
        if self.fail == "effective-config" and self.revision == NEW:
            raise release.ReleaseError("effective configuration mismatch")

    def sleep(self):
        pass


class SystemCredentialTests(unittest.TestCase):
    def test_real_run_accepts_only_the_exact_typed_binding(self):
        documents = (CREDENTIAL_DOCUMENT + "\n", json.dumps({
            "data": [["runtime.json", "/etc/becore-tickets/runtime.json"]],
            "type": "a(ss)"}, indent=2))
        for document in documents:
            with self.subTest(document=document):
                with patch.object(release.subprocess, "check_output", return_value=document) as command:
                    release.System().verify_credential_binding()
                command.assert_called_once_with(
                    CREDENTIAL_COMMAND, text=True, stderr=subprocess.PIPE, timeout=90)

    def test_real_run_rejects_unprintable_malformed_or_noncanonical_bindings(self):
        for document in INVALID_CREDENTIAL_DOCUMENTS:
            with self.subTest(document=document):
                with patch.object(release.subprocess, "check_output", return_value=document) as command:
                    with self.assertRaisesRegex(release.ReleaseError, "credential bridge"):
                        release.System().verify_credential_binding()
                command.assert_called_once_with(
                    CREDENTIAL_COMMAND, text=True, stderr=subprocess.PIPE, timeout=90)

    def test_database_binding_requires_one_canonical_live_process_state_path(self):
        for raw in (b"TICKETS_STATE=/var/lib/becore-tickets\0OTHER=value\0",
                    b"TICKETS_STATE=/tmp/elsewhere\0", b"OTHER=value\0",
                    b"TICKETS_STATE=/tmp/elsewhere\0TICKETS_STATE=/var/lib/becore-tickets\0"):
            with self.subTest(raw=raw), patch.object(release.System, "property", return_value="123"):
                with patch.object(Path, "read_bytes", return_value=raw):
                    if raw.startswith(b"TICKETS_STATE=/var/lib/becore-tickets\0"):
                        release.System().verify_database_binding()
                    else:
                        with self.assertRaisesRegex(release.ReleaseError, "canonical Tickets database"):
                            release.System().verify_database_binding()

    def test_real_run_command_errors_fail_closed_without_exposing_output(self):
        failures = (
            subprocess.CalledProcessError(1, CREDENTIAL_COMMAND, output=CREDENTIAL_DOCUMENT,
                                          stderr="private diagnostic output"),
            subprocess.TimeoutExpired(CREDENTIAL_COMMAND, 90, output=CREDENTIAL_DOCUMENT),
            FileNotFoundError("private diagnostic output"),
            UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid output"),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                with patch.object(release.subprocess, "check_output", side_effect=failure) as command:
                    with self.assertRaisesRegex(release.ReleaseError, "credential bridge") as raised:
                        release.System().verify_credential_binding()
                self.assertEqual(str(raised.exception), "Canonical credential bridge could not be verified.")
                command.assert_called_once_with(
                    CREDENTIAL_COMMAND, text=True, stderr=subprocess.PIPE, timeout=90)


def retention_unit_fixture(unit):
    values = {"Id": unit, "LoadState": "loaded", "FragmentPath": "/etc/systemd/system/" + unit,
              "SourcePath": "", "DropInPaths": "", "NeedDaemonReload": "no", "Transient": "no"}
    if unit.endswith(".timer"):
        values["Unit"] = "becore-tickets-retention.service"
    else:
        values.update({"Type": "oneshot", "ExecStart": "{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 /srv/becore-tickets/current/operations/retention.py ; ignore_errors=no ; pid=0 ; code=exited ; status=0 }",
            "ExecStartPre": "", "ExecStartPost": "", "ExecCondition": "", "ExecStop": "", "ExecStopPost": "", "ExecReload": "",
            "KillMode": "control-group", "RemainAfterExit": "no", "ActiveState": "inactive", "SubState": "dead", "MainPID": "0", "ControlPID": "0"})
    return values


class SystemRetentionTests(unittest.TestCase):
    def run_metadata(self, transform=lambda unit, values: values):
        system = release.System()
        def response(*args):
            self.assertIn("--all", args)
            self.assertEqual(args[:2], ("systemctl", "show"))
            unit = args[2]
            values = transform(unit, retention_unit_fixture(unit))
            return "\n".join(key + "=" + value for key, value in values.items())
        with patch.object(system, "run", side_effect=response):
            return system.retention_state()

    def test_exact_fixed_units_keep_empty_properties_and_inactive_execution(self):
        self.assertEqual(len(self.run_metadata()), 2)

    def test_only_six_documented_empty_exec_array_omissions_are_normalized(self):
        optional = {"ExecStartPre", "ExecStartPost", "ExecCondition", "ExecStop", "ExecStopPost", "ExecReload"}
        expected = self.run_metadata()
        self.assertEqual(self.run_metadata(lambda unit, values: {key: value for key, value in values.items() if key not in optional}), expected)
        required = set(retention_unit_fixture("becore-tickets-retention.service")) - optional
        for missing in required:
            with self.subTest(missing=missing), self.assertRaises(release.ReleaseError):
                self.run_metadata(lambda unit, values: {key: value for key, value in values.items()
                                                       if unit.endswith(".timer") or key != missing})
        for hook in optional:
            with self.subTest(hook=hook), self.assertRaises(release.ReleaseError):
                self.run_metadata(lambda unit, values: {**values, hook: "unreviewed command"}
                                  if unit.endswith(".service") else values)

    def test_malformed_duplicate_and_oversized_unit_records_are_rejected(self):
        valid = "\n".join(key + "=" + value for key, value in retention_unit_fixture("becore-tickets-retention.service").items())
        for raw in (valid + "\nmalformed", valid + "\nMainPID=0", "x" * 16385):
            with patch.object(release.System, "run", return_value=raw), self.assertRaises(release.ReleaseError):
                release.System().retention_state()

    def test_active_stale_or_altered_unit_identity_is_rejected(self):
        bad = {"ActiveState": "active", "SubState": "start", "MainPID": "123", "ControlPID": "456",
               "KillMode": "process", "RemainAfterExit": "yes", "SourcePath": "/elsewhere",
               "DropInPaths": "/etc/override.conf", "NeedDaemonReload": "yes", "Transient": "yes",
               "FragmentPath": "/unreviewed", "ExecStartPre": "/unreviewed", "ExecStart": "unreviewed"}
        for key, value in bad.items():
            def change(unit, values):
                if unit.endswith(".service"):
                    values[key] = value
                return values
            with self.subTest(key=key), self.assertRaises(release.ReleaseError):
                self.run_metadata(change)
        with self.assertRaises(release.ReleaseError):
            self.run_metadata(lambda unit, values: {key: value for key, value in values.items() if value})
        with self.assertRaises(release.ReleaseError):
            self.run_metadata(lambda unit, values: {**values, "unrequested": "value"})


class DeploymentFixture(unittest.TestCase):
    def setUp(self):
        self.approval_patch = patch.object(release, "AuditReleaseApproval")
        self.approval_patch.start()
        self.addCleanup(self.approval_patch.stop)
        self.audit_evidence_patch = patch.object(release.Deployment, "verify_dependency_audit", return_value=b"{}")
        self.audit_evidence_patch.start()
        self.addCleanup(self.audit_evidence_patch.stop)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        home = self.root / "srv/becore-tickets"
        for name in (OLD, ORIGINAL):
            target = home / "releases" / name
            target.mkdir(parents=True)
            (target / "release.json").write_text(json.dumps({"revision": name, "dirty": False}))
        # Relative links exercise byte-for-byte rollback, not just resolved values.
        (home / "current").symlink_to("releases/" + OLD)
        (home / "previous").symlink_to("releases/" + ORIGINAL)
        journal = self.root / "var/lib/becore-tickets-handover/live-transfer.json"
        journal.parent.mkdir(parents=True)
        self.journal_before = (json.dumps({"phase": "active", "revision": ORIGINAL,
            "activeRevision": OLD, "configurationHash": "a" * 64,
            "transferId": "unchanged-transfer", "unrelated": {"preserve": True}}) + "\n").encode()
        release.atomic_write(journal, self.journal_before)
        handoff = self.root / "var/lib/becore-tickets/handoff.json"
        handoff.parent.mkdir(parents=True)
        release.atomic_write(handoff, b'{"source":"cloudflare","writer":"vps"}\n')
        config = self.root / "etc/becore-tickets/runtime.json"
        config.parent.mkdir(parents=True)
        self.config_before = b'{\n "ENVIRONMENT": "production", "SEEV_ENABLED":"true",\n "SEEV_ENVIRONMENT":"production", "SEEV_CHECKOUT_API_KEY":"secret-not-logged", "SEEV_WEBHOOK_SECRET":"also-private", "SEEV_CRYPTO_ENABLED" : "false"\n}\n'
        release.atomic_write(config, self.config_before)
        override = self.root / "etc/systemd/system/becore-tickets.service.d/scanner-release.conf"
        override.parent.mkdir(parents=True)
        self.override_before = ("# preserve scanner override\n[Service]\nWorkingDirectory=" + str(home / "releases" / OLD) + "\nExecStart=\nExecStart=/usr/bin/flock --nonblock /var/lib/becore-tickets/instance.lock " + str(home / "releases" / OLD) + "/bin/node " + str(home / "releases" / OLD) + "/server.mjs\n").encode()
        release.atomic_write(override, self.override_before, 0o640)
        release.atomic_write(override.parent / "private-configuration.conf", b"private bridge unchanged\n", 0o644)
        (self.root / "run/lock").mkdir(parents=True)
        self.archive = self.root / "runtime.tar.gz"
        self.make_archive()
        self.provenance = self.root / "provenance.json"
        self.proof = {"version": 1, "source": NEW, "expectedActive": OLD,
                      "archiveSha256": release.digest_file(self.archive), "ancestryVerified": True,
                      "sourceTree": TREE, "candidateTree": TREE, "dependencyAudit": {"status": "clean"}}
        release.write_json(self.provenance, self.proof)
        self.system = FakeSystem(self.root)
        self.deployment = self.new_deployment()

    def make_archive(self, manifest=None, extra=None):
        with tarfile.open(self.archive, "w:gz") as archive:
            files = {"release.json": json.dumps(manifest or {"revision": NEW, "dirty": False}).encode(),
                     "server.mjs": b"// verified server\n", "bin/node": b"test binary\n"}
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = 0o755 if name == "bin/node" else 0o644
                archive.addfile(member, io.BytesIO(data))
            if extra:
                for item in extra if isinstance(extra, list) else [extra]:
                    if isinstance(item, tuple):
                        member, data = item
                        member.size = len(data)
                        archive.addfile(member, io.BytesIO(data))
                    else:
                        archive.addfile(item)

    def new_deployment(self, **kwargs):
        values = dict(source=NEW, expected=OLD, run_id="123", attempt="1", archive=self.archive,
                      provenance=self.provenance, archive_digest=release.digest_file(self.archive),
                      provenance_digest=release.digest_file(self.provenance), root=self.root, system=self.system)
        values.update(kwargs)
        return release.Deployment(**values)

    def refresh_digests(self):
        self.proof["archiveSha256"] = release.digest_file(self.archive)
        release.write_json(self.provenance, self.proof)
        self.deployment = self.new_deployment()

    def prepared_failure(self):
        """Reproduce the old operator's prepared snapshot and empty directory."""
        failed = self.deployment
        failed.preflight()
        failed.snapshot.mkdir(mode=0o700)
        for name, raw in failed.before.items():
            release.atomic_write(failed.snapshot / (name + ".before"), raw)
        release.write_json(failed.snapshot / "pointers.before.json", failed.links)
        release.write_json(failed.snapshot / "modes.before.json", failed.modes)
        release.atomic_write(failed.snapshot / "provenance.json", failed.provenance.read_bytes())
        failed.evidence("prepared")
        failed.release.mkdir(mode=0o755)
        self.deployment = self.new_deployment(run_id="456", recover_prepared=failed.identity)
        return failed

    def assert_restored(self):
        d = self.deployment
        self.assertEqual(d.override.read_bytes(), self.override_before)
        self.assertEqual(stat.S_IMODE(d.override.stat().st_mode), 0o640)
        self.assertEqual(d.journal.read_bytes(), self.journal_before)
        self.assertEqual(d.config.read_bytes(), self.config_before)
        self.assertEqual(stat.S_IMODE(d.config.stat().st_mode), 0o600)
        self.assertEqual(os.readlink(d.home / "current"), "releases/" + OLD)
        self.assertEqual(os.readlink(d.home / "previous"), "releases/" + ORIGINAL)
        self.assertEqual(d.bridge.read_bytes(), b"private bridge unchanged\n")
        self.assertEqual(d.handoff.read_bytes(), b'{"source":"cloudflare","writer":"vps"}\n')

class RetentionProtectionTests(DeploymentFixture):
    third = "3" * 40

    def setUp(self):
        super().setUp()
        self.now = release.time.time()
        self.policy_root = Path(__file__).resolve().parent
        for name in release.RETENTION_HASHES:
            destination = (self.deployment.old_release / "operations" / name if name == "retention.py"
                           else self.root / "etc/systemd/system" / name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes((self.policy_root / name).read_bytes())
            destination.chmod(0o644)
        third = self.deployment.releases / self.third
        third.mkdir()
        self.age(OLD, 47.5)
        self.age(ORIGINAL, 63)
        self.age(self.third, 80)
        self.retention_archive()
        self.system.retention_state = lambda: {"fixture": "reviewed inactive units"}

    def age(self, name, hours):
        timestamp = self.now - hours * 3600
        os.utime(self.deployment.releases / name, (timestamp, timestamp))

    def retention_archive(self, changed=None, root_age=60):
        entries = []
        root = tarfile.TarInfo(".")
        root.type, root.mode, root.mtime = tarfile.DIRTYPE, 0o755, self.now - root_age
        entries.append(root)
        for name in release.RETENTION_HASHES:
            item = tarfile.TarInfo("operations/" + name)
            item.mode = 0o644
            raw = (self.policy_root / name).read_bytes()
            if name == changed:
                raw += b"\n"
            entries.append((item, raw))
        self.make_archive(extra=entries)
        self.refresh_digests()

    @contextmanager
    def held(self, mode=0o600):
        with self.deployment.lock.open("a") as lock:
            if mode is not None:
                os.fchmod(lock.fileno(), mode)
            lock.flush()
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.deployment._deployment_lock_fd = lock.fileno()
            try:
                yield self.deployment
            finally:
                self.deployment._deployment_lock_fd = None

    def test_installer_created_readable_lock_preserves_protection_without_chmod(self):
        previous = os.umask(0o022)
        try:
            with self.deployment.lock.open("a"):
                pass
        finally:
            os.umask(previous)
        self.assertEqual(stat.S_IMODE(self.deployment.lock.stat().st_mode), 0o644)
        with self.held(mode=None):
            self.assertEqual(self.deployment.transact()["released"], NEW)
        self.assertEqual(stat.S_IMODE(self.deployment.lock.stat().st_mode), 0o644)

    def test_safe_readable_modes_pass_but_writable_or_special_modes_fail(self):
        for mode in (0o600, 0o604, 0o640, 0o644):
            with self.subTest(mode=oct(mode)), self.held(mode=mode):
                self.deployment.preflight()
        for mode in (0o000, 0o200, 0o400, 0o620, 0o602, 0o666, 0o700, 0o644 | 0o111, 0o4600, 0o1600):
            with self.subTest(mode=oct(mode)), self.held(mode=mode):
                try:
                    with self.assertRaisesRegex(release.ReleaseError, "deployment lock changed"):
                        self.deployment.preflight()
                finally:
                    os.fchmod(self.deployment._deployment_lock_fd, 0o600)

    def test_unowned_lock_descriptor_is_rejected_before_transaction_mutations(self):
        with self.held(mode=0o644):
            metadata = list(os.fstat(self.deployment._deployment_lock_fd))
            metadata[4] += 1
            with patch.object(release.os, "fstat", return_value=os.stat_result(metadata)), self.assertRaisesRegex(release.ReleaseError, "deployment lock changed"):
                self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertFalse(self.deployment.release.exists())
        self.assertEqual(self.system.restarts, 0)

    def test_harmless_lock_truncation_does_not_change_held_inode_or_exclusion(self):
        original = Path.lstat
        changed = False
        def truncate_before_path_stat(path, *args, **kwargs):
            nonlocal changed
            if path == self.deployment.lock and not changed:
                changed = True
                path.write_bytes(b"ordinary lock metadata change\n")
            return original(path, *args, **kwargs)
        with self.held(mode=0o644), patch.object(Path, "lstat", truncate_before_path_stat):
            self.deployment.preflight()
            with self.deployment.lock.open("a") as competing, self.assertRaises(BlockingIOError):
                fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertTrue(changed)
        self.assertFalse(self.deployment.snapshot.exists())

    def test_replaced_hardlinked_and_symlinked_lock_paths_are_rejected(self):
        for kind in ("replacement", "hardlink", "symlink"):
            with self.subTest(kind=kind), self.held(mode=0o644):
                lock = self.deployment.lock
                saved = lock.with_name("original-lock")
                if kind == "hardlink":
                    os.link(lock, saved)
                else:
                    lock.rename(saved)
                    if kind == "replacement":
                        lock.write_bytes(b"")
                    else:
                        lock.symlink_to(saved.name)
                try:
                    with self.assertRaisesRegex(release.ReleaseError, "deployment lock changed"):
                        self.deployment.preflight()
                    self.assertFalse(self.deployment.snapshot.exists())
                finally:
                    if kind == "hardlink":
                        saved.unlink()
                    else:
                        lock.unlink()
                        saved.rename(lock)

    def test_old_previous_rank_two_survives_candidate_and_successful_pointer_rotation(self):
        with self.held():
            result = self.deployment.transact()
        self.assertEqual(result["released"], NEW)
        self.assertTrue((self.deployment.releases / ORIGINAL).is_dir())
        self.assertEqual(len(self.deployment._retention_proof["inventory"]), 3)
        self.assertIsNotNone(self.deployment._retention_proof["candidate"])

    def test_old_previous_rank_three_is_rejected_before_any_mutation(self):
        self.age(self.third, 50)
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "every pointer state"):
            self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertFalse(self.deployment.release.exists())
        self.assert_restored()

    def test_candidate_is_not_double_counted_or_assumed_to_be_newest(self):
        self.age(OLD, 0.01)
        self.retention_archive(root_age=120)
        with self.held() as deployment:
            deployment.preflight()
            deployment.unpack()
            deployment.retention_safe()
            inventory = deployment.retention_inventory()[0]
            self.assertEqual(sorted(inventory, key=lambda name: inventory[name][1], reverse=True)[:3], [OLD, NEW, ORIGINAL])
            deployment.retention_safe()

    def test_shared_current_previous_remains_protected_even_outside_newest_three(self):
        pointer = self.deployment.home / "previous"
        pointer.unlink()
        pointer.symlink_to("releases/" + OLD)
        self.age(ORIGINAL, 5)
        self.age(self.third, 10)
        with self.held():
            self.deployment.preflight()
            self.deployment.unpack()
            self.deployment.retention_safe()

    def test_existing_age_grace_still_works_without_policy_or_exclusive_proof(self):
        self.age(OLD, 1)
        self.age(ORIGINAL, 2)
        self.system.retention_state = lambda: (_ for _ in ()).throw(AssertionError("young path consulted retention policy"))
        self.deployment.preflight()
        self.assertIsNone(self.deployment._retention_proof)

    def test_exclusive_lock_and_inactive_cleaner_are_required_for_older_releases(self):
        with self.assertRaisesRegex(release.ReleaseError, "exclusive proof lock"):
            self.deployment.preflight()
        with self.held():
            self.system.retention_state = lambda: (_ for _ in ()).throw(release.ReleaseError("stale cleaner active"))
            with self.assertRaisesRegex(release.ReleaseError, "stale cleaner active"):
                self.deployment.preflight()
        self.assert_restored()

    def test_installed_candidate_and_unpacked_policy_bytes_must_match(self):
        installed = self.deployment.old_release / "operations/retention.py"
        original = installed.read_bytes()
        installed.write_bytes(original + b"\n")
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "Installed retention policy"):
            self.deployment.preflight()
        installed.write_bytes(original)
        self.retention_archive(changed="retention.py")
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "Candidate retention policy"):
            self.deployment.preflight()
        self.retention_archive()
        with self.held():
            self.deployment.preflight()
            self.deployment.unpack()
            (self.deployment.release / "operations/retention.py").write_bytes(original + b"\n")
            with self.assertRaisesRegex(release.ReleaseError, "Unpacked candidate retention policy"):
                self.deployment.retention_safe()

    def test_stale_archive_root_is_not_treated_as_fresh_candidate(self):
        self.retention_archive(root_age=48 * 3600)
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "archive root.*retention grace"):
            self.deployment.preflight()
        self.assertFalse(self.deployment.release.exists())

    def test_ties_unknown_entries_and_unsafe_directory_modes_reject(self):
        self.age(self.third, 63)
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "Tied retention timestamps"):
            self.deployment.preflight()
        self.age(self.third, 80)
        unknown = self.deployment.releases / "unreviewed"
        unknown.mkdir()
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "unexpected retention inventory"):
            self.deployment.preflight()
        unknown.rmdir()
        (self.deployment.releases / self.third).chmod(0o777)
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "unexpected retention inventory"):
            self.deployment.preflight()

    def test_later_unrelated_deletion_is_safe_but_addition_or_identity_drift_rejects(self):
        with self.held():
            self.deployment.preflight()
            self.deployment.unpack()
            self.deployment.retention_safe()
            (self.deployment.releases / self.third).rmdir()
            self.deployment.retention_safe()
            extra = self.deployment.releases / ("5" * 40)
            extra.mkdir()
            with self.assertRaisesRegex(release.ReleaseError, "identities drifted"):
                self.deployment.retention_safe()
            extra.rmdir()
            self.age(ORIGINAL, 62)
            with self.assertRaisesRegex(release.ReleaseError, "identities drifted"):
                self.deployment.retention_safe()

    def test_stale_cleaner_deleting_between_topology_and_inactive_observation_rejects(self):
        calls = 0
        def stale():
            nonlocal calls
            calls += 1
            if calls == 1:
                (self.deployment.releases / self.third).rmdir()
            return {"fixture": "inactive after old snapshot"}
        self.system.retention_state = stale
        with self.held(), self.assertRaises(release.ReleaseError):
            self.deployment.preflight()
        self.assertFalse(self.deployment.release.exists())
        self.assert_restored()

    def test_cleaner_state_changes_between_observations_reject(self):
        with patch.object(self.system, "retention_state", side_effect=[{"generation": 1}, {"generation": 2}]):
            with self.held(), self.assertRaisesRegex(release.ReleaseError, "inactive baseline"):
                self.deployment.preflight()

    def test_separately_read_pointers_cannot_expose_low_ranked_old_current_on_rollback(self):
        self.age(self.third, 40)
        self.age(ORIGINAL, 50)
        self.age(OLD, 70)
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "every pointer state"):
            self.deployment.preflight()

    def test_policy_inode_changes_and_symlinks_are_not_hidden_by_matching_content(self):
        path = self.deployment.old_release / "operations/retention.py"
        raw = path.read_bytes()
        with self.held():
            self.deployment.preflight()
            replacement = path.with_suffix(".replacement")
            replacement.write_bytes(raw)
            replacement.chmod(0o644)
            os.replace(replacement, path)
            with self.assertRaisesRegex(release.ReleaseError, "policy identity changed"):
                self.deployment.retention_safe()
        path.unlink()
        replacement.write_bytes(raw)
        path.symlink_to(replacement.name)
        self.deployment = self.new_deployment()
        with self.held(), self.assertRaises(release.ReleaseError):
            self.deployment.preflight()

    def test_bounded_inventory_requires_room_for_exactly_one_candidate(self):
        with self.held(), patch.object(release, "RETENTION_MAX_ENTRIES", 2), self.assertRaisesRegex(release.ReleaseError, "inventory exceeds"):
            self.deployment.preflight()
        with self.held(), patch.object(release, "RETENTION_MAX_ENTRIES", 3), self.assertRaisesRegex(release.ReleaseError, "prospective candidate"):
            self.deployment.preflight()

    def test_cleaner_starting_after_proof_preserves_targets_at_each_pointer_write(self):
        specification = importlib.util.spec_from_file_location("reviewed_retention_policy_fixture", self.policy_root / "retention.py")
        policy = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(policy)
        replace = release.replace_link
        seen = []
        def clean_after_pointer(path, target):
            replace(path, target)
            policy.clean(self.deployment.home, now=self.now + 3600)
            seen.append(path.name)
            self.assertTrue(self.deployment.old_release.is_dir())
            self.assertTrue((self.deployment.releases / ORIGINAL).is_dir())
        with self.held(), patch.object(release, "replace_link", side_effect=clean_after_pointer):
            self.deployment.transact()
        self.assertEqual(seen, ["previous", "current"])
        self.assertFalse((self.deployment.releases / self.third).exists())

    def test_apply_records_only_the_exclusively_held_lock_descriptor(self):
        def transaction():
            fd = self.deployment._deployment_lock_fd
            self.assertIsInstance(fd, int)
            with self.deployment.lock.open("a") as competing:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return "fixture-only"
        with patch.object(release.os, "geteuid", return_value=0), patch.object(self.deployment, "transact", side_effect=transaction):
            self.assertEqual(self.deployment.apply(), "fixture-only")
        self.assertIsNone(self.deployment._deployment_lock_fd)

    def test_old_rollback_targets_survive_failed_candidate_and_pointer_rollback(self):
        self.system.fail = "public"
        with self.held(), self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
            self.deployment.transact()
        self.assert_restored()
        self.assertTrue((self.deployment.releases / ORIGINAL).is_dir())


class DeploymentTests(DeploymentFixture):
    def test_success_preserves_original_handover_fields_and_canonical_config(self):
        result = self.deployment.transact()
        d = self.deployment
        self.assertEqual(result["released"], NEW)
        self.assertEqual(self.system.restarts, 1)
        record = json.loads(d.journal.read_bytes())
        expected = json.loads(self.journal_before)
        expected["activeRevision"] = NEW
        expected["lastCodeRelease"] = record["lastCodeRelease"]
        self.assertEqual(record, expected)
        self.assertEqual((d.home / "current").resolve(), d.release)
        self.assertEqual((d.home / "previous").resolve(), d.old_release)
        self.assertEqual(d.config.read_bytes(), self.config_before)
        self.assertEqual((d.snapshot / "override.before").read_bytes(), self.override_before)
        self.assertEqual(stat.S_IMODE(d.snapshot.stat().st_mode), 0o700)
        for snapshot in d.snapshot.iterdir():
            self.assertEqual(stat.S_IMODE(snapshot.stat().st_mode), 0o600)
        self.assertEqual(json.loads((d.snapshot / "result.json").read_text())["phase"], "verified")
        for public in (False, True):
            for route, _ in release.ROUTES:
                self.assertIn((NEW, route, public), self.system.requests)
            for route in ("/checkout-preview", "/api/payments/preview"):
                self.assertIn((NEW, route, public), self.system.requests)
        self.assertEqual(self.system.effective_checks, [self.config_before, self.config_before])

    def test_crypto_change_is_opt_in_private_and_byte_preserving(self):
        self.deployment = self.new_deployment(enable_crypto=True)
        self.deployment.transact()
        self.assertEqual(self.deployment.config.read_bytes(),
                         self.config_before.replace(b'"false"', b'"true"'))
        self.assertEqual((self.deployment.snapshot / "config.before").read_bytes(), self.config_before)
        self.assertNotIn("secret-not-logged", (self.deployment.snapshot / "result.json").read_text())

    def test_all_activation_failures_restore_old_override_and_exact_links(self):
        for failure in ("restart", "local", "public", "route", "effective-config"):
            with self.subTest(failure=failure):
                # Each failure uses a new private filesystem fixture.
                fixture = DeploymentTests()
                fixture.setUp()
                try:
                    fixture.system.fail = failure
                    fixture.deployment = fixture.new_deployment(enable_crypto=True)
                    with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                        fixture.deployment.transact()
                    fixture.assert_restored()
                    self.assertEqual(fixture.system.restarts, 2)
                    self.assertIn((OLD, "/healthz", True), fixture.system.requests)
                    self.assertEqual(json.loads((fixture.deployment.snapshot / "result.json").read_text())["phase"], "rolled-back")
                finally:
                    fixture.doCleanups()

    def test_failed_rollback_is_distinguished(self):
        self.system.fail = "public"
        with patch.object(self.system, "restart", side_effect=RuntimeError("system down")):
            with self.assertRaisesRegex(release.ReleaseError, "Rollback verification failed"):
                self.deployment.transact()
        self.assert_restored()
        self.assertEqual(json.loads((self.deployment.snapshot / "result.json").read_text())["phase"], "rollback-needs-attention")

    def test_journal_drift_fails_before_mutation(self):
        value = json.loads(self.journal_before)
        value["activeRevision"] = ORIGINAL
        release.write_json(self.deployment.journal, value)
        with self.assertRaisesRegex(release.ReleaseError, "journal"):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assertFalse(self.deployment.release.exists())

    def test_inactive_phase_fails_before_mutation(self):
        value = json.loads(self.journal_before)
        value["phase"] = "verified"
        release.write_json(self.deployment.journal, value)
        with self.assertRaises(release.ReleaseError):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)

    def test_pointer_drift_and_escape_are_rejected(self):
        for name, target in (("current", "releases/" + ORIGINAL), ("previous", str(self.root))):
            pointer = self.deployment.home / name
            before = os.readlink(pointer)
            release.replace_link(pointer, target)
            with self.assertRaises(release.ReleaseError):
                self.deployment.preflight()
            release.replace_link(pointer, before)
        self.assertEqual(self.system.restarts, 0)

    def test_service_directory_drift_rejected(self):
        self.system.working_directory = str(self.root)
        with self.assertRaisesRegex(release.ReleaseError, "working directory"):
            self.deployment.preflight()

    def test_missing_private_bridge_rejected(self):
        self.deployment.bridge.unlink()
        with self.assertRaises(FileNotFoundError):
            self.deployment.preflight()
        self.assertEqual(self.system.restarts, 0)

    def test_missing_load_credential_rejected(self):
        self.system.credential_document = ""
        with self.assertRaisesRegex(release.ReleaseError, "credential bridge"):
            self.deployment.preflight()

    def test_pending_or_unknown_daemon_reload_rejected_before_mutation(self):
        self.deployment = self.new_deployment(enable_crypto=True)
        for state in ("yes", "", "unknown", "no\nyes"):
            with self.subTest(state=state):
                self.system.need_daemon_reload = state
                with self.assertRaisesRegex(release.ReleaseError, "daemon-reload"):
                    self.deployment.transact()
                self.assert_restored()
                self.assertEqual(self.system.restarts, 0)
                self.assertFalse(self.deployment.release.exists())
                self.assertFalse(self.deployment.snapshot.exists())
                self.assertEqual(self.system.commands, [])
                self.assertEqual(self.system.effective_checks, [])

    def test_rejected_credential_binding_never_mutates_release_state(self):
        self.deployment = self.new_deployment(enable_crypto=True)
        for document in INVALID_CREDENTIAL_DOCUMENTS:
            with self.subTest(document=document):
                self.system.credential_document = document
                with self.assertRaisesRegex(release.ReleaseError, "credential bridge"):
                    self.deployment.transact()
                self.assert_restored()
                self.assertEqual(self.system.restarts, 0)
                self.assertFalse(self.deployment.release.exists())
                self.assertFalse(self.deployment.snapshot.exists())
                self.assertEqual(self.system.effective_checks, [])
        self.assertEqual(self.system.commands,
                         [CREDENTIAL_COMMAND] * len(INVALID_CREDENTIAL_DOCUMENTS))

    def test_credential_command_failure_never_mutates_release_state(self):
        self.deployment = self.new_deployment(enable_crypto=True)
        with patch.object(self.system, "run", side_effect=subprocess.CalledProcessError(
                1, CREDENTIAL_COMMAND, output=CREDENTIAL_DOCUMENT)) as command:
            with self.assertRaisesRegex(release.ReleaseError, "credential bridge"):
                self.deployment.transact()
        command.assert_called_once_with(*CREDENTIAL_COMMAND)
        self.assert_restored()
        self.assertEqual(self.system.restarts, 0)
        self.assertFalse(self.deployment.release.exists())
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertEqual(self.system.effective_checks, [])

    def test_public_revision_mismatch_rejected_before_mutation(self):
        request = self.system.request
        def mismatched(path, public=False):
            if public:
                return 200, json.dumps({"service": "becore-tickets", "revision": NEW,
                                       "active": True, "runtime": "vps"}).encode()
            return request(path, public)
        with patch.object(self.system, "request", side_effect=mismatched):
            with self.assertRaisesRegex(release.ReleaseError, "health identity"):
                self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.restarts, 0)

    def test_configuration_mode_and_nonstring_values_rejected(self):
        self.deployment.config.chmod(0o644)
        with self.assertRaisesRegex(release.ReleaseError, "0600"):
            self.deployment.preflight()
        release.atomic_write(self.deployment.config, b'{"ENVIRONMENT":"production","SEEV_CRYPTO_ENABLED":true}')
        with self.assertRaisesRegex(release.ReleaseError, "strings"):
            self.deployment.preflight()

    def test_crypto_requires_existing_production_provider_setup(self):
        values = json.loads(self.config_before)
        values["SEEV_ENVIRONMENT"] = "sandbox"
        release.write_json(self.deployment.config, values)
        with self.assertRaisesRegex(release.ReleaseError, "not ready"):
            self.new_deployment(enable_crypto=True).preflight()

    def test_existing_release_and_existing_evidence_block_blind_retry(self):
        for target in (self.deployment.release, self.deployment.snapshot):
            target.mkdir()
            with self.assertRaisesRegex(release.ReleaseError, "already exists"):
                self.deployment.preflight()
            target.rmdir()

    def test_prepared_recovery_quarantines_only_the_proven_empty_directory(self):
        failed = self.prepared_failure()
        before = {path.name: path.read_bytes() for path in failed.snapshot.iterdir()}
        inode = failed.release.stat().st_ino
        with patch("builtins.print") as output:
            result = self.deployment.transact()
        self.assertEqual(result["released"], NEW)
        quarantine = failed.snapshot / "empty-release.quarantined"
        self.assertEqual(quarantine.stat().st_ino, inode)
        self.assertEqual(list(quarantine.iterdir()), [])
        self.assertEqual({path.name: path.read_bytes() for path in failed.snapshot.iterdir()
                          if path.is_file()}, before)
        self.assertEqual(json.loads((failed.snapshot / "result.json").read_text())["phase"], "prepared")
        self.assertEqual(json.loads((self.deployment.snapshot / "result.json").read_text())["phase"], "verified")
        output.assert_called_once()
        self.assertEqual(json.loads(output.call_args.args[0]), {
            "preparedRecovery": failed.identity, "phase": "prepared",
            "emptyCandidateConfirmed": True, "originalStateHashesMatch": True})
        self.assertNotIn("secret", output.call_args.args[0])
        self.assertEqual(self.system.restarts, 1)

    def test_prepared_recovery_accepts_the_original_directory_under_restrictive_umask(self):
        failed = self.prepared_failure()
        for mode in (0o700, 0o750, 0o755):
            with self.subTest(mode=mode):
                failed.release.chmod(mode)
                self.deployment.preflight()
        for mode in (0o775, 0o777, 0o4755, 0o655):
            with self.subTest(mode=mode):
                failed.release.chmod(mode)
                with self.assertRaisesRegex(release.ReleaseError, "original modes"):
                    self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertEqual(self.system.restarts, 0)

    def test_prepared_recovery_requires_exact_failed_identity_phase_and_hashes(self):
        failed = self.prepared_failure()
        record = json.loads((failed.snapshot / "result.json").read_text())
        for field, value in (("phase", "activating"), ("phase", "rolled-back"), ("phase", "verified"),
                             ("runId", "999"), ("attempt", "2"), ("source", OLD), ("previous", ORIGINAL),
                             ("archiveSha256", "b" * 64), ("provenanceSha256", "c" * 64),
                             ("cryptoEnabledRequested", True), ("dataMigration", True), ("extra", "field")):
            with self.subTest(field=field, value=value):
                release.write_json(failed.snapshot / "result.json", dict(record, **{field: value}))
                with self.assertRaisesRegex(release.ReleaseError, "exact failed transaction"):
                    self.deployment.transact()
                self.assertTrue(failed.release.is_dir())
                self.assertFalse((failed.snapshot / "empty-release.quarantined").exists())
                self.assertFalse(self.deployment.snapshot.exists())
                self.assertEqual(self.system.restarts, 0)
                self.assert_restored()

    def test_prepared_recovery_requires_exact_snapshot_bytes_pointers_modes_and_provenance(self):
        failed = self.prepared_failure()
        for name in ("config.before", "journal.before", "handoff.before", "override.before", "bridge.before",
                     "pointers.before.json", "modes.before.json", "provenance.json"):
            with self.subTest(name=name):
                path = failed.snapshot / name
                before = path.read_bytes()
                release.atomic_write(path, b"{}\n")
                with self.assertRaises(release.ReleaseError):
                    self.deployment.transact()
                release.atomic_write(path, before)
                self.assertFalse((failed.snapshot / "empty-release.quarantined").exists())
                self.assertFalse(self.deployment.snapshot.exists())
                self.assertEqual(self.system.restarts, 0)
                self.assert_restored()

    def test_prepared_recovery_rejects_live_drift_and_populated_candidate(self):
        failed = self.prepared_failure()
        release.atomic_write(self.deployment.config, self.config_before + b"\n")
        with self.assertRaisesRegex(release.ReleaseError, "snapshot differs"):
            self.deployment.transact()
        release.atomic_write(self.deployment.config, self.config_before)
        (failed.release / "unrelated").write_text("retain this data")
        with self.assertRaisesRegex(release.ReleaseError, "empty candidate"):
            self.deployment.transact()
        self.assertEqual((failed.release / "unrelated").read_text(), "retain this data")
        self.assertFalse((failed.snapshot / "empty-release.quarantined").exists())
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertEqual(self.system.restarts, 0)
        self.assert_restored()

    def test_prepared_recovery_rechecks_live_state_immediately_before_quarantine(self):
        failed = self.prepared_failure()
        self.deployment.preflight()
        release.atomic_write(self.deployment.config, self.config_before + b"\n")
        with self.assertRaisesRegex(release.ReleaseError, "Live input drifted"):
            self.deployment.quarantine_prepared()
        self.assertTrue(failed.release.is_dir())
        self.assertFalse((failed.snapshot / "empty-release.quarantined").exists())
        self.assertEqual(self.system.restarts, 0)

    def test_prepared_recovery_never_overwrites_or_accepts_incomplete_evidence(self):
        failed = self.prepared_failure()
        quarantine = failed.snapshot / "empty-release.quarantined"
        quarantine.mkdir()
        (quarantine / "preserve").write_text("old quarantine")
        with self.assertRaisesRegex(release.ReleaseError, "unexpected entries"):
            self.deployment.transact()
        self.assertEqual((quarantine / "preserve").read_text(), "old quarantine")
        (quarantine / "preserve").unlink()
        quarantine.rmdir()
        (failed.snapshot / "bridge.before").unlink()
        with self.assertRaisesRegex(release.ReleaseError, "missing or unexpected"):
            self.deployment.transact()
        self.assertTrue(failed.release.is_dir())
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertEqual(self.system.restarts, 0)

    def test_prepared_recovery_rejects_linked_directories_and_unowned_evidence(self):
        failed = self.prepared_failure()
        failed.release.rmdir()
        failed.release.symlink_to(failed.old_release)
        with self.assertRaisesRegex(release.ReleaseError, "owned real directories"):
            self.deployment.transact()
        failed.release.unlink()
        failed.release.mkdir()
        metadata = failed.snapshot.lstat()
        with patch.object(Path, "lstat", autospec=True, side_effect=lambda path: (
                os.stat_result(tuple([metadata.st_mode, metadata.st_ino, metadata.st_dev, metadata.st_nlink,
                                      os.geteuid() + 1, metadata.st_gid, metadata.st_size,
                                      metadata.st_atime, metadata.st_mtime, metadata.st_ctime]))
                if path == failed.snapshot else os.lstat(path))):
            with self.assertRaisesRegex(release.ReleaseError, "owned real directories"):
                self.deployment.transact()
        self.assertFalse((failed.snapshot / "empty-release.quarantined").exists())
        self.assertEqual(self.system.restarts, 0)

    def test_prepared_recovery_rejects_unsafe_archive_before_quarantine(self):
        unsafe = tarfile.TarInfo("unsafe")
        unsafe.type = tarfile.FIFOTYPE
        self.make_archive(extra=unsafe)
        self.refresh_digests()
        failed = self.prepared_failure()
        with self.assertRaisesRegex(release.ReleaseError, "Unsafe archive member"):
            self.deployment.transact()
        self.assertTrue(failed.release.is_dir())
        self.assertFalse((failed.snapshot / "empty-release.quarantined").exists())
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertEqual(self.system.restarts, 0)

    def test_prepared_recovery_identity_is_explicit_and_bounded(self):
        self.assertIsNone(self.new_deployment(recover_prepared="").recover_prepared)
        for identity in ("123-1", "../123-1", "123-1/child", "123", "0-1", "123-0", "123-1\n"):
            with self.subTest(identity=identity):
                with self.assertRaisesRegex(release.ReleaseError, "recovery identity"):
                    self.new_deployment(recover_prepared=identity)

    def test_digest_tampering_rejected(self):
        self.archive.write_bytes(self.archive.read_bytes() + b"tampered")
        with self.assertRaisesRegex(release.ReleaseError, "digest"):
            self.deployment.preflight()

    def test_manifest_sha_and_dirty_guard_before_restart(self):
        self.make_archive({"revision": NEW, "dirty": True})
        self.refresh_digests()
        with self.assertRaisesRegex(release.ReleaseError, "Manifest"):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assert_restored()

    def test_archive_traversal_rejected_before_any_live_change(self):
        member = tarfile.TarInfo("../../outside")
        self.make_archive(extra=member)
        self.refresh_digests()
        with self.assertRaisesRegex(release.ReleaseError, "escapes"):
            self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.restarts, 0)
        self.assertFalse(self.deployment.release.exists())

    def test_archive_escaping_symlink_rejected(self):
        member = tarfile.TarInfo("escape")
        member.type = tarfile.SYMTYPE
        member.linkname = "/etc"
        self.make_archive(extra=member)
        self.refresh_digests()
        with self.assertRaises(tarfile.FilterError):
            self.deployment.transact()
        self.assert_restored()
        self.assertFalse(self.deployment.release.exists())

    def test_archive_gnu_tar_esbuild_hardlink_to_earlier_regular_file_permitted(self):
        target = tarfile.TarInfo("./node_modules/@esbuild/linux-x64/bin/esbuild")
        target.mode = 0o755
        link = tarfile.TarInfo("./node_modules/esbuild/bin/esbuild")
        link.type = tarfile.LNKTYPE
        link.linkname = target.name
        link.mode = 0o755
        alias = tarfile.TarInfo("./node_modules/.bin/esbuild")
        alias.type = tarfile.SYMTYPE
        alias.linkname = "../esbuild/bin/esbuild"
        self.make_archive(extra=[(target, b"packaged esbuild binary\n"), link, alias])
        self.refresh_digests()
        self.deployment.transact()
        binary = self.deployment.release / link.name
        self.assertEqual(binary.read_bytes(), b"packaged esbuild binary\n")
        self.assertEqual(binary.stat().st_ino, (self.deployment.release / target.name).stat().st_ino)
        self.assertEqual(binary.stat().st_nlink, 2)
        self.assertEqual((self.deployment.release / alias.name).read_bytes(), binary.read_bytes())

    def test_archive_unsafe_hardlinks_fail_before_creating_release(self):
        directory = tarfile.TarInfo("directory")
        directory.type = tarfile.DIRTYPE
        symlink = tarfile.TarInfo("node-symlink")
        symlink.type = tarfile.SYMTYPE
        symlink.linkname = "bin/node"
        for target in ("/bin/node", "../../outside", "bin/../bin/node", "missing", "future",
                       "alias", "directory", "node-symlink", "release.json"):
            with self.subTest(target=target):
                link = tarfile.TarInfo("alias")
                link.type = tarfile.LNKTYPE
                link.linkname = target
                self.make_archive(extra=[directory, symlink, link, (tarfile.TarInfo("future"), b"later")])
                with self.assertRaisesRegex(release.ReleaseError, "hardlink"):
                    self.deployment.unpack()
                self.assertFalse(self.deployment.release.exists())
                self.assertEqual(self.system.commands, [])

    def test_archive_hardlink_chains_cycles_and_nonzero_payload_rejected(self):
        first = tarfile.TarInfo("first")
        first.type = tarfile.LNKTYPE
        second = tarfile.TarInfo("second")
        second.type = tarfile.LNKTYPE
        second.linkname = "first"
        for target in ("bin/node", "second"):
            with self.subTest(target=target):
                first.linkname = target
                self.make_archive(extra=[first, second])
                with self.assertRaisesRegex(release.ReleaseError, "hardlink"):
                    self.deployment.unpack()
                self.assertFalse(self.deployment.release.exists())
        first.linkname = "bin/node"
        first.size = 1
        self.make_archive(extra=[first])
        with self.assertRaisesRegex(release.ReleaseError, "hardlink"):
            self.deployment.unpack()
        self.assertFalse(self.deployment.release.exists())

    def test_archive_special_members_and_duplicate_paths_rejected_before_mkdir(self):
        for kind in (tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE, b"s"):
            with self.subTest(kind=kind):
                member = tarfile.TarInfo("unsafe")
                member.type = kind
                self.make_archive(extra=member)
                with self.assertRaisesRegex(release.ReleaseError, "Unsafe archive"):
                    self.deployment.unpack()
                self.assertFalse(self.deployment.release.exists())
        self.make_archive(extra=tarfile.TarInfo("./bin/node"))
        with self.assertRaisesRegex(release.ReleaseError, "duplicate"):
            self.deployment.unpack()
        self.assertFalse(self.deployment.release.exists())

    def test_archive_member_cannot_traverse_a_link_parent(self):
        parent = tarfile.TarInfo("alias")
        parent.type = tarfile.SYMTYPE
        parent.linkname = "bin"
        self.make_archive(extra=[parent, (tarfile.TarInfo("alias/child"), b"unsafe")])
        with self.assertRaisesRegex(release.ReleaseError, "non-directory parent"):
            self.deployment.unpack()
        self.assertFalse(self.deployment.release.exists())

    def test_archive_internal_node_module_symlink_permitted(self):
        member = tarfile.TarInfo("node-alias")
        member.type = tarfile.SYMTYPE
        member.linkname = "bin/node"
        self.make_archive(extra=member)
        self.refresh_digests()
        self.deployment.transact()
        self.assertEqual((self.deployment.release / "node-alias").resolve(), self.deployment.release / "bin/node")

    def test_lock_contention_does_not_enter_transaction(self):
        with open(self.deployment.lock, "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(release.os, "geteuid", return_value=0), patch.object(self.deployment, "transact") as transaction:
                with self.assertRaisesRegex(release.ReleaseError, "holds the lock"):
                    self.deployment.apply()
                transaction.assert_not_called()


    def test_old_pointers_stay_pinned_until_candidate_is_ready(self):
        d = self.deployment
        request = self.system.request
        def inspect(path, public=False):
            if self.system.revision == NEW:
                self.assertEqual(os.readlink(d.home / "current"), "releases/" + OLD)
                self.assertEqual(os.readlink(d.home / "previous"), "releases/" + ORIGINAL)
            return request(path, public)
        with patch.object(self.system, "request", side_effect=inspect):
            d.transact()

    def test_stale_rollback_target_is_rejected_before_activation(self):
        old_previous = self.deployment.releases / ORIGINAL
        os.utime(old_previous, (1, 1))
        with self.assertRaisesRegex(release.ReleaseError, "retention grace"):
            self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.restarts, 0)

    def test_scanner_override_unknown_directives_fail_closed(self):
        release.atomic_write(self.deployment.override, self.override_before + b"Environment=UNVETTED=1\n", 0o640)
        with self.assertRaisesRegex(release.ReleaseError, "unvetted directives"):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)

    def test_success_changes_only_existing_override_release_path_bytes(self):
        self.deployment.transact()
        expected = self.override_before.replace(str(self.deployment.old_release).encode(),
                                                str(self.deployment.release).encode())
        self.assertEqual(self.deployment.override.read_bytes(), expected)
        self.assertEqual(stat.S_IMODE(self.deployment.override.stat().st_mode), 0o640)

    def test_external_journal_drift_is_preserved_and_reported(self):
        d = self.deployment
        original = self.system.verify_effective_config
        external = b'{"external":"journal-update"}\n'
        def drift(config):
            original(config)
            if self.system.revision == NEW:
                release.atomic_write(d.journal, external)
        with patch.object(self.system, "verify_effective_config", side_effect=drift):
            with self.assertRaisesRegex(release.ReleaseError, "Rollback verification failed"):
                d.transact()
        self.assertEqual(d.journal.read_bytes(), external)
        self.assertEqual(d.override.read_bytes(), self.override_before)
        self.assertEqual(os.readlink(d.home / "current"), "releases/" + OLD)

    def test_external_configuration_drift_is_never_overwritten(self):
        d = self.new_deployment(enable_crypto=True)
        original = self.system.verify_effective_config
        external = b'{"external":"configuration-update"}\n'
        def drift(config):
            original(config)
            if self.system.revision == NEW:
                release.atomic_write(d.config, external)
        with patch.object(self.system, "verify_effective_config", side_effect=drift):
            with self.assertRaisesRegex(release.ReleaseError, "Rollback verification failed"):
                d.transact()
        self.assertEqual(d.config.read_bytes(), external)
        self.assertEqual(d.journal.read_bytes(), self.journal_before)

    def test_own_journal_write_is_restored_if_final_evidence_write_fails(self):
        d = self.deployment
        evidence = d.evidence
        def fail_last(phase):
            if phase == "verified":
                raise OSError("simulated evidence disk error")
            evidence(phase)
        with patch.object(d, "evidence", side_effect=fail_last):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                d.transact()
        self.assert_restored()

    def test_operator_interruption_rolls_back_the_original_override(self):
        with patch.object(self.system, "verify_effective_config", side_effect=[None, KeyboardInterrupt(), None]):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                self.deployment.transact()
        self.assert_restored()

    def test_preview_retirement_failure_can_restore_old_preview_release(self):
        request = self.system.request
        def still_available(path, public=False):
            if path == "/checkout-preview":
                return 200, b"old preview"
            return request(path, public)
        with patch.object(self.system, "request", side_effect=still_available):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.restarts, 2)
        self.assertIn((OLD, "/healthz", True), self.system.requests)
        for public in (False, True):
            for route in ("/checkout-preview", "/api/payments/preview"):
                self.assertNotIn((OLD, route, public), self.system.requests)

    def test_candidate_requires_direct_404_for_each_retired_route_locally_and_publicly(self):
        self.system.revision = NEW
        request = self.system.request
        for route in ("/checkout-preview", "/api/payments/preview"):
            for public in (False, True):
                for status_code in (200, 302, 403, 405, 410, 500):
                    with self.subTest(route=route, public=public, status=status_code):
                        def unexpected(path, is_public=False):
                            if path == route and is_public == public:
                                return status_code, b"unexpected retired route"
                            return request(path, is_public)
                        with patch.object(self.system, "request", side_effect=unexpected):
                            with self.assertRaisesRegex(release.ReleaseError, "Retired checkout preview route"):
                                release.ready(self.system, NEW, candidate=True)

    def test_smoke_checks_never_request_canceled_paths(self):
        self.deployment.transact()
        self.assertNotIn("/scan", [path for _, path, _ in self.system.requests])
        self.assertNotIn("/my-nights", [path for _, path, _ in self.system.requests])


class AdditiveMigrationTests(unittest.TestCase):
    SQL = b"CREATE TABLE new_evidence (id TEXT PRIMARY KEY, status TEXT NOT NULL);\nCREATE INDEX new_evidence_status ON new_evidence (status);\n"

    @classmethod
    def specification(cls, raw=None, tables=None, triggers=None):
        raw = cls.SQL if raw is None else raw
        with release.sqlite3.connect(":memory:") as database:
            if triggers:
                database.execute("CREATE TABLE payment_refunds (order_id TEXT, status TEXT)")
            existing = release.schema_rows(database)
            database.executescript(raw.decode())
            digest = release.schema_digest([row for row in release.schema_rows(database) if row not in existing])
        result = {"path": "drizzle/test.sql", "blob": "5" * 40,
                  "sha256": release.hashlib.sha256(raw).hexdigest(), "schemaSha256": digest,
                  "tables": tables or ["new_evidence"]}
        if triggers:
            result["triggers"] = triggers
        return result

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "tickets.sqlite"
        with release.sqlite3.connect(self.database) as database:
            database.execute("CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
            database.execute("INSERT INTO orders VALUES ('preserved-order', 'paid')")
        self.database.chmod(0o600)
        self.staging = self.root / "backup"
        self.spec = self.specification()

    def migrate(self):
        return release.migrate_database(self.database, self.staging, [(self.spec, self.SQL)])

    def test_additive_transaction_preserves_rows_and_has_private_verified_prechange_backup(self):
        result = self.migrate()
        self.assertEqual(result["phase"], "verified")
        self.assertTrue(result["created"])
        self.assertTrue(result["tablesPreservedOnRollback"])
        self.assertEqual(stat.S_IMODE(self.staging.stat().st_mode), 0o700)
        backup = self.staging / "before.sqlite"
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assertEqual(release.digest_file(backup), result["backupSha256"])
        with release.sqlite3.connect(self.database) as database:
            self.assertEqual(database.execute("SELECT * FROM orders").fetchall(), [("preserved-order", "paid")])
            self.assertEqual(database.execute("SELECT COUNT(*) FROM new_evidence").fetchone(), (0,))
        with release.sqlite3.connect(backup) as database:
            self.assertEqual(database.execute("SELECT * FROM orders").fetchall(), [("preserved-order", "paid")])
            self.assertEqual([row[1] for row in release.schema_rows(database)], ["orders"])

    def test_reapplication_preserves_new_data_and_verifies_identical_schema(self):
        self.migrate()
        with release.sqlite3.connect(self.database) as database:
            database.execute("INSERT INTO new_evidence VALUES ('job', 'done')")
        self.staging = self.root / "second-backup"
        result = self.migrate()
        self.assertFalse(result["created"])
        with release.sqlite3.connect(self.database) as database:
            self.assertEqual(database.execute("SELECT * FROM new_evidence").fetchall(), [("job", "done")])

    def test_partial_or_drifted_schema_aborts_without_row_changes(self):
        for sql in ("CREATE TABLE new_evidence(id TEXT PRIMARY KEY, status TEXT NOT NULL)",
                    "CREATE TABLE new_evidence(id INTEGER PRIMARY KEY, private TEXT)"):
            with self.subTest(sql=sql):
                with release.sqlite3.connect(self.database) as database:
                    database.execute(sql)
                with self.assertRaisesRegex(release.ReleaseError, "partial or differs"):
                    self.migrate()
                with release.sqlite3.connect(self.database) as database:
                    self.assertEqual(database.execute("SELECT * FROM orders").fetchall(), [("preserved-order", "paid")])
                    database.execute("DROP TABLE new_evidence")
                self.staging = self.root / "second-backup"

    def test_unreviewed_content_or_schema_is_rejected_before_backup_or_mutation(self):
        for key, value in (("sha256", "a" * 64), ("schemaSha256", "b" * 64), ("tables", ["orders"])):
            with self.subTest(key=key):
                specification = dict(self.spec, **{key: value})
                with self.assertRaises(release.ReleaseError):
                    release.migrate_database(self.database, self.staging, [(specification, self.SQL)])
                self.assertFalse(self.staging.exists())

    def test_exact_reviewed_refund_guard_is_additive_and_preserves_existing_schema_and_rows(self):
        trigger = b"""CREATE TRIGGER `provider_refund_reservation_guard`
BEFORE INSERT ON `payment_refunds`
WHEN NEW.status IN ('pending','processing') AND EXISTS (
  SELECT 1 FROM new_evidence WHERE id=NEW.order_id AND status='completed'
)
BEGIN
  SELECT RAISE(ABORT, 'External refund already recorded.');
END;
"""
        raw = self.SQL + trigger
        specification = self.specification(raw, triggers={"provider_refund_reservation_guard": "payment_refunds"})
        with release.sqlite3.connect(self.database) as database:
            database.execute("CREATE TABLE payment_refunds (order_id TEXT, status TEXT)")
            database.execute("INSERT INTO payment_refunds VALUES ('old-refund', 'processed')")
            before = release.schema_rows(database)
        release.migrate_database(self.database, self.staging, [(specification, raw)])
        with release.sqlite3.connect(self.database) as database:
            after = release.schema_rows(database)
            self.assertTrue(all(row in after for row in before))
            self.assertEqual(database.execute("SELECT * FROM payment_refunds").fetchall(), [("old-refund", "processed")])
            database.execute("INSERT INTO new_evidence VALUES ('refunded-order', 'completed')")
            for status in ("pending", "processing"):
                with self.assertRaises(release.sqlite3.IntegrityError):
                    database.execute("INSERT INTO payment_refunds VALUES (?,?)", ("refunded-order", status))
            database.execute("INSERT INTO payment_refunds VALUES ('refunded-order','failed')")
            database.execute("INSERT INTO payment_refunds VALUES ('other-order','pending')")
        with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
            release.additive_statements(raw.replace(b"RAISE(ABORT", b"RAISE(FAIL"), specification)
        with self.assertRaisesRegex(release.ReleaseError, "unreviewed existing-table trigger"):
            release.additive_statements(raw, dict(specification, triggers={}))
        with self.assertRaisesRegex(release.ReleaseError, "refund rollback guard"):
            release.additive_statements(raw, dict(specification, triggers={"provider_refund_reservation_guard": "orders"}))

    def test_exact_owner_guard_preserves_rows_and_survives_code_rollback(self):
        raw = b"-- Keep an active master account even when separate owner requests race.\n-- This additive guard applies to the existing account update path as well as\n-- future writers; the application's DELETE path already checks atomically.\nCREATE TRIGGER staff_last_active_owner_update_guard\nBEFORE UPDATE OF role, status ON staff_accounts\nWHEN OLD.role = 'owner' AND OLD.status = 'active'\n  AND (NEW.role <> 'owner' OR NEW.status <> 'active')\n  AND (SELECT COUNT(*) FROM staff_accounts WHERE role = 'owner' AND status = 'active') <= 1\nBEGIN\n  SELECT RAISE(ABORT, 'Keep at least one active master account.');\nEND;\n"
        specification = release.migration_plan([release.STAFF_OWNER_GUARD_PATH])[0]
        with release.sqlite3.connect(self.database) as database:
            database.execute("CREATE TABLE staff_accounts (id TEXT PRIMARY KEY, role TEXT, status TEXT)")
            database.execute("INSERT INTO staff_accounts VALUES ('owner', 'owner', 'active')")
            before = release.schema_rows(database)
        result = release.migrate_database(self.database, self.staging, [(specification, raw)])
        self.assertTrue(result["created"])
        self.assertTrue(result["tablesPreservedOnRollback"])
        with release.sqlite3.connect(self.database) as database:
            self.assertTrue(all(row in release.schema_rows(database) for row in before))
            self.assertEqual(database.execute("SELECT * FROM staff_accounts").fetchall(), [("owner", "owner", "active")])
            for update in ("role='finance'", "status='disabled'"):
                with self.assertRaises(release.sqlite3.IntegrityError):
                    database.execute("UPDATE staff_accounts SET " + update + " WHERE id='owner'")
            database.execute("INSERT INTO staff_accounts VALUES ('second', 'owner', 'active')")
            database.execute("UPDATE staff_accounts SET role='finance' WHERE id='owner'")
            with self.assertRaises(release.sqlite3.IntegrityError):
                database.execute("UPDATE staff_accounts SET status='disabled' WHERE id='second'")
        second = release.migrate_database(self.database, self.root / "repeat", [(specification, raw)])
        self.assertFalse(second["created"])
        for altered in (raw.replace(b"RAISE(ABORT", b"RAISE(FAIL"), raw + b"DELETE FROM staff_accounts;\n"):
            with self.assertRaisesRegex(release.ReleaseError, "exact reviewed source"):
                release.reviewed_migration(altered, specification)
        for changed in (dict(specification, tables=["staff_accounts"]),
                        dict(specification, triggers={"staff_last_active_owner_update_guard": "orders"})):
            with self.assertRaisesRegex(release.ReleaseError, "exact reviewed source"):
                release.reviewed_migration(raw, changed)
        with self.assertRaises(release.ReleaseError):
            release.reviewed_migration(raw, dict(specification, path="drizzle/unreviewed.sql"))

    def test_create_only_validator_rejects_all_other_statement_classes(self):
        statements = ("DROP TABLE orders;", "DELETE FROM orders;", "UPDATE orders SET status='bad';",
                      "ALTER TABLE orders ADD COLUMN unsafe TEXT;", "PRAGMA user_version=9;",
                      "ATTACH DATABASE ':memory:' AS other;", "CREATE VIEW leaked AS SELECT * FROM orders;",
                      "CREATE TRIGGER change_rows AFTER INSERT ON orders BEGIN DELETE FROM orders; END;",
                      "CREATE TABLE new_evidence AS SELECT * FROM orders;",
                      "CREATE INDEX unsafe ON orders (id);")
        for statement in statements:
            raw = statement.encode()
            specification = dict(self.spec, sha256=release.hashlib.sha256(raw).hexdigest())
            with self.subTest(statement=statement), self.assertRaises(release.ReleaseError):
                release.additive_statements(raw, specification)

    def test_overlapping_schema_plans_fail_before_any_mutation(self):
        # A cross-plan object collision is rejected before touching the database.
        with self.assertRaisesRegex(release.ReleaseError, "overlap"):
            release.migrate_database(self.database, self.staging, [(self.spec, self.SQL), (self.spec, self.SQL)])
        self.assertFalse(self.staging.exists())
        with release.sqlite3.connect(self.database) as database:
            self.assertEqual([row[1] for row in release.schema_rows(database)], ["orders"])

    def test_midtransaction_error_rolls_back_created_objects_without_touching_customer_rows(self):
        connect = release.sqlite3.connect
        class FailingConnection:
            def __init__(self, connection):
                self.connection = connection
            def __enter__(self):
                self.connection.__enter__()
                return self
            def __exit__(self, *args):
                return self.connection.__exit__(*args)
            def __getattr__(self, name):
                return getattr(self.connection, name)
            def execute(self, statement, *args):
                if statement.startswith("CREATE INDEX new_evidence_status"):
                    raise release.sqlite3.OperationalError("simulated additive-index failure")
                return self.connection.execute(statement, *args)
        def failing_connect(filename, *args, **kwargs):
            connection = connect(filename, *args, **kwargs)
            return FailingConnection(connection) if str(filename).startswith(self.database.as_uri()) else connection
        with patch.object(release.sqlite3, "connect", side_effect=failing_connect):
            with self.assertRaises(release.sqlite3.OperationalError):
                self.migrate()
        self.assertTrue((self.staging / "before.sqlite").is_file())
        with connect(self.database) as database:
            self.assertEqual([row[1] for row in release.schema_rows(database)], ["orders"])
            self.assertEqual(database.execute("SELECT * FROM orders").fetchall(), [("preserved-order", "paid")])

    def test_backup_space_shortage_fails_before_schema_changes(self):
        with patch.object(release.shutil, "disk_usage", return_value=type("Space", (), {"free": 512 * 1024 * 1024})()):
            with self.assertRaisesRegex(release.ReleaseError, "free space"):
                self.migrate()
        with release.sqlite3.connect(self.database) as database:
            self.assertEqual([row[1] for row in release.schema_rows(database)], ["orders"])

    def test_failed_backup_durability_check_prevents_schema_changes(self):
        with patch.object(release.os, "fsync", side_effect=OSError("simulated disk failure")):
            with self.assertRaises(OSError):
                self.migrate()
        with release.sqlite3.connect(self.database) as database:
            self.assertEqual([row[1] for row in release.schema_rows(database)], ["orders"])
            self.assertEqual(database.execute("SELECT * FROM orders").fetchall(), [("preserved-order", "paid")])

    def test_missing_database_links_or_public_mode_fail_closed(self):
        original = self.database.read_bytes()
        for kind in ("missing", "symlink", "hardlink", "public"):
            with self.subTest(kind=kind):
                self.database.unlink()
                if kind == "symlink":
                    other = self.root / "elsewhere.sqlite"
                    other.write_bytes(original)
                    self.database.symlink_to(other)
                elif kind == "hardlink":
                    other = self.root / "linked.sqlite"
                    other.write_bytes(original)
                    os.link(other, self.database)
                elif kind == "public":
                    self.database.write_bytes(original)
                    self.database.chmod(0o644)
                with self.assertRaises((release.ReleaseError, FileNotFoundError)):
                    self.migrate()
                self.assertFalse(self.staging.exists())
                if os.path.lexists(self.database):
                    self.database.unlink()
                self.database.write_bytes(original)
                self.database.chmod(0o600)


class AdditiveDeploymentTests(DeploymentFixture):
    def prepare_migration(self):
        state = self.root / "var/lib/becore-tickets"
        state.chmod(0o700)
        with release.sqlite3.connect(state / "tickets.sqlite") as database:
            database.execute("CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
            database.execute("INSERT INTO orders VALUES ('preserved-order', 'paid')")
        (state / "tickets.sqlite").chmod(0o600)
        specification = AdditiveMigrationTests.specification()
        name = specification.pop("path")
        self.patch_migrations = patch.dict(release.REVIEWED_MIGRATIONS, {name: specification}, clear=True)
        self.patch_migrations.start()
        self.addCleanup(self.patch_migrations.stop)
        member = tarfile.TarInfo("migrations/test.sql")
        member.mode = 0o644
        self.make_archive(extra=(member, AdditiveMigrationTests.SQL))
        self.proof["changedFiles"] = [name]
        self.proof["migrations"] = release.migration_plan([name])
        self.refresh_digests()
        return state

    def test_additive_prepared_recovery_only_accepts_empty_candidate_before_migration(self):
        self.prepare_migration()
        failed = self.prepared_failure()
        self.deployment.preflight()
        result = self.deployment.transact()
        self.assertTrue(result["dataMigration"])
        self.assertTrue((failed.snapshot / "empty-release.quarantined").is_dir())
        self.assertTrue((self.deployment.snapshot / "database/before.sqlite").is_file())

    def test_additive_prepared_recovery_rejects_any_migration_evidence(self):
        self.prepare_migration()
        failed = self.prepared_failure()
        (failed.snapshot / "database").mkdir(mode=0o700)
        with self.assertRaisesRegex(release.ReleaseError, "unexpected entries"):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)

    def test_schema_precedes_candidate_and_application_rollback_preserves_tables_and_rows(self):
        state = self.prepare_migration()
        self.system.fail = "local"
        restart = self.system.restart
        def checked_restart():
            with release.sqlite3.connect(state / "tickets.sqlite") as database:
                self.assertEqual(database.execute("SELECT COUNT(*) FROM new_evidence").fetchone(), (0,))
                self.assertEqual(database.execute("SELECT * FROM orders").fetchall(), [("preserved-order", "paid")])
            restart()
        self.system.restart = checked_restart
        with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
            self.deployment.transact()
        self.assertEqual(self.system.revision, OLD)
        self.assertEqual(release.strict_json((self.deployment.snapshot / "result.json").read_bytes())["phase"], "rolled-back")
        self.assertTrue((self.deployment.snapshot / "database/before.sqlite").is_file())
        with release.sqlite3.connect(state / "tickets.sqlite") as database:
            self.assertEqual(database.execute("SELECT COUNT(*) FROM new_evidence").fetchone(), (0,))

    def test_application_rollback_preserves_customer_and_evidence_writes_after_activation(self):
        state = self.prepare_migration()
        self.system.fail = "local"
        restart = self.system.restart
        def write_after_candidate_starts():
            restart()
            if self.system.revision == NEW:
                with release.sqlite3.connect(state / "tickets.sqlite") as database:
                    database.execute("INSERT INTO orders VALUES ('new-paid-order', 'paid')")
                    database.execute("INSERT INTO new_evidence VALUES ('new-job', 'done')")
        self.system.restart = write_after_candidate_starts
        with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
            self.deployment.transact()
        self.assertEqual(self.system.revision, OLD)
        with release.sqlite3.connect(state / "tickets.sqlite") as database:
            self.assertEqual(database.execute("SELECT * FROM orders ORDER BY id").fetchall(),
                             [("new-paid-order", "paid"), ("preserved-order", "paid")])
            self.assertEqual(database.execute("SELECT * FROM new_evidence").fetchall(), [("new-job", "done")])
        # The older backup was retained for inspection, never copied over live writes.
        with release.sqlite3.connect(self.deployment.snapshot / "database/before.sqlite") as saved:
            self.assertEqual(saved.execute("SELECT * FROM orders").fetchall(), [("preserved-order", "paid")])

    def test_verified_release_records_additive_schema_and_backup(self):
        self.prepare_migration()
        result = self.deployment.transact()
        self.assertTrue(result["dataMigration"])
        record = release.strict_json(self.deployment.journal.read_bytes())["lastCodeRelease"]
        self.assertEqual(record["additiveMigrations"], self.proof["migrations"])
        self.assertEqual(record["databaseBackupSha256"], release.digest_file(self.deployment.snapshot / "database/before.sqlite"))

    def test_missing_or_tampered_migration_never_restarts_service(self):
        self.prepare_migration()
        member = tarfile.TarInfo("migrations/test.sql")
        member.mode = 0o644
        self.make_archive(extra=(member, AdditiveMigrationTests.SQL + b"DELETE FROM orders;"))
        self.refresh_digests()
        with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assertEqual(self.system.revision, OLD)

    def test_omitted_or_forged_migration_plan_rejected_before_extraction(self):
        self.prepare_migration()
        for value in ([], [dict(self.proof["migrations"][0], sha256="a" * 64)]):
            self.proof["migrations"] = value
            self.refresh_digests()
            with self.assertRaisesRegex(release.ReleaseError, "reviewed source manifest"):
                self.deployment.transact()
            self.assertFalse(self.deployment.release.exists())
            self.assertEqual(self.system.restarts, 0)


class HostVerificationMigrationTests(unittest.TestCase):
    # Actual writerGuardStatements output; also checked against the source generator when available.
    WRITER_GUARD_STATEMENTS = (
        'CREATE TABLE IF NOT EXISTS _bct_handover_state(id INTEGER PRIMARY KEY CHECK(id=1), frozen INTEGER NOT NULL CHECK(frozen IN (0,1)), transfer_id TEXT NOT NULL)',
        "INSERT OR IGNORE INTO _bct_handover_state(id,frozen,transfer_id) VALUES(1,0,'')",
        'CREATE TRIGGER IF NOT EXISTS "_bct_guard_hosts_insert" BEFORE INSERT ON "hosts" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,\'Source writer is paused for verified handover\'); END',
        'CREATE TRIGGER IF NOT EXISTS "_bct_guard_hosts_update" BEFORE UPDATE ON "hosts" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,\'Source writer is paused for verified handover\'); END',
        'CREATE TRIGGER IF NOT EXISTS "_bct_guard_hosts_delete" BEFORE DELETE ON "hosts" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,\'Source writer is paused for verified handover\'); END',
    )

    SQL = (b"-- Owner-confirmed public verification for the existing Kofi Bills profile.\n"
           b"-- No account roles, permissions, event assignments or other hosts are changed.\n"
           b"UPDATE hosts\nSET verification_status = 'verified', updated_at = CURRENT_TIMESTAMP\n"
           b"WHERE id = 'host:kofi-bills' AND slug = 'kofi-bills'\n"
           b"  AND verification_status = 'reviewed';\n")

    @staticmethod
    def seed(database):
        database.executescript("""
            CREATE TABLE hosts (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL, verification_status TEXT NOT NULL, updated_at TEXT NOT NULL,
                account_id TEXT, permission_marker TEXT);
            INSERT INTO hosts VALUES ('host:kofi-bills','kofi-bills','Kofi Bills','reviewed','before',NULL,'unchanged');
            INSERT INTO hosts VALUES ('host:other','other','Other host','reviewed','before',NULL,'unchanged');
            CREATE TABLE staff (id TEXT PRIMARY KEY, role TEXT NOT NULL);
            INSERT INTO staff VALUES ('staff','scanner');
            CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL);
            INSERT INTO orders VALUES ('preserved-order','paid');
        """)
        for statement in HostVerificationMigrationTests.WRITER_GUARD_STATEMENTS:
            database.execute(statement)
        database.commit()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "tickets.sqlite"
        with release.sqlite3.connect(self.database) as connection:
            self.seed(connection)
        self.database.chmod(0o600)
        self.staging = self.root / "backup"
        self.spec = release.migration_plan([release.HOST_VERIFICATION_PATH])[0]

    def migrate(self):
        return release.migrate_database(self.database, self.staging, [(self.spec, self.SQL)])

    def rows(self, table="hosts"):
        with release.sqlite3.connect(self.database) as connection:
            return connection.execute('SELECT * FROM "' + table + '" ORDER BY id').fetchall()

    def test_exact_correction_preserves_all_other_values_with_private_backup(self):
        before = self.rows()
        with release.sqlite3.connect(self.database) as connection:
            connection.execute("UPDATE _bct_handover_state SET transfer_id='preserved-transfer-identity'")
            control = connection.execute("SELECT * FROM _bct_handover_state").fetchall()
            schema = release.schema_rows(connection)
        result = self.migrate()
        self.assertEqual(result["publicHostCorrection"], {
            "hostId": "host:kofi-bills", "changed": True, "beforeStatus": "reviewed",
            "afterStatus": "verified", "preservedOnCodeRollback": True})
        self.assertFalse(result["created"])
        after = self.rows()
        self.assertEqual(after[1:], before[1:])
        self.assertEqual(after[0][:3] + after[0][5:], before[0][:3] + before[0][5:])
        self.assertEqual(after[0][3], "verified")
        self.assertEqual(self.rows("staff"), [("staff", "scanner")])
        self.assertEqual(self.rows("orders"), [("preserved-order", "paid")])
        with release.sqlite3.connect(self.database) as connection:
            self.assertEqual(connection.execute("SELECT * FROM _bct_handover_state").fetchall(), control)
            self.assertEqual(release.schema_rows(connection), schema)
        backup = self.staging / "before.sqlite"
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assertEqual(result["backupSha256"], release.digest_file(backup))
        with release.sqlite3.connect(backup) as saved:
            self.assertEqual(saved.execute("SELECT * FROM hosts ORDER BY id").fetchall(), before)

    def test_already_verified_and_repeat_are_byte_preserving_noops(self):
        self.migrate()
        before = self.rows()
        self.staging = self.root / "repeat"
        result = self.migrate()
        self.assertFalse(result["publicHostCorrection"]["changed"])
        self.assertEqual(self.rows(), before)

    def test_successful_correction_preserves_all_three_writer_fences(self):
        self.migrate()
        before = self.rows()
        with release.sqlite3.connect(self.database) as connection:
            schema = release.schema_rows(connection)
            connection.execute("UPDATE _bct_handover_state SET frozen=1")
            for sql in (
                "INSERT INTO hosts VALUES ('host:new','new','New host','reviewed','before',NULL,'unchanged')",
                "UPDATE hosts SET name='blocked-change' WHERE id='host:kofi-bills'",
                "DELETE FROM hosts WHERE id='host:other'",
            ):
                with self.subTest(sql=sql), self.assertRaisesRegex(release.sqlite3.IntegrityError, "Source writer is paused"):
                    connection.execute(sql)
            self.assertEqual(connection.execute("SELECT * FROM hosts ORDER BY id").fetchall(), before)
            self.assertEqual(release.schema_rows(connection), schema)
            self.assertEqual(connection.execute("SELECT frozen FROM _bct_handover_state").fetchone(), (1,))

    def test_unexpected_missing_or_mismatched_identity_fails_closed(self):
        for statement in (
            "DELETE FROM hosts WHERE id='host:kofi-bills'",
            "UPDATE hosts SET slug='different' WHERE id='host:kofi-bills'",
            "UPDATE hosts SET id='host:different' WHERE slug='kofi-bills'",
            "UPDATE hosts SET verification_status='unverified' WHERE id='host:kofi-bills'",
            "UPDATE hosts SET verification_status='revoked' WHERE id='host:kofi-bills'",
        ):
            with self.subTest(statement=statement):
                with release.sqlite3.connect(self.database) as connection:
                    connection.execute("DELETE FROM hosts")
                    connection.execute("INSERT INTO hosts VALUES ('host:kofi-bills','kofi-bills','Kofi Bills','reviewed','before',NULL,'unchanged')")
                    connection.execute(statement)
                before = self.rows()
                self.staging = self.root / ("case-" + str(len(list(self.root.iterdir()))))
                with self.assertRaises(release.ReleaseError):
                    self.migrate()
                self.assertEqual(self.rows(), before)
                self.assertEqual(self.rows("staff"), [("staff", "scanner")])

    def test_hosts_trigger_is_rejected_before_any_indirect_write(self):
        with release.sqlite3.connect(self.database) as connection:
            connection.execute("CREATE TRIGGER unsafe AFTER UPDATE ON hosts BEGIN UPDATE staff SET role='owner'; END")
        before = self.rows()
        with self.assertRaisesRegex(release.ReleaseError, "hosts triggers"):
            self.migrate()
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.rows("staff"), [("staff", "scanner")])

    def test_sql_spec_and_batch_must_match_only_the_exact_reviewed_correction(self):
        for raw, spec in ((self.SQL + b"DELETE FROM staff;", self.spec),
                          (self.SQL.replace(b"= 'reviewed'", b"<> 'verified'"), self.spec),
                          (self.SQL, dict(self.spec, path="drizzle/other.sql")),
                          (self.SQL, dict(self.spec, sha256="a" * 64)),
                          (self.SQL, dict(self.spec, extra="unexpected")),
                          (self.SQL, dict(self.spec, kind="arbitrary-update"))):
            with self.subTest(raw=raw, spec=spec), self.assertRaises(release.ReleaseError):
                release.migrate_database(self.database, self.staging, [(spec, raw)])
        with self.assertRaisesRegex(release.ReleaseError, "only migration"):
            release.migrate_database(self.database, self.staging,
                [(self.spec, self.SQL), (AdditiveMigrationTests.specification(), AdditiveMigrationTests.SQL)])
        self.assertFalse(self.staging.exists())
        self.assertEqual(self.rows()[0][3], "reviewed")

    def test_authorizer_denies_other_columns_tables_and_cascade_side_effects(self):
        # Even an internal caller bypassing the exact-byte admission cannot use
        # the restricted execution boundary for permissions or other data.
        for raw in (b"UPDATE hosts SET account_id='new' WHERE id='host:kofi-bills';",
                    b"UPDATE staff SET role='owner';",
                    b"UPDATE _bct_handover_state SET frozen=1;",
                    b"DELETE FROM hosts;"):
            with self.subTest(raw=raw), release.closing(release.sqlite3.connect(self.database)) as connection:
                connection.execute("BEGIN IMMEDIATE")
                with self.assertRaises(release.sqlite3.DatabaseError):
                    release.correct_host_verification(connection, raw)
                connection.rollback()
        with release.sqlite3.connect(self.database) as connection:
            connection.executescript("""
                CREATE UNIQUE INDEX host_status_identity ON hosts(id,verification_status);
                CREATE TABLE permission_link (host_id TEXT, status TEXT,
                    FOREIGN KEY(host_id,status) REFERENCES hosts(id,verification_status) ON UPDATE CASCADE);
                INSERT INTO permission_link VALUES ('host:kofi-bills','reviewed');
            """)
        with self.assertRaises(release.sqlite3.DatabaseError):
            self.migrate()
        self.assertEqual(self.rows()[0][3], "reviewed")
        self.assertEqual(self.rows("staff"), [("staff", "scanner")])

    def test_postcondition_failure_rolls_back_the_exact_row(self):
        before = self.rows()
        original = release.schema_rows
        count = [0]
        def altered_schema(connection):
            count[0] += 1
            rows = original(connection)
            return rows + [("table", "unexpected", "unexpected", "unexpected")] if count[0] == 3 else rows
        with patch.object(release, "schema_rows", side_effect=altered_schema):
            with self.assertRaisesRegex(release.ReleaseError, "unrelated host values or database schema"):
                self.migrate()
        self.assertEqual(self.rows(), before)

    def test_writes_after_backup_before_lock_survive_and_define_the_baseline(self):
        write = release.write_json
        def write_between_backup_and_transaction(path, value):
            write(path, value)
            if value.get("phase") == "backed-up":
                with release.sqlite3.connect(self.database) as connection:
                    connection.execute("INSERT INTO orders VALUES ('concurrent-order','paid')")
                    connection.execute("UPDATE hosts SET name='Existing corrected display name' WHERE id='host:kofi-bills'")
        with patch.object(release, "write_json", side_effect=write_between_backup_and_transaction):
            self.migrate()
        self.assertEqual(self.rows()[0][2], "Existing corrected display name")
        self.assertEqual(self.rows("orders"), [("concurrent-order", "paid"), ("preserved-order", "paid")])
        with release.sqlite3.connect(self.staging / "before.sqlite") as saved:
            self.assertEqual(saved.execute("SELECT COUNT(*) FROM orders").fetchone()[0], 1)

    def test_writer_fixture_matches_actual_generator_and_reviewed_fingerprints(self):
        root = Path(__file__).resolve().parents[2]
        generator = root / "ops/handover/writer-lock.mjs"
        if generator.is_file():
            actual = json.loads(subprocess.check_output(["node", "--input-type=module", "-e",
                "import {writerGuardStatements} from './ops/handover/writer-lock.mjs'; "
                "console.log(JSON.stringify(writerGuardStatements(['hosts'])))"], cwd=root, text=True))
            self.assertEqual(actual, list(self.WRITER_GUARD_STATEMENTS))
        # The staged operator intentionally contains only ops/vps. Its same
        # generator-derived fixture must still match every reviewed fingerprint.
        with release.sqlite3.connect(self.database) as connection:
            guards = connection.execute("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='hosts'").fetchall()
            self.assertEqual({name: release.hashlib.sha256(sql.encode()).hexdigest() for name, sql in guards},
                             release.HOST_WRITER_GUARDS)
            control = connection.execute("SELECT sql FROM sqlite_schema WHERE name='_bct_handover_state'").fetchone()[0]
            self.assertEqual(release.hashlib.sha256(control.encode()).hexdigest(), release.HOST_WRITER_CONTROL_SCHEMA)

    def test_absent_partial_altered_guards_and_control_drift_reject_before_update(self):
        original = self.database.read_bytes()
        connect = release.sqlite3.connect
        attempted = []
        class ObservedConnection:
            def __init__(self, connection):
                self.connection = connection
            def __getattr__(self, name):
                return getattr(self.connection, name)
            def execute(self, statement, *args):
                attempted.append(statement)
                return self.connection.execute(statement, *args)
        def observed_connect(filename, *args, **kwargs):
            connection = connect(filename, *args, **kwargs)
            return ObservedConnection(connection) if str(filename) == self.database.as_uri() + "?mode=rw" else connection
        cases = (
            "DROP TRIGGER _bct_guard_hosts_insert; DROP TRIGGER _bct_guard_hosts_update; DROP TRIGGER _bct_guard_hosts_delete;",
            "DROP TRIGGER _bct_guard_hosts_update;",
            "DROP TRIGGER _bct_guard_hosts_update; " + self.WRITER_GUARD_STATEMENTS[3].replace("WHERE id=1)=1", "WHERE id=1)=0") + ";",
            "ALTER TABLE _bct_handover_state ADD COLUMN unexpected TEXT;",
            "DROP TABLE _bct_handover_state;",
            "DELETE FROM _bct_handover_state;",
            "UPDATE _bct_handover_state SET frozen=1;",
        )
        for index, statement in enumerate(cases):
            with self.subTest(statement=statement):
                self.database.write_bytes(original)
                self.staging = self.root / ("rejected-" + str(index))
                with release.sqlite3.connect(self.database) as connection:
                    connection.executescript(statement)
                    before = connection.execute("SELECT * FROM hosts ORDER BY id").fetchall()
                    schema = release.schema_rows(connection)
                attempted.clear()
                with patch.object(release.sqlite3, "connect", side_effect=observed_connect):
                    with self.assertRaises(release.ReleaseError):
                        self.migrate()
                self.assertFalse(any(release.re.search(r"\bUPDATE\s+hosts\b", sql, release.re.I) for sql in attempted))
                self.assertEqual(self.rows(), before)
                with release.sqlite3.connect(self.database) as connection:
                    self.assertEqual(release.schema_rows(connection), schema)

    def test_already_verified_noop_still_requires_complete_unfrozen_guards(self):
        self.migrate()
        before = self.rows()
        self.staging = self.root / "verified-but-frozen"
        with release.sqlite3.connect(self.database) as connection:
            connection.execute("UPDATE _bct_handover_state SET frozen=1")
        with self.assertRaisesRegex(release.ReleaseError, "unfrozen"):
            self.migrate()
        self.assertEqual(self.rows(), before)

    def test_freeze_between_backup_and_live_transaction_is_obeyed(self):
        write = release.write_json
        def freeze_after_backup(path, value):
            write(path, value)
            if value.get("phase") == "backed-up":
                with release.sqlite3.connect(self.database) as connection:
                    connection.execute("UPDATE _bct_handover_state SET frozen=1")
        with patch.object(release, "write_json", side_effect=freeze_after_backup):
            with self.assertRaisesRegex(release.ReleaseError, "unfrozen"):
                self.migrate()
        self.assertEqual(self.rows()[0][3], "reviewed")
        with release.sqlite3.connect(self.database) as connection:
            self.assertEqual(connection.execute("SELECT frozen FROM _bct_handover_state").fetchone(), (1,))
            with self.assertRaisesRegex(release.sqlite3.IntegrityError, "Source writer is paused"):
                connection.execute("UPDATE hosts SET verification_status='verified'")
        with release.sqlite3.connect(self.staging / "before.sqlite") as saved:
            self.assertEqual(saved.execute("SELECT frozen FROM _bct_handover_state").fetchone(), (0,))

    def test_control_value_postcondition_drift_rolls_back_host_correction(self):
        original = release.host_writer_state
        count = [0]
        def changed_result(connection):
            state = original(connection)
            count[0] += 1
            return [(1, 0, "unexpected-transfer-change")] if count[0] == 2 else state
        before = self.rows()
        with patch.object(release, "host_writer_state", side_effect=changed_result):
            with self.assertRaisesRegex(release.ReleaseError, "control values"):
                self.migrate()
        self.assertEqual(self.rows(), before)


class HostVerificationDeploymentTests(DeploymentFixture):
    def prepare_correction(self):
        state = self.root / "var/lib/becore-tickets"
        state.chmod(0o700)
        with release.sqlite3.connect(state / "tickets.sqlite") as database:
            HostVerificationMigrationTests.seed(database)
        (state / "tickets.sqlite").chmod(0o600)
        member = tarfile.TarInfo("migrations/0059_kofi_bills_verified_host.sql")
        member.mode = 0o644
        self.make_archive(extra=(member, HostVerificationMigrationTests.SQL))
        self.proof["changedFiles"] = [release.HOST_VERIFICATION_PATH]
        self.proof["migrations"] = release.migration_plan(self.proof["changedFiles"])
        self.refresh_digests()
        return state

    def test_code_rollback_keeps_correction_and_customer_writes(self):
        state = self.prepare_correction()
        self.system.fail = "local"
        restart = self.system.restart
        def write_after_activation():
            restart()
            if self.system.revision == NEW:
                with release.sqlite3.connect(state / "tickets.sqlite") as database:
                    self.assertEqual(database.execute("SELECT verification_status FROM hosts WHERE id='host:kofi-bills'").fetchone(), ("verified",))
                    database.execute("INSERT INTO orders VALUES ('new-paid-order','paid')")
        self.system.restart = write_after_activation
        with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
            self.deployment.transact()
        self.assertEqual(self.system.revision, OLD)
        with release.sqlite3.connect(state / "tickets.sqlite") as database:
            self.assertEqual(database.execute("SELECT verification_status FROM hosts WHERE id='host:kofi-bills'").fetchone(), ("verified",))
            self.assertEqual(database.execute("SELECT COUNT(*) FROM orders").fetchone(), (2,))
        with release.sqlite3.connect(self.deployment.snapshot / "database/before.sqlite") as saved:
            self.assertEqual(saved.execute("SELECT verification_status FROM hosts WHERE id='host:kofi-bills'").fetchone(), ("reviewed",))
            self.assertEqual(saved.execute("SELECT COUNT(*) FROM orders").fetchone(), (1,))

    def test_release_records_exact_data_correction_and_backup(self):
        self.prepare_correction()
        self.assertTrue(self.deployment.transact()["dataMigration"])
        record = release.strict_json(self.deployment.journal.read_bytes())["lastCodeRelease"]
        self.assertEqual(record["reviewedDataMigrations"], self.proof["migrations"])
        self.assertNotIn("additiveMigrations", record)
        self.assertEqual(record["databaseBackupSha256"], release.digest_file(self.deployment.snapshot / "database/before.sqlite"))


class VerifierTests(unittest.TestCase):
    def setUp(self):
        approved = patch.object(release, "verify_approved_source", return_value={"tree": TREE})
        approved.start()
        self.addCleanup(approved.stop)
        # These tests isolate the existing path/blob and CI contracts. Real-Git
        # mode/deletion enforcement is exercised in test_release_source.py.
        modes = patch.object(release, "verify_changed_modes")
        modes.start()
        self.addCleanup(modes.stop)

    def test_crypto_json_edit_preserves_unrelated_bytes_and_escaped_keys(self):
        self.assertEqual(release.enable_crypto_bytes(b'{ "key":"value" }\n'),
                         b'{ "key":"value" ,"SEEV_CRYPTO_ENABLED":"true"}\n')
        self.assertEqual(release.enable_crypto_bytes(b'{}'), b'{"SEEV_CRYPTO_ENABLED":"true"}')
        self.assertEqual(release.enable_crypto_bytes(b'{"SEEV_CRYPTO_ENABLED":"true"}'),
                         b'{"SEEV_CRYPTO_ENABLED":"true"}')
        self.assertEqual(release.enable_crypto_bytes(b'{"SEEV_\\u0043RYPTO_ENABLED" : "false", "key":"preserved"}'),
                         b'{"SEEV_\\u0043RYPTO_ENABLED" : "true", "key":"preserved"}')
        for value in (b'{"a":"b","a":"c"}', b'[]', b'{"flag":true}'):
            with self.assertRaises(release.ReleaseError):
                release.enable_crypto_bytes(value)

    def test_runtime_workflow_identity_and_exact_main_sha(self):
        run = {"id": 123, "run_attempt": 1, "status": "completed", "conclusion": "success", "head_sha": NEW,
               "path": ".github/workflows/vps-runtime.yml", "head_branch": "main", "event": "push",
               "repository": {"full_name": "owner/tickets"}, "head_repository": {"full_name": "owner/tickets"}}
        release.verify_run(run, workflow="vps-runtime.yml", source=NEW, repository="owner/tickets")
        for key, value in (("status", "in_progress"), ("conclusion", "failure"), ("head_sha", OLD),
                           ("head_branch", "feature"), ("event", "pull_request"), ("path", "wrong"),
                           ("head_repository", {"full_name": "fork/tickets"})):
            with self.subTest(key=key), self.assertRaises(release.ReleaseError):
                release.verify_run(dict(run, **{key: value}), workflow="vps-runtime.yml", source=NEW, repository="owner/tickets")

    @staticmethod
    def candidate_jobs():
        required = release.CANDIDATE_CORE_STEPS | {
            name + " (" + browser + ")"
            for browser in release.BROWSERS for name in release.CANDIDATE_BROWSER_STEPS}
        return [{"name": "verify", "conclusion": "success", "steps": [
            {"name": name, "conclusion": "success", "status": "completed"} for name in sorted(required)]}]

    @staticmethod
    def runtime_jobs():
        return [{"name": job, "conclusion": "success", "steps": [
            {"name": name, "conclusion": "success", "status": "completed"} for name in sorted(required)]}
            for job, required in (("verify", release.RUNTIME_VERIFY_STEPS), ("handoff", release.RUNTIME_HANDOFF_STEPS))]

    def test_single_candidate_and_exact_runtime_jobs_required(self):
        runtime, candidate = self.runtime_jobs(), self.candidate_jobs()
        release.verify_jobs(runtime, candidate)
        for invalid in ([], candidate + candidate, [dict(candidate[0], name="unrelated")],
                        [dict(candidate[0], conclusion="skipped")]):
            with self.assertRaises(release.ReleaseError):
                release.verify_jobs(runtime, invalid)
        for invalid in (runtime[:1], runtime + [runtime[0]],
                        [dict(runtime[0], conclusion="failure"), runtime[1]]):
            with self.assertRaises(release.ReleaseError):
                release.verify_jobs(invalid, candidate)

    def test_every_core_and_browser_gate_must_run_once_and_succeed(self):
        runtime, candidate = self.runtime_jobs(), self.candidate_jobs()
        for group, jobs in (("candidate", candidate), ("runtime", runtime[:1])):
            for step_index, step in enumerate(jobs[0]["steps"]):
                for result in ("failure", "skipped", "cancelled", None, "missing", "duplicate", "in_progress"):
                    altered = copy.deepcopy(jobs)
                    steps = altered[0]["steps"]
                    if result == "missing":
                        steps.pop(step_index)
                    elif result == "duplicate":
                        steps.append(copy.deepcopy(step))
                    elif result == "in_progress":
                        steps[step_index]["status"] = result
                    else:
                        steps[step_index]["conclusion"] = result
                    with self.subTest(group=group, step=step["name"], result=result):
                        with self.assertRaises(release.ReleaseError):
                            release.verify_jobs(runtime, altered) if group == "candidate" else release.verify_jobs(altered + runtime[1:], candidate)

    def test_jobs_are_bound_to_run_attempt_and_source_not_only_names(self):
        run = {"id": 123, "run_attempt": 2, "head_sha": NEW}
        job = {"id": 55, "run_id": 123, "run_attempt": 2, "head_sha": NEW, "status": "completed"}
        release.verify_job_identity([job], run)
        for key, value in (("id", True), ("id", 0), ("run_id", 456), ("run_attempt", 1),
                           ("run_attempt", True), ("head_sha", OLD), ("status", "in_progress")):
            with self.subTest(key=key, value=value), self.assertRaises(release.ReleaseError):
                release.verify_job_identity([dict(job, **{key: value})], run)
        for jobs in ([], [job, job]):
            with self.assertRaises(release.ReleaseError):
                release.verify_job_identity(jobs, run)

    def test_reviewed_application_and_migration_blobs_are_exact_and_no_other_paths_expand(self):
        name = "runtime/vps/server.mjs"
        with patch.dict(release.REVIEWED_APPLICATION_BLOBS, {name: "6" * 40}, clear=True):
            for blob in ("6" * 40, "7" * 40):
                with patch.object(release, "git", side_effect=[name, blob]), patch.object(release.subprocess, "run"):
                    if blob == "6" * 40:
                        self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                    else:
                        with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
                            release.vetted_changes(OLD, NEW)
        for name, specification in release.REVIEWED_MIGRATIONS.items():
            for blob in (specification["blob"], "f" * 40):
                with patch.object(release, "git", side_effect=[name, blob]), patch.object(release.subprocess, "run"):
                    if name in ("drizzle/0068_room_host_first_posts.sql", "drizzle/0069_event_host_pass_invitations.sql",
                                "drizzle/0070_yorkeway_early_access.sql", "drizzle/0071_yorkeway_owner_push.sql"):
                        with self.assertRaisesRegex(release.ReleaseError, "requires its exact release family"):
                            release.vetted_changes(OLD, NEW)
                    elif blob == specification["blob"]:
                        self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                    else:
                        with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
                            release.vetted_changes(OLD, NEW)

    def test_every_activation_checks_trusted_source_before_ci_metadata(self):
        args = argparse.Namespace(source=NEW, expected=OLD, metadata="/not/read")
        with patch.dict(os.environ, GITHUB_REF="refs/heads/main"), \
             patch.object(release, "git", side_effect=[NEW, ""]), \
             patch.object(release, "verify_trusted_operator", side_effect=release.ReleaseError("unapproved source")) as guard:
            with self.assertRaisesRegex(release.ReleaseError, "unapproved source"):
                release.verify_ci(args)
            guard.assert_called_once_with(NEW)

    def test_trusted_source_requires_independent_baseline_and_operator_bytes(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(release.ReleaseError, "immutable trusted"):
                release.verify_trusted_operator(NEW)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=OLD), \
             patch.object(release.subprocess, "check_output", return_value=b"substituted operator"):
            with self.assertRaisesRegex(release.ReleaseError, "Operator bytes"):
                release.verify_trusted_operator(NEW)

    def test_trusted_operator_checks_both_main_and_source_ancestry(self):
        operator = Path(release.__file__).resolve()
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=OLD), \
             patch.object(release.subprocess, "check_output", return_value=operator.read_bytes()), \
             patch.object(release.subprocess, "run") as run:
            release.verify_trusted_operator(NEW)
        self.assertEqual([entry.args[0] for entry in run.call_args_list], [
            ["git", "--no-replace-objects", "merge-base", "--is-ancestor", OLD, descendant]
            for descendant in ("origin/main", NEW)])
        for entry in run.call_args_list:
            self.assertEqual(entry.kwargs["env"]["GIT_NO_REPLACE_OBJECTS"], "1")
            self.assertTrue(entry.kwargs["check"])

    def test_security_policy_changes_require_an_explicit_exact_reviewed_blob(self):
        name = "worker/security-response.ts"
        with patch.dict(release.REVIEWED_APPLICATION_BLOBS, {name: "6" * 40}, clear=True):
            for blob in ("6" * 40, "7" * 40):
                with patch.object(release, "git", side_effect=[name, blob]), patch.object(release.subprocess, "run"):
                    if blob == "6" * 40:
                        self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                    else:
                        with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
                            release.vetted_changes(OLD, NEW)
        with patch.dict(release.REVIEWED_APPLICATION_BLOBS, {}, clear=True):
            with patch.object(release, "git", return_value=name), patch.object(release.subprocess, "run"):
                with self.assertRaisesRegex(release.ReleaseError, "Unvetted source path"):
                    release.vetted_changes(OLD, NEW)

    def test_source_allowlist_denies_schema_runtime_and_unknown_scripts(self):
        for name in ("db/schema.ts", "drizzle/0001.sql", "runtime/vps/server.mjs", "ops/handover/live-operator.mjs",
                     "wrangler.jsonc", "scripts/build-vps.mjs", "ops/vps/install-preview.py", "app/api/admin/route.ts"):
            with patch.object(release, "git", return_value=name), patch.object(release.subprocess, "run"):
                with self.subTest(name=name), self.assertRaises(release.ReleaseError):
                    release.vetted_changes(OLD, NEW)

    def test_handover_configuration_addition_must_match_exactly(self):
        before = "names=['SEEV_ENABLED', 'SEEV_ENVIRONMENT', 'unchanged'];"
        after = before.replace("'SEEV_ENABLED',", "'SEEV_ENABLED', 'SEEV_CRYPTO_ENABLED',")
        with patch.object(release, "git", side_effect=["worker/handover.ts", before, after]), patch.object(release.subprocess, "run"):
            release.vetted_changes(OLD, NEW)
        with patch.object(release, "git", side_effect=["worker/handover.ts", before, after + "changed"]), patch.object(release.subprocess, "run"):
            with self.assertRaises(release.ReleaseError):
                release.vetted_changes(OLD, NEW)

    def test_reviewed_operator_workflow_is_bound_to_its_exact_blob(self):
        workflow = ".github/workflows/tickets-release-operator-checks.yml"
        for blob in (release.REVIEWED_APPLICATION_BLOBS[workflow], "f" * 40):
            with patch.object(release, "git", side_effect=[workflow, blob]), patch.object(release.subprocess, "run"):
                if blob == release.REVIEWED_APPLICATION_BLOBS[workflow]:
                    self.assertEqual(release.vetted_changes(OLD, NEW), [workflow])
                else:
                    with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
                        release.vetted_changes(OLD, NEW)

    def test_mobile_lock_allows_only_reviewed_three_field_security_patch(self):
        before = {"lockfileVersion": 3, "packages": {
            "node_modules/brace-expansion": {
                "version": "5.0.9",
                "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz",
                "integrity": "sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==",
                "dev": True,
                "license": "MIT",
                "dependencies": {
                    "balanced-match": "^4.0.2"
                },
                "engines": {
                    "node": "20 || >=22"
                }
            },
            "node_modules/other": {"version": "1.0.0"}}}
        after = copy.deepcopy(before)
        after["packages"]["node_modules/brace-expansion"] = {
            "version": "5.0.12",
            "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz",
            "integrity": "sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ==",
            "dev": True,
            "license": "MIT",
            "dependencies": {
                "balanced-match": "^4.0.2"
            },
            "engines": {
                "node": "20 || >=22"
            }
        }
        name = "mobile/package-lock.json"
        def check(value, original=before):
            with patch.object(release, "git", side_effect=[name, json.dumps(original), json.dumps(value)]), patch.object(release.subprocess, "run"):
                return release.vetted_changes(OLD, NEW)
        self.assertEqual(check(after), [name])
        for key, value in (("version", "5.0.13"), ("resolved", "https://example.com/unreviewed.tgz"),
                           ("integrity", "unreviewed"), ("dependencies", {"balanced-match": "*"})):
            tampered = copy.deepcopy(after)
            tampered["packages"]["node_modules/brace-expansion"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(release.ReleaseError, "reviewed mobile"):
                check(tampered)
        for tampered in (dict(after, lockfileVersion=2), dict(after, name="changed")):
            with self.assertRaisesRegex(release.ReleaseError, "reviewed mobile"):
                check(tampered)
        tampered = copy.deepcopy(after)
        tampered["packages"]["node_modules/other"]["version"] = "2.0.0"
        with self.assertRaisesRegex(release.ReleaseError, "reviewed mobile"):
            check(tampered)
        for key in ("version", "resolved", "integrity"):
            baseline = copy.deepcopy(before)
            baseline["packages"]["node_modules/brace-expansion"][key] = "unexpected"
            with self.subTest(baseline=key), self.assertRaisesRegex(release.ReleaseError, "baseline"):
                check(after, baseline)

    def test_retired_checkout_guard_is_an_allowed_application_change(self):
        with patch.object(release, "git", return_value="lib/retired-checkout.ts"), patch.object(release.subprocess, "run"):
            self.assertEqual(release.vetted_changes(OLD, NEW), ["lib/retired-checkout.ts"])

    def test_root_dependency_patch_requires_exact_reviewed_input_and_output_blobs(self):
        changed = "package.json\npackage-lock.json"
        blobs = ["f5b97ad99e9f3c5c74abfde84ed87b03577b1a24",
                 "dc6e4e1cfa53b05beb3b5f70c7a5d07dd5e07b23",
                 "3916f840669463f8ac586dc25d715456a5d9d0b8",
                 "759d34af76287e214f03def74be98ddefb33780a"]
        with patch.object(release, "git", side_effect=[changed, *blobs]) as git, patch.object(release.subprocess, "run"):
            self.assertEqual(release.vetted_changes(OLD, NEW), changed.splitlines())
            self.assertEqual(git.call_args_list, [
                call("diff", "--name-only", OLD, NEW),
                call("rev-parse", OLD + ":package.json"),
                call("rev-parse", NEW + ":package.json"),
                call("rev-parse", OLD + ":package-lock.json"),
                call("rev-parse", NEW + ":package-lock.json")])
        # Either baseline or output changing invalidates the reviewed patch,
        # including changes to scripts, engines, dependencies or lock metadata.
        for index in range(len(blobs)):
            tampered = list(blobs)
            tampered[index] = "f" * 40
            with self.subTest(blob=index):
                with patch.object(release, "git", side_effect=[changed, *tampered]), patch.object(release.subprocess, "run"):
                    with self.assertRaisesRegex(release.ReleaseError, "reviewed security patch"):
                        release.vetted_changes(OLD, NEW)

    def test_root_dependency_patch_rejects_a_partial_package_pair(self):
        for name in ("package.json", "package-lock.json"):
            with self.subTest(name=name):
                with patch.object(release, "git", return_value=name) as git, patch.object(release.subprocess, "run"):
                    with self.assertRaisesRegex(release.ReleaseError, "both package files"):
                        release.vetted_changes(OLD, NEW)
                    git.assert_called_once_with("diff", "--name-only", OLD, NEW)

    def test_final_audit_cannot_relabel_the_anchored_vulnerable_report_as_clean(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            directory.chmod(0o700)
            original = {"phase": "preinstall-complete", "status": "known-advisory-exception"}
            encoded = (json.dumps(original) + "\n").encode()
            anchor = release.hashlib.sha256(encoded).hexdigest()
            forged = {**original, "phase": "complete", "status": "clean", "preinstallReceiptSha256": anchor}
            for name, raw in (("preinstall-receipt.json", encoded), ("receipt.json", json.dumps(forged).encode()),
                              ("npm-audit.json", b"{}"), ("npm-audit.stderr", b"")):
                release.atomic_write(directory / name, raw)
            with patch.dict(os.environ, BECORE_PREINSTALL_RECEIPT_SHA256=anchor):
                with self.assertRaisesRegex(release.ReleaseError, "independently captured pre-install"):
                    release.verify_dependency_audit(directory, NEW)

    def test_full_ci_tree_equivalence_and_artifact_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = {"id": 123, "run_attempt": 1, "status": "completed", "conclusion": "success", "head_sha": NEW,
                       "path": ".github/workflows/vps-runtime.yml", "head_branch": "main", "event": "push",
                       "repository": {"full_name": "owner/tickets"}, "head_repository": {"full_name": "owner/tickets"}}
            candidate = dict(runtime, id=456, path=".github/workflows/candidate-checks.yml", event="pull_request", head_sha=OLD)
            runtime_jobs = self.runtime_jobs()
            candidate_jobs = self.candidate_jobs()
            for run, jobs in ((runtime, runtime_jobs), (candidate, candidate_jobs)):
                for index, job in enumerate(jobs):
                    job.update(id=index+100, run_id=run["id"], run_attempt=run["run_attempt"],
                               head_sha=run["head_sha"], status="completed")
            for name, value in (("runtime", runtime), ("candidate", candidate),
                                ("runtime-jobs", runtime_jobs), ("candidate-jobs", candidate_jobs)):
                release.write_json(root / (name + ".json"), value)
            archive = root / "tickets-vps-runtime.tar.gz"
            archive.write_bytes(b"test archive")
            checksum = root / "tickets-vps-runtime.tar.gz.sha256"
            checksum.write_text(release.digest_file(archive) + "  tickets-vps-runtime.tar.gz\n")
            args = argparse.Namespace(source=NEW, expected=ORIGINAL, repository="owner/tickets", metadata=str(root),
                                      runtime_run="123", candidate_run="456", archive=str(archive), output=str(root / "proof.json"))
            with patch.dict(os.environ, GITHUB_REF="refs/heads/main"), patch.object(release, "verify_trusted_operator"), patch.object(release.subprocess, "run"), patch("builtins.print"), patch.object(release, "verify_runtime_transport", return_value={"verified": True}) as transport:
                with patch.object(release, "git", side_effect=[NEW, "", TREE, TREE, "tests/new-test.ts"]):
                    release.verify_ci(args)
                self.assertEqual(json.loads((root / "proof.json").read_text())["archiveSha256"], release.digest_file(archive))
                transport.assert_called_once_with(archive, NEW, TREE, runtime)
                args.audit_directory = str(root / "private-audit")
                for status in ("clean", "known-advisory-exception"):
                    audit = {"status": status, "reportSha256": "a" * 64, "size": 1, "npmExitCode": 0 if status == "clean" else 1}
                    with patch.object(release, "verify_dependency_audit", return_value=audit), \
                         patch.object(release, "git", side_effect=[NEW, "", TREE, TREE, "tests/new-test.ts"]):
                        release.verify_ci(args)
                    proof = json.loads((root / "proof.json").read_text())
                    self.assertEqual(proof["dependencyAudit"], audit)
                    self.assertEqual("auditRelease" in proof, status == "known-advisory-exception")
                del args.audit_directory
                with patch.object(release, "verify_runtime_transport", side_effect=release.ReleaseError("transport mismatch")), patch.object(release, "git", side_effect=[NEW, "", TREE, TREE, "tests/new-test.ts"]):
                    with self.assertRaisesRegex(release.ReleaseError, "transport mismatch"):
                        release.verify_ci(args)
                with patch.object(release, "git", side_effect=[NEW, "", TREE, OLD]):
                    with self.assertRaisesRegex(release.ReleaseError, "tree differs"):
                        release.verify_ci(args)
                checksum.write_text("a" * 64 + "  tickets-vps-runtime.tar.gz\n")
                with patch.object(release, "git", side_effect=[NEW, "", TREE, TREE, "tests/new-test.ts"]):
                    with self.assertRaisesRegex(release.ReleaseError, "checksum mismatch"):
                        release.verify_ci(args)
                with patch.object(release, "git", side_effect=[NEW, "dirty"]):
                    with self.assertRaisesRegex(release.ReleaseError, "clean and exact"):
                        release.verify_ci(args)

    def test_workflow_is_explicit_main_only_and_never_runs_old_diagnostics(self):
        workflow = Path(__file__).parents[2] / ".github/workflows/tickets-code-release.yml"
        text = workflow.read_text()
        self.assertIn("workflow_dispatch:", text)
        self.assertNotIn("workflow_run:", text)
        self.assertNotIn("  push:", text)
        self.assertIn("github.ref == 'refs/heads/main'", text)
        self.assertIn("default: false", text)
        self.assertNotIn("tickets-vps-diagnostics.yml", text)
        self.assertNotIn("install-preview.py", text)
        self.assertIn("persist-credentials: false", text)
        self.assertIn("tag:tickets-ci", text)
        self.assertIn("tests/e2e/checkout-preview-retired.spec.ts", text)
        self.assertNotIn("tests/e2e/checkout-preview.spec.ts", text)
        self.assertNotIn("/scan", text)
        self.assertNotIn("/my-nights", text)


class PuroExcesoOverlayTests(unittest.TestCase):
    """Operational additions cannot weaken the independently pinned P family."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        def git(*args):
            return checkout_git(self.root, *args).decode().strip()
        git('init', '-q')
        git('config', 'user.name', 'Overlay tests')
        git('config', 'user.email', 'tests@example.invalid')
        self.base = {'package.json': b'{}\n', 'README.md': b'baseline\n',
                     'ops/vps/code-release.py': b'operator\n',
                     'ops/vps/test_code_release.py': b'control tests\n'}
        for name, raw in self.base.items():
            self.write(name, raw)
        git('add', '-A')
        git('commit', '-qm', 'isolated baseline')
        promotion = release.PARALLEL_PROMOTION_FILE
        self.write(promotion, b'promotion\n')
        self.overlay = {'ops/handover/puro_exceso/inspect.py': b'inspect\n',
                        'ops/handover/puro_exceso/test_inspect.py': b'tests\n'}
        self.pins = {name: ('100644', self.blob(raw)) for name, raw in self.overlay.items()}
        for target, name, value in (
                (release, 'PARALLEL_RELEASE_BASELINE', git('rev-parse', 'HEAD')),
                (release, 'PARALLEL_RELEASE_BASE_TREE', git('rev-parse', 'HEAD^{tree}')),
                (release, 'PARALLEL_OUTPUT_BLOBS', {promotion: self.blob(b'promotion\n')}),
                (release, 'PARALLEL_OUTPUT_MODES', {promotion: '100644'}),
                (sys.modules[__name__], 'PARALLEL_OPERATOR_BLOB', self.blob(b'operator\n')),
                (sys.modules[__name__], 'PURO_EXCESO_TEST_OVERLAY', self.pins)):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for name, raw in self.overlay.items():
            self.write(name, raw)

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        path.chmod(0o644)
        return path

    def test_complete_overlay_is_separate_from_original_parallel_family(self):
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            parallel_source_family(self.root)
        actual = checkout_parallel_source_family(self.root)
        for name, (_, digest) in self.pins.items():
            self.assertEqual(actual[name], digest)
        for name in self.overlay:
            (self.root / name).unlink()
        self.assertIsNotNone(checkout_parallel_source_family(self.root))

    def test_overlay_rejects_mutated_missing_executable_symlink_and_hardlink(self):
        name = next(iter(self.overlay))
        path = self.root / name
        for mutation in ('bytes', 'missing', 'executable', 'symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                if mutation == 'bytes': path.write_bytes(b'unreviewed\n')
                elif mutation == 'missing': path.unlink()
                elif mutation == 'executable': path.chmod(0o755)
                else:
                    path.unlink()
                    if mutation == 'symlink': path.symlink_to(self.root / 'README.md')
                    else: os.link(self.root / 'README.md', path)
                with self.assertRaises(AssertionError):
                    checkout_parallel_source_family(self.root)
                if os.path.lexists(path): path.unlink()
                self.write(name, self.overlay[name])

    def test_overlay_rejects_unknown_paths_and_changed_baseline(self):
        extra = self.write('ops/handover/puro_exceso/unreviewed.py', b'extra\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_parallel_source_family(self.root)
        extra.unlink()
        (self.root / 'README.md').write_bytes(b'unreviewed\n')
        with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
            checkout_parallel_source_family(self.root)

    def test_overlay_requires_promoted_family_and_cannot_override_baseline(self):
        (self.root / release.PARALLEL_PROMOTION_FILE).unlink()
        with self.assertRaisesRegex(AssertionError, 'promoted parallel family'):
            checkout_parallel_source_family(self.root)
        self.write(release.PARALLEL_PROMOTION_FILE, b'promotion\n')
        with patch.dict(PURO_EXCESO_TEST_OVERLAY, {'README.md': ('100644', self.blob(b'baseline\n'))}):
            with self.assertRaisesRegex(AssertionError, 'cannot replace'):
                checkout_parallel_source_family(self.root)


class RoomMailTransportInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git('init', '--quiet')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Inventory fixture')
        (self.root / 'ops/vps').mkdir(parents=True)
        (self.root / 'package.json').write_text('{}')
        (self.root / 'ops/vps/code-release.py').write_bytes(Path(release.__file__).read_bytes())
        raw = (self.root / 'ops/vps/code-release.py').read_bytes()
        fixture_operator = release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        patcher = patch.object(sys.modules[__name__], 'ROOM_MAIL_VPS_OPERATOR_BLOB', fixture_operator)
        patcher.start(); self.addCleanup(patcher.stop)
        (self.root / 'ops/vps/test_code_release.py').write_text('# synthetic inventory fixture\n')
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'Synthetic baseline')
        baseline = self.git('rev-parse', 'HEAD').stdout.decode().strip()
        tree = self.git('rev-parse', 'HEAD^{tree}').stdout.decode().strip()
        self.baseline = baseline
        overlay = {}
        for name in ROOM_MAIL_VPS_TRANSPORT_OVERLAY:
            content = ('synthetic exact overlay: ' + name + '\n').encode()
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            overlay[name] = ('100644', release.hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest())
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'Synthetic exact pair')
        self.overlay_commit = self.git('rev-parse', 'HEAD').stdout.decode().strip()
        # Exercise the real full-inventory validator with isolated Git objects.
        # No external repository or Git history is required in archive execution.
        for key, value in {
            'ROOM_MAIL_VPS_RELEASE_BASELINE': baseline,
            'ROOM_MAIL_VPS_RELEASE_BASE_TREE': tree,
            'ROOM_MAIL_VPS_PREREQUISITE_BLOBS': {},
            'ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS': {},
            'ROOM_MAIL_VPS_APPLICATION_BLOBS': {},
        }.items():
            patcher = patch.object(release, key, value)
            patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch.dict(ROOM_MAIL_VPS_TRANSPORT_OVERLAY, overlay, clear=True)
        patcher.start(); self.addCleanup(patcher.stop)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)

    def test_complete_exact_overlay_and_original_family_are_accepted(self):
        self.assertIsNotNone(room_mail_vps_source_family(self.root))
        self.git('checkout', '--quiet', self.baseline)
        self.assertIsNotNone(room_mail_vps_source_family(self.root))

    def test_overlay_rejects_partial_altered_extra_mode_and_index(self):
        names = list(ROOM_MAIL_VPS_TRANSPORT_OVERLAY)
        mutations = ['partial-first', 'partial-second', 'altered', 'extra-tracked', 'extra-untracked', 'mode', 'index']
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                try:
                    target = self.root / names[0]
                    if mutation.startswith('partial'):
                        self.git('rm', '--quiet', names[0 if mutation == 'partial-first' else 1])
                    elif mutation == 'altered':
                        target.write_bytes(target.read_bytes() + b'\n# unreviewed\n')
                    elif mutation.startswith('extra'):
                        (self.root / 'unreviewed-extra.txt').write_text('extra')
                        if mutation == 'extra-tracked':
                            self.git('add', 'unreviewed-extra.txt')
                    elif mutation == 'mode':
                        target.chmod(0o755)
                    elif mutation == 'index':
                        original = target.read_bytes()
                        target.write_bytes(original + b'\n# staged-only mutation\n')
                        self.git('add', names[0])
                        target.write_bytes(original)
                    with self.assertRaises(AssertionError):
                        room_mail_vps_source_family(self.root)
                finally:
                    self.git('reset', '--hard', '--quiet', 'HEAD')
                    (self.root / 'unreviewed-extra.txt').unlink(missing_ok=True)


class RuntimeTransportWorkflowTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[2]

    def test_reviewed_transport_source_pins_match_the_staged_bytes(self):
        parallel = checkout_source_family(self.root)
        staged = not (self.root / "package.json").exists() and not (self.root / "app").exists()
        overrides = parallel if parallel is not None else (staged_family_pins(self.root) if staged else {})
        for name in (".github/workflows/candidate-checks.yml", ".github/workflows/vps-runtime.yml",
                     ".github/workflows/tickets-release-operator-checks.yml", ".github/workflows/tickets-code-release.yml",
                     "ops/vps/runtime_release.py", "ops/vps/public_runtime_guard.py",
                     "ops/vps/test_public_runtime_guard.py", "ops/vps/candidate_evidence.py",
                     "ops/vps/test_runtime_release.py", "ops/vps/test_candidate_evidence.py",
                     "ops/vps/test_runtime_packaging.py"):
            content = (self.root / name).read_bytes()
            digest = release.hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
            expected = overrides.get(name)
            self.assertEqual(expected or release.REVIEWED_OPERATOR_BLOBS.get(name, release.REVIEWED_APPLICATION_BLOBS[name]), digest, name)

    def test_reviewed_application_includes_the_merged_operator_transport(self):
        expected = {
            "ops/vps/runtime_release.py": "043e310a41ff28d23adc20383c88566b181232a6",
            "ops/vps/test_runtime_release.py": "210a2cd8f445c0fc2e0716fa8bcbbe00dbd48a14",
            "ops/vps/public_runtime_guard.py": "9a9739f1bd88cbd02dc420001efa3de5b85e3538",
            "ops/vps/test_public_runtime_guard.py": "eb1fd8a6909c7c0634326da1d35c7a4606fbebe7",
        }
        self.assertEqual(set(release.REVIEWED_OPERATOR_BLOBS), set(expected))
        for name, digest in expected.items():
            self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], digest)
            self.assertEqual(release.REVIEWED_OPERATOR_BLOBS[name], digest)

    def test_final_room_motion_source_is_pinned_without_widening_scope(self):
        expected = {
            "app/room-demo.css": "c3d871ed75945a72df7fb32f7c13c962ee4876de",
            "app/room-preview-carousel.tsx": "c77a4021be9ea6c29b6a8215e49326f2522e9491",
        }
        for name, digest in expected.items():
            self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], digest)
            path = self.root / name
            if path.exists():
                content = path.read_bytes()
                self.assertEqual(release.hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest(), digest)
        self.assertNotIn("app/", release.APPLICATION_FILES)

    def test_complete_reviewed_application_manifest_matches_candidate_source(self):
        if checkout_source_family(self.root) is not None:
            return  # Already checked every file in the complete B-derived C/P family.
        pins = release.REVIEWED_APPLICATION_BLOBS
        controls_only = controls_only_checkout(self.root)
        yorke_base = exact_application_checkout(self.root, release.YORKE_RELEASE_BASELINE,
                                                release.YORKE_BASE_TREE, release.YORKE_CONTROL_FILES)
        yorke_app = exact_application_checkout(self.root, release.YORKE_APP_SNAPSHOT,
                                               release.YORKE_APP_TREE, release.YORKE_CONTROL_FILES)
        if yorke_base or yorke_app:
            pins = {**pins, **release.WORKSPACE_APPLICATION_BLOBS}
            if yorke_app:
                pins = {**pins, **release.YORKE_APPLICATION_BLOBS}
        if exact_application_checkout(self.root, release.WORKSPACE_APP_SNAPSHOT,
                                      release.WORKSPACE_APP_TREE, release.WORKSPACE_CONTROL_FILES):
            pins = {**pins, **release.WORKSPACE_APPLICATION_BLOBS}
        readiness_live = exact_application_checkout(self.root, release.RSVP_READINESS_LIVE_BASELINE,
                                                     release.RSVP_READINESS_LIVE_TREE, release.RSVP_READINESS_CONTROL_FILES)
        readiness_base = exact_application_checkout(self.root, release.RSVP_READINESS_ADVISORY_BASE,
                                                     release.RSVP_READINESS_ADVISORY_TREE, release.RSVP_READINESS_CONTROL_FILES)
        readiness_app = exact_application_checkout(self.root, release.RSVP_READINESS_APP_SNAPSHOT,
                                                    release.RSVP_READINESS_APP_TREE, release.RSVP_READINESS_CONTROL_FILES)
        if readiness_live or readiness_base or readiness_app:
            pins = {**pins, **release.WORKSPACE_APPLICATION_BLOBS, **release.YORKE_APPLICATION_BLOBS}
            if readiness_base or readiness_app:
                pins = {**pins, **release.RSVP_READINESS_ADVISORY_BLOBS}
            if readiness_app:
                pins = {**pins, **release.RSVP_READINESS_APPLICATION_BLOBS}
        if not (self.root / "package.json").exists() and not (self.root / "app").exists():
            # The release operator deliberately archives only ops/vps and these
            # approved control files. Never treat a missing file in a full checkout as
            # optional; recognize only this exact reduced layout.
            self.assertEqual({path.name for path in self.root.iterdir()}, {"ops", ".github", "scripts", "tests"})
            staged = {
                ".github/workflows/candidate-checks.yml", ".github/workflows/vps-runtime.yml",
                ".github/workflows/tickets-release-operator-checks.yml", ".github/workflows/tickets-code-release.yml",
                "ops/vps/runtime_release.py", "ops/vps/test_runtime_release.py",
                "ops/vps/public_runtime_guard.py", "ops/vps/test_public_runtime_guard.py",
                "ops/vps/candidate_evidence.py", "ops/vps/test_candidate_evidence.py",
                "ops/vps/test_runtime_packaging.py",
                "ops/vps/audit-readiness.py", "ops/vps/test_audit_readiness.py",
                "ops/vps/test_release_source.py", "ops/vps/test_runtime_workflow_contract.py",
                ".github/workflows/deploy.yml", ".github/scripts/verify-caption-control.py",
                "scripts/verify-caption-source.py", "scripts/caption-source-manifest.json",
                "tests/test_caption_source.py",
                ".github/scripts/verify-audit-control.py", "scripts/verify-audit-release-source.py",
                "scripts/audit-release-dependencies.py", "scripts/audit-release-manifest.json",
                "scripts/audit-checkbox-hotfix.py", "tests/test_checkbox_hotfix_audit.py",
                "tests/test_audit_release_source.py", "tests/test_audit_release_dependencies.py",
                "ops/vps/test_release_approval.py", "ops/vps/test_code_release.py",
                "ops/vps/test_pink_edition.py",
            }
            self.assertEqual({name for name in pins if (self.root / name).exists()}, staged)
            family = staged_family_pins(self.root)
            pins = {name: family.get(name, pins[name]) for name in staged}
        else:
            self.assertTrue((self.root / "package.json").is_file())
            self.assertTrue((self.root / "app").is_dir())
        for name, digest in pins.items():
            if name in release.YORKE_CONTROL_FILES and (
                    yorke_base or yorke_app or readiness_live or readiness_base or readiness_app
                    or not (self.root / "package.json").exists()):
                # These are the independently evolving controls under test, not
                # application evidence. Deployment checks their exact C entries.
                continue
            content = application_bytes(self.root, name, controls_only=controls_only)
            actual = release.hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
            self.assertEqual(actual, digest, name)

    def test_workspace_checkout_keeps_one_complete_application_family(self):
        if checkout_source_family(self.root) is not None:
            return
        if not (self.root / "package.json").exists() and not (self.root / "app").exists():
            return  # The separate staged-layout test verifies every staged byte.
        self.assertTrue(any(exact_application_checkout(self.root, revision, tree,
                                                       release.WORKSPACE_CONTROL_FILES)
                            for revision, tree in (
                                (release.WORKSPACE_RELEASE_BASELINE, release.WORKSPACE_BASE_TREE),
                                (release.WORKSPACE_APP_SNAPSHOT, release.WORKSPACE_APP_TREE),
                                (release.YORKE_RELEASE_BASELINE, release.YORKE_BASE_TREE),
                                (release.YORKE_APP_SNAPSHOT, release.YORKE_APP_TREE),
                                (release.RSVP_READINESS_LIVE_BASELINE, release.RSVP_READINESS_LIVE_TREE),
                                (release.RSVP_READINESS_ADVISORY_BASE, release.RSVP_READINESS_ADVISORY_TREE),
                                (release.RSVP_READINESS_APP_SNAPSHOT, release.RSVP_READINESS_APP_TREE))),
                        "Checkout is not a complete reviewed base, workspace, Yorke or readiness application family")

    def test_candidate_is_one_read_only_job_with_every_browser_gate(self):
        text = (self.root / ".github/workflows/candidate-checks.yml").read_text()
        self.assertIn("permissions:\n  contents: read", text)
        self.assertNotIn("contents: write", text)
        self.assertNotIn("actions/upload-artifact", text)
        self.assertNotIn("actions/download-artifact", text)
        self.assertNotIn("matrix:", text)
        self.assertIn("jobs:\n  verify:", text)
        self.assertNotIn("\n  core:", text)
        expected = release.CANDIDATE_CORE_STEPS | {
            name + " (" + browser + ")"
            for browser in release.BROWSERS for name in release.CANDIDATE_BROWSER_STEPS}
        for name in expected:
            self.assertEqual(text.count("      - name: " + name + "\n"), 1, name)
        for browser in release.BROWSERS:
            self.assertIn("--project " + browser + " --workers=1 --retries=0 --repeat-each=3", text)
        self.assertEqual(text.count('test "$(sha256sum "$archive" | cut -d \' \' -f 1)" = "$BUILD_DIGEST"'), 3)
        self.assertNotIn("continue-on-error", text)

    def test_public_publisher_is_main_only_and_only_privileged_job(self):
        text = (self.root / ".github/workflows/vps-runtime.yml").read_text()
        self.assertIn("branches: [main]", text)
        self.assertNotIn("pull_request:", text)
        self.assertEqual(text.count("contents: write"), 1)
        verify, handoff = text.split("  verify:\n", 1)[1].split("  handoff:\n", 1)
        self.assertIn("github.repository == 'bechirobob/tickets'", verify)
        self.assertIn("github.ref == 'refs/heads/main'", verify)
        self.assertIn("github.event_name == 'push'", verify)
        self.assertIn("permissions:\n      contents: write", verify)
        self.assertNotIn("contents: write", handoff)
        self.assertNotIn("actions/upload-artifact", text)
        self.assertEqual(text.count("GH_TOKEN:"), 1)
        self.assertIn("persist-credentials: false", verify)
        self.assertIn("python3 ops/vps/runtime_release.py publish --directory .", verify)

    def test_consumer_uses_attempt_bound_public_release_without_write_permission(self):
        text = (self.root / ".github/workflows/tickets-code-release.yml").read_text()
        self.assertNotIn("contents: write", text)
        self.assertIn("actions: read", text)
        self.assertIn("/attempts/$runtime_attempt/jobs?per_page=100", text)
        self.assertIn("/attempts/$candidate_attempt/jobs?per_page=100", text)
        self.assertNotIn("gh run download", text)
        self.assertIn('runtime_release.py" download', text)
        self.assertIn('--attempt "$runtime_attempt"', text)
        self.assertNotIn("actions/upload-artifact", text)
        self.assertIn("tests/e2e/checkout-preview-retired.spec.ts", text)


class FailedReleaseDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/tickets-code-release.yml").read_text()
        cls.source = textwrap.dedent(cls.workflow.split("<<'PYDIAG'\n", 1)[1].split("          PYDIAG", 1)[0])
        cls.diagnostic = {"__name__": "read_only_diagnostic_test"}
        exec(compile(cls.source, "failed-release-diagnostic", "exec"), cls.diagnostic)

    def job(self, name):
        text = self.workflow.split("\n  " + name + ":\n", 1)[1]
        return release.re.split(r"\n  [a-z_]+:\n", text, maxsplit=1)[0]

    def test_boolean_mode_is_opt_in_and_release_is_mutually_exclusive(self):
        self.assertIn("inspect_failed_release:\n        description:", self.workflow)
        mode = self.workflow.split("      inspect_failed_release:\n", 1)[1].split("      recover_prepared:", 1)[0]
        self.assertIn("default: false", mode)
        self.assertIn("type: boolean", mode)
        parallel = "      verify_only:\n" in self.workflow
        if parallel:
            self.assertIn("if: github.ref == 'refs/heads/main' && (!inputs.inspect_failed_release || inputs.verify_only)", self.job("release"))
            self.assertIn("if: github.ref == 'refs/heads/main' && inputs.inspect_failed_release && !inputs.verify_only", self.job("inspect_failure"))
            before_checkout = self.job("release").split("- uses: actions/checkout@", 1)[0]
            self.assertIn('if [[ "$VERIFY_ONLY" == true ]]; then test "$INSPECT_MODE" = false; fi', before_checkout)
        else:
            self.assertIn("if: github.ref == 'refs/heads/main' && !inputs.inspect_failed_release", self.job("release"))
            self.assertIn("if: github.ref == 'refs/heads/main' && inputs.inspect_failed_release", self.job("inspect_failure"))
        self.assertIn("needs: release", self.job("retired_preview"))
        self.assertNotIn("always()", self.job("retired_preview").split("steps:", 1)[0])
        for main in (False, True):
            for inspect in (False, True):
                for verify in ((False, True) if parallel else (False,)):
                    release_runs = main and (not inspect or verify)
                    inspect_runs = main and inspect and not verify
                    conflict = main and inspect and verify
                    self.assertFalse(release_runs and inspect_runs)
                    self.assertEqual(release_runs or inspect_runs, main)
                    host_releases = release_runs and not verify and not conflict
                    self.assertFalse(host_releases and (inspect or verify))
                    if conflict:
                        self.assertTrue(release_runs)  # Fails before checkout, rather than silently skipping.
                        self.assertFalse(inspect_runs)

    def test_inspection_hard_pins_failed_inputs_before_existing_identity_connects(self):
        job = self.job("inspect_failure")
        for value in ("refs/heads/main", "workflow_dispatch", "ee95b9b43fb99dd0ca9431cf9be4d000cd65abbe",
                      "45ec44e35f8b0e5099a328ce219df2529374f9ee", "36804016094", "36801064451"):
            self.assertIn(value, job.split("- name: Connect", 1)[0])
        self.assertIn('test -z "$RECOVER_PREPARED"', job)
        self.assertIn('test "$ENABLE_CRYPTO" = false', job)
        for value in ("tailscale/github-action@306e68a486fd2350f2bfc3b19fcd143891a4a2d8",
                      "oauth-client-id: TQyYk1uNME11CNTRL-kCerQyAvJU11CNTRL",
                      "audience: api.tailscale.com/TQyYk1uNME11CNTRL-kCerQyAvJU11CNTRL",
                      "tags: tag:tickets-ci", "ping: hermes"):
            self.assertIn(value, job)
        self.assertIn("group: tickets-vps-handover", self.workflow)
        self.assertEqual(self.diagnostic["RUN"], "36804472437-1")
        self.assertEqual(str(self.diagnostic["SNAPSHOT"]),
                         "/var/lib/becore-tickets-handover/code-release-36804472437-1")

    def test_inspection_has_no_deployment_live_database_or_write_commands(self):
        job = self.job("inspect_failure")
        for forbidden in ("actions/checkout", " apply ", " restart", "daemon-reload", "rm --", "rmdir",
                          "runtime.json", "live-transfer.json", ".write(", "write_text",
                          "os.O_CREAT", "os.O_WRONLY", "os.O_RDWR", "unlink(", "rename(", "mkdir("):
            self.assertNotIn(forbidden, job)
        self.assertEqual(job.count("tailscale ssh root@hermes"), 1)
        self.assertIn('os.O_RDONLY | os.O_NOFOLLOW', self.source)
        self.assertEqual(self.source.count('os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK'), 2)
        self.assertIn('fcntl.LOCK_SH | fcntl.LOCK_NB', self.source)
        self.assertIn('["systemctl", "show", "becore-tickets.service"', self.source)
        self.assertNotIn('os.environ', self.source)
        self.assertEqual(self.source.count('sqlite3.connect('), 1)
        self.assertIn('sqlite3.connect(backup.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=3)', self.source)
        self.assertIn('backup = SNAPSHOT / "database/before.sqlite"', self.source)

    def test_only_known_safe_error_fields_and_digests_can_be_printed(self):
        safe = self.diagnostic["safe_fields"]
        self.assertEqual(safe({"phase": "failed", "errorType": "OperationalError",
                              "reason": "unexpected secret content", "password": "must-not-print",
                              "source": "invalid", "backupSha256": "f" * 64}),
                         {"phase": "failed", "errorType": "OperationalError",
                          "reason": "unrecognized-redacted", "backupSha256": "f" * 64})
        for reason in self.diagnostic["SAFE_REASONS"]:
            self.assertEqual(safe({"reason": reason}), {"reason": reason})
        self.assertEqual(safe({"errorType": "arbitrary value"}), {"errorType": "unrecognized-redacted"})
        self.assertEqual(safe({"publicHostCorrection": {"changed": True, "private": "hidden"}}),
                         {"hostCorrectionEvidencePresent": True, "hostCorrectionChanged": True})

    def test_private_reads_are_bounded_digest_only_and_reject_links_and_public_files(self):
        read = self.diagnostic["read_private"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            raw = b'{"phase":"failed"}'
            path.write_bytes(raw)
            path.chmod(0o600)
            self.assertEqual(read(path, os.geteuid()), {"phase": "failed"})
            self.assertEqual(read(path, os.geteuid(), digest=True), release.hashlib.sha256(raw).hexdigest())
            with self.assertRaises(RuntimeError):
                read(path, os.geteuid(), limit=1)
            path.chmod(0o644)
            with self.assertRaises(RuntimeError):
                read(path, os.geteuid())
            path.chmod(0o600)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                read(link, os.geteuid())
            fifo = Path(directory) / "fifo"
            os.mkfifo(fifo, 0o600)
            with self.assertRaises(RuntimeError):
                read(fifo, os.geteuid())
            path.write_text('[]')
            with self.assertRaises(RuntimeError):
                read(path, os.geteuid())

    def schema_fixture(self, status="reviewed", frozen=0):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        snapshot = Path(temporary.name)
        (snapshot / "database").mkdir(mode=0o700)
        backup = snapshot / "database/before.sqlite"
        with release.sqlite3.connect(backup) as database:
            database.execute("CREATE TABLE hosts (id TEXT PRIMARY KEY, slug TEXT, verification_status TEXT, private_text TEXT)")
            database.execute("INSERT INTO hosts VALUES ('host:kofi-bills','kofi-bills',?,'never-print-personal-data')", (status,))
            database.execute("CREATE TABLE IF NOT EXISTS _bct_handover_state(id INTEGER PRIMARY KEY CHECK(id=1), frozen INTEGER NOT NULL CHECK(frozen IN (0,1)), transfer_id TEXT NOT NULL)")
            database.execute("INSERT INTO _bct_handover_state VALUES(1,?,'never-print-transfer-id')", (frozen,))
            for operation in ("INSERT", "UPDATE", "DELETE"):
                database.execute('CREATE TRIGGER IF NOT EXISTS "_bct_guard_hosts_' + operation.lower()
                    + '" BEFORE ' + operation + ' ON "hosts" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 '
                    + "BEGIN SELECT RAISE(ABORT,'Source writer is paused for verified handover'); END")
        backup.chmod(0o600)
        return snapshot, backup

    def read_schema_fixture(self, snapshot, backup):
        with patch.dict(self.diagnostic, {"SNAPSHOT": snapshot, "BACKUP_SCHEMA_DIGEST": release.digest_file(backup)}):
            return self.diagnostic["backup_schema_evidence"](os.geteuid())

    def test_backup_schema_only_read_matches_known_guards_and_exposes_no_rows(self):
        snapshot, backup = self.schema_fixture()
        before = backup.read_bytes()
        connect = release.sqlite3.connect
        with patch.object(release.sqlite3, "connect", wraps=connect) as opened:
            evidence = self.read_schema_fixture(snapshot, backup)
        opened.assert_called_once_with(backup.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=3)
        self.assertTrue(evidence["allHostsTriggersMatchKnownGuards"])
        self.assertTrue(evidence["controlSchemaMatches"])
        self.assertTrue(evidence["canonicalHostReady"])
        self.assertEqual(evidence["hostsTriggerCount"], 3)
        self.assertEqual(evidence["frozen"], 0)
        self.assertEqual(evidence["reviewedBaselineCount"], 1)
        self.assertEqual(backup.read_bytes(), before)
        self.assertEqual({item.name for item in backup.parent.iterdir()}, {"before.sqlite"})
        output = json.dumps(evidence)
        for private in ("never-print", "host:kofi-bills", "CREATE TRIGGER", "SELECT RAISE", "kofi-bills"):
            self.assertNotIn(private, output)

    def test_backup_schema_reports_unknown_guards_without_sql_or_unrecognized_names(self):
        snapshot, backup = self.schema_fixture()
        with release.sqlite3.connect(backup) as database:
            database.execute("CREATE TRIGGER private_trigger_name BEFORE UPDATE ON hosts BEGIN SELECT RAISE(ABORT,'private_sql_literal'); END")
        evidence = self.read_schema_fixture(snapshot, backup)
        self.assertFalse(evidence["allHostsTriggersMatchKnownGuards"])
        self.assertEqual(evidence["hostsTriggerCount"], 4)
        self.assertIn("unrecognized-redacted", json.dumps(evidence))
        self.assertNotIn("private_trigger_name", json.dumps(evidence))
        self.assertNotIn("private_sql_literal", json.dumps(evidence))

    def test_backup_readiness_and_frozen_scalar_never_change_the_backup(self):
        for status in ("reviewed", "verified", "unverified"):
            with self.subTest(status=status):
                snapshot, backup = self.schema_fixture(status=status, frozen=1)
                before = backup.read_bytes()
                evidence = self.read_schema_fixture(snapshot, backup)
                self.assertEqual(evidence["frozen"], 1)
                self.assertEqual(evidence["canonicalHostReady"], status in ("reviewed", "verified"))
                self.assertEqual(evidence["reviewedBaselineCount"], int(status == "reviewed"))
                self.assertEqual(evidence["verifiedBaselineCount"], int(status == "verified"))
                self.assertEqual(backup.read_bytes(), before)
        snapshot, backup = self.schema_fixture()
        with release.sqlite3.connect(backup) as database:
            database.execute("UPDATE _bct_handover_state SET frozen=0")
            database.execute("UPDATE hosts SET slug='different'")
        evidence = self.read_schema_fixture(snapshot, backup)
        self.assertFalse(evidence["canonicalHostReady"])
        self.assertEqual(evidence["canonicalIdentityMatchCount"], 0)

    def test_backup_digest_or_sidecar_drift_prevents_any_database_open(self):
        snapshot, backup = self.schema_fixture()
        for sidecar in (False, True):
            with self.subTest(sidecar=sidecar):
                if sidecar:
                    Path(str(backup) + "-wal").write_bytes(b"")
                with patch.dict(self.diagnostic, {"SNAPSHOT": snapshot,
                        "BACKUP_SCHEMA_DIGEST": release.digest_file(backup) if sidecar else "f" * 64}), \
                        patch.object(release.sqlite3, "connect") as opened:
                    with self.assertRaises(RuntimeError):
                        self.diagnostic["backup_schema_evidence"](os.geteuid())
                    opened.assert_not_called()




class ReviewedControlSelectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Admission fixture")
        self.git("config", "user.email", "admission@example.invalid")
        for name in CONTROL_CHECK_FILES | {"app/source.ts"}:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("baseline\n")
        attributes = self.root / "mobile/.gitattributes"
        attributes.parent.mkdir()
        attributes.write_text("*.bat text eol=crlf\n")
        batch = self.root / "mobile/android/gradlew.bat"
        batch.parent.mkdir()
        batch.write_bytes(b"baseline\n")
        self.base = self.commit()
        self.base_tree = self.git("rev-parse", "HEAD^{tree}")
        (self.root / "app/source.ts").write_text("reviewed candidate\n")
        self.candidate = self.commit()
        self.candidate_tree = self.git("rev-parse", "HEAD^{tree}")
        self.git("checkout", "-q", self.base)
        for name in CONTROL_CHECK_FILES:
            (self.root / name).write_text("independent control update\n")
        constants = patch.dict(globals(), CONTROL_CHECK_BASE=self.base,
            CONTROL_CHECK_TREE=self.base_tree, REVIEWED_APP_SNAPSHOT=self.candidate,
            REVIEWED_APP_TREE=self.candidate_tree)
        constants.start()
        self.addCleanup(constants.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "isolated fixture")
        return self.git("rev-parse", "HEAD")

    def test_only_exact_baseline_with_finite_control_overlay_selects_reviewed_snapshot(self):
        self.assertTrue(controls_only_checkout(self.root))
        self.assertEqual(application_bytes(self.root, "app/source.ts", controls_only=True), b"reviewed candidate\n")
        self.assertEqual(application_bytes(self.root, "ops/vps/code-release.py", controls_only=True), b"independent control update\n")
        with patch.dict(globals(), REVIEWED_APP_TREE="f" * 40), self.assertRaisesRegex(AssertionError, "tree changed"):
            application_bytes(self.root, "app/source.ts", controls_only=True)

    def test_crlf_is_allowed_only_for_the_baseline_pinned_windows_script(self):
        batch = self.root / "mobile/android/gradlew.bat"
        batch.write_bytes(b"baseline\r\n")
        self.assertTrue(controls_only_checkout(self.root))
        (self.root / ".git/info/attributes").write_text("app/source.ts text eol=crlf\n")
        (self.root / "app/source.ts").write_bytes(b"baseline\r\n")
        self.assertFalse(controls_only_checkout(self.root))

    def test_actual_candidate_and_changed_application_bytes_never_select_control_branch(self):
        file = self.root / "app/source.ts"
        for content in ("reviewed candidate\n", "unknown changed application\n"):
            file.write_text(content)
            self.assertFalse(controls_only_checkout(self.root))
            self.assertEqual(application_bytes(self.root, "app/source.ts"), content.encode())
        self.git("update-index", "--assume-unchanged", "app/source.ts")
        self.assertFalse(controls_only_checkout(self.root))

    def test_staged_application_edit_or_addition_cannot_hide_behind_restored_worktree(self):
        file = self.root / "app/source.ts"
        file.write_text("staged unknown content\n")
        self.git("add", "app/source.ts")
        file.write_text("baseline\n")
        self.assertFalse(controls_only_checkout(self.root))
        self.git("reset", "-q", self.base, "--", "app/source.ts")
        self.assertTrue(controls_only_checkout(self.root))
        extra = self.root / "app/unknown.ts"
        extra.write_text("staged addition\n")
        self.git("add", "app/unknown.ts")
        extra.unlink()
        self.assertFalse(controls_only_checkout(self.root))

    def test_untracked_tracked_and_staged_unknown_files_cannot_select_control_branch(self):
        file = self.root / "unknown.txt"
        file.write_text("unreviewed\n")
        self.assertFalse(controls_only_checkout(self.root))
        self.git("add", "unknown.txt")
        self.assertFalse(controls_only_checkout(self.root))
        self.git("commit", "-qm", "unreviewed extra path")
        self.assertFalse(controls_only_checkout(self.root))


class StagedOperatorFamilyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.names = tuple(release.REVIEWED_CONTROL_BLOBS)
        self.bytes = [{name: (label + name).encode() for name in self.names}
                      for label in ("control fixture: ", "application fixture: ")]
        self.pins = [{name: release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
                      for name, raw in family.items()} for family in self.bytes]
        families = patch(__name__ + ".legacy_staged_manifests", return_value=[
            ({name: ("100644", digest) for name, digest in family.items()}, family) for family in self.pins])
        families.start()
        self.addCleanup(families.stop)
        for attribute, value in (("REVIEWED_CONTROL_BLOBS", self.pins[0]),
                                 ("REVIEWED_APPLICATION_BLOBS", self.pins[1])):
            replacement = patch.object(release, attribute, value)
            replacement.start()
            self.addCleanup(replacement.stop)

    def write_family(self, choices):
        for name, choice in zip(self.names, choices):
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(self.bytes[choice][name])

    def test_both_complete_reviewed_families_are_accepted(self):
        for choice in (0, 1):
            self.write_family([choice] * len(self.names))
            self.assertEqual(staged_family_pins(self.root), self.pins[choice])

    def test_every_mixed_family_is_rejected(self):
        self.assertEqual(len(self.names), 3)
        for mask in range(1, 2 ** len(self.names) - 1):
            self.write_family([(mask >> index) & 1 for index in range(len(self.names))])
            with self.subTest(mask=mask), self.assertRaisesRegex(AssertionError, "Mixed or unknown"):
                staged_family_pins(self.root)

    def test_unknown_missing_and_symlinked_family_files_are_rejected(self):
        for name in self.names:
            self.write_family([0] * len(self.names))
            file = self.root / name
            file.write_bytes(b"unknown source bytes")
            with self.assertRaisesRegex(AssertionError, "Mixed or unknown"):
                staged_family_pins(self.root)
            file.unlink()
            with self.assertRaisesRegex(AssertionError, "regular files"):
                staged_family_pins(self.root)
            target = self.root / "symlink-target"
            target.write_bytes(self.bytes[0][name])
            file.symlink_to(target)
            with self.assertRaisesRegex(AssertionError, "regular files"):
                staged_family_pins(self.root)
            file.unlink()

    def test_symlinked_parent_cannot_select_a_family(self):
        self.write_family([0] * len(self.names))
        directory = self.root / ".github/workflows"
        directory.rename(self.root / ".github/saved-workflows")
        directory.symlink_to("saved-workflows", target_is_directory=True)
        with self.assertRaisesRegex(AssertionError, "regular files"):
            staged_family_pins(self.root)


class EmailReleaseAdmissionTests(unittest.TestCase):
    def setUp(self):
        modes = patch.object(release, "verify_changed_modes")
        modes.start()
        self.addCleanup(modes.stop)

    def test_root_transition_requires_exact_active_baseline_and_both_manifest_blobs(self):
        changed = "package.json\npackage-lock.json"
        blobs = ["dc6e4e1cfa53b05beb3b5f70c7a5d07dd5e07b23",
                 "83f5e03b9fbbdf10f050c8dd24d06ed1ff59260b",
                 "759d34af76287e214f03def74be98ddefb33780a",
                 "cc161d4ef33ca9affdf1c6649071cb4bf27b71dc"]
        with patch.object(release, "git", side_effect=[changed, *blobs]), patch.object(release.subprocess, "run"):
            self.assertEqual(release.vetted_changes(release.EMAIL_RELEASE_BASELINE, NEW), changed.splitlines())
        for index in range(len(blobs)):
            changed_blobs = list(blobs)
            changed_blobs[index] = "f" * 40
            with self.subTest(index=index), patch.object(release, "git", side_effect=[changed, *changed_blobs]), patch.object(release.subprocess, "run"), self.assertRaises(release.ReleaseError):
                release.vetted_changes(release.EMAIL_RELEASE_BASELINE, NEW)
        with patch.object(release, "git", side_effect=[changed, *blobs]), patch.object(release.subprocess, "run"), self.assertRaises(release.ReleaseError):
            release.vetted_changes(OLD, NEW)
        for name in changed.splitlines():
            with patch.object(release, "git", return_value=name), patch.object(release.subprocess, "run"), self.assertRaisesRegex(release.ReleaseError, "both package files"):
                release.vetted_changes(release.EMAIL_RELEASE_BASELINE, NEW)

    def test_mobile_transition_is_exact_instead_of_a_generic_new_dependency_allowance(self):
        name = "mobile/package-lock.json"
        blobs = ["49254a20c8b66fa1fd584e00b13b04e8539cab58", "ebae7283d0906a9cb42b374b78a90986e7fcdcac"]
        with patch.object(release, "git", side_effect=[name, *blobs]), patch.object(release.subprocess, "run"):
            self.assertEqual(release.vetted_changes(release.EMAIL_RELEASE_BASELINE, NEW), [name])
        for index in range(2):
            changed = list(blobs)
            changed[index] = "f" * 40
            with patch.object(release, "git", side_effect=[name, *changed]), patch.object(release.subprocess, "run"), self.assertRaisesRegex(release.ReleaseError, "exact reviewed email"):
                release.vetted_changes(release.EMAIL_RELEASE_BASELINE, NEW)

    def test_candidate_operator_must_equal_independently_trusted_executing_bytes(self):
        name = "ops/vps/code-release.py"
        raw = Path(release.__file__).read_bytes()
        expected = release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        for blob in (expected, "f" * 40):
            with patch.object(release, "git", side_effect=[name, blob]), patch.object(release.subprocess, "run"):
                if blob == expected:
                    self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                else:
                    with self.assertRaisesRegex(release.ReleaseError, "independently trusted staged source"):
                        release.vetted_changes(OLD, NEW)

    def test_registered_vendor_application_and_runtime_files_still_reject_unknown_bytes(self):
        for name in ("vendor/tooling-glob/adapter-factory.cjs", ".npmrc", "lib/platform-announcements.ts", "scripts/prepare-vps-runtime.mjs"):
            for digest in (release.REVIEWED_APPLICATION_BLOBS[name], "f" * 40):
                with patch.object(release, "git", side_effect=[name, digest]), patch.object(release.subprocess, "run"):
                    if digest == release.REVIEWED_APPLICATION_BLOBS[name]:
                        self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                    else:
                        with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                            release.vetted_changes(OLD, NEW)
        for name in ("vendor/unreviewed/package.json", "scripts/unreviewed-release.py", "app/unreviewed/route.ts"):
            with patch.object(release, "git", return_value=name), patch.object(release.subprocess, "run"), self.assertRaisesRegex(release.ReleaseError, "Unvetted source path"):
                release.vetted_changes(OLD, NEW)

    def test_consent_migration_has_only_exact_new_schema_and_no_existing_row_changes(self):
        name = "drizzle/0061_platform_announcement_consent.sql"
        raw = b"-- Separate, explicit BeCore Tickets consent. Existing event/host permission is\n-- intentionally not copied or changed, and no provider contacts are imported.\nCREATE TABLE platform_announcement_subscriptions (\n  email TEXT PRIMARY KEY NOT NULL,\n  status TEXT NOT NULL CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),\n  consent_version TEXT NOT NULL,\n  consented_at TEXT,\n  verified_at TEXT,\n  unsubscribed_at TEXT,\n  source TEXT NOT NULL CHECK (source IN ('rsvp', 'checkout', 'preferences', 'unsubscribe')),\n  source_id TEXT NOT NULL,\n  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);\nCREATE INDEX platform_announcement_status_idx ON platform_announcement_subscriptions(status, email);\n\n-- source/source_id is an immutable submission receipt: a replay can never\n-- convert the original unchecked choice, refresh consent or clear suppression.\nCREATE TABLE platform_announcement_choices (\n  id TEXT PRIMARY KEY NOT NULL,\n  email TEXT NOT NULL,\n  source TEXT NOT NULL CHECK (source IN ('rsvp', 'checkout', 'preferences', 'unsubscribe', 'verification')),\n  source_id TEXT NOT NULL,\n  opted_in INTEGER NOT NULL CHECK (opted_in IN (0, 1)),\n  verified_email INTEGER NOT NULL CHECK (verified_email IN (0, 1)),\n  consent_version TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  UNIQUE (source, source_id)\n);\nCREATE INDEX platform_announcement_choices_email_idx ON platform_announcement_choices(email, created_at);\n\n-- Capabilities are revoke-only and hashed at rest. No arbitrary expiry: a token\n-- remains valid for its consent revision until that subscription changes.\nCREATE TABLE platform_announcement_unsubscribe_tokens (\n  token_hash TEXT PRIMARY KEY NOT NULL,\n  email TEXT NOT NULL,\n  subscription_revision INTEGER NOT NULL,\n  created_at TEXT NOT NULL\n);\nCREATE INDEX platform_announcement_tokens_email_idx ON platform_announcement_unsubscribe_tokens(email, subscription_revision);\n\n-- Proof may finalize only the exact pending choice that the emailed link named.\n-- Existing recovery links have no binding and cannot activate announcements.\nCREATE TABLE platform_announcement_verifications (\n  grant_type TEXT NOT NULL CHECK (grant_type IN ('recovery', 'registration')),\n  grant_id TEXT NOT NULL,\n  email TEXT NOT NULL,\n  subscription_revision INTEGER NOT NULL,\n  source TEXT NOT NULL,\n  source_id TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  consumed_at TEXT,\n  PRIMARY KEY (grant_type, grant_id)\n);\n"
        specification = dict(path=name, **release.REVIEWED_MIGRATIONS[name])
        self.assertEqual(release.hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest(), specification["blob"])
        statements, rows = release.reviewed_migration(raw, specification)
        self.assertEqual(len(statements), 7)
        self.assertEqual({row[0] for row in rows}, {"table", "index"})
        self.assertEqual({row[2] for row in rows}, set(specification["tables"]))
        for changed in (raw + b"\n", raw + b"DELETE FROM orders;\n"):
            with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                release.reviewed_migration(changed, specification)


class CheckoutUiAdmissionTests(unittest.TestCase):
    # Only the user-reviewed checkout increment is admitted; neighbouring paths
    # and a changed byte in any one of these files still fail closed.
    pins = {
        ".github/workflows/booking-consent-previews.yml": "457e562c72109975dfb2d8951230661728861003",
        "app/booking-consent.css": "1c0cdd4081d3a6b05dff7e5b909693ba675f5720",
        "app/checkout/[slug]/checkout-form.tsx": "24706bdce798c20926c17e83aeeba485b43f1bb6",
        "app/globals.css": "4ac15d8e4cc0a372123c4309443fd056c74fef92",
        "playwright.seev.config.ts": "1eeacbb76fc58a3d9aa6d1566e1c8870ad2484e5",
        "scripts/prepare-seev-browser-fixture.mjs": "46dfe0aa8f609bc810e128ec006d1c3f3a3c9442",
        "tests/e2e/checkout-quantity.spec.ts": "63118dc45063fdc9d214d1c677846fa47dde0c22",
        "tests/mobile-ui.test.mjs": "e5d555bfb255df96eb84aa1c73dc5c392b686d2f",
    }

    def test_checkout_admits_only_the_eight_exact_reviewed_blobs(self):
        with patch.object(release, "verify_changed_modes"), patch.object(release.subprocess, "run"):
            for name, blob in self.pins.items():
                with self.subTest(name=name):
                    self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], blob)
                    with patch.object(release, "git", side_effect=[name, blob]):
                        self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                    with patch.object(release, "git", side_effect=[name, "f" * 40]):
                        with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                            release.vetted_changes(OLD, NEW)

    def test_checkout_admission_does_not_allow_neighbouring_source_paths(self):
        with patch.object(release, "verify_changed_modes"), patch.object(release.subprocess, "run"):
            for name in ("app/checkout/new-flow.tsx", "app/unreviewed-checkout.css", "playwright.new-checkout.config.ts", "scripts/new-checkout-fixture.mjs", ".github/workflows/new-checkout.yml"):
                with self.subTest(name=name), patch.object(release, "git", return_value=name):
                    with self.assertRaisesRegex(release.ReleaseError, "Unvetted source path"):
                        release.vetted_changes(OLD, NEW)


class ResourceReleaseAdmissionTests(unittest.TestCase):
    pins = {
        ".github/workflows/browser-audit.yml": "3f99ab138e84a9dbd9c0b0cf36a4c5e5300b16a3",
        "app/admin/operations/organizer-activity.tsx": "c4ad962d9b1d3d9d13817f88c7673a6fda850aea",
        "docs/reliability/event-capacity.md": "e52c861a5ce2465610aafc58d9c37ffdd2fb1fc6",
        "lib/flashes.ts": "94c8df484d3872ff60d2ff46ebc093edd82d280b",
        "runtime/vps/queue.mjs": "22b48966ba3f3a25271425dcb846137fd611f96d",
        "tests/flashes.test.ts": "694627fbedeafaa80e0e6cb61513450b667b2142",
        "tests/organizer-activity-polling.test.mjs": "6cd0bf5c0b30953f8b9eb917c646b6a49e010527",
        "tests/repository-boundaries.test.mjs": "cf49012d4db8fef0273603b3ffbadd5a422341cd",
        "tests/room-abuse-boundaries.test.ts": "df61c41a01867ceebf123216e16e6c10f7c2bd3d",
        "tests/the-room.test.ts": "9431b1eb7231a2e36382d351441c1b3034366096",
        "tests/vps-operations.test.mjs": "a8fe59356a29502889fd2af41f3338225582f556",
        "worker/the-room.ts": "baf738dba9c08cc1390fa6863f2ac5603c04e83e",
    }

    def setUp(self):
        modes = patch.object(release, "verify_changed_modes")
        modes.start()
        self.addCleanup(modes.stop)

    def test_root_transition_requires_exact_active_baseline_and_both_package_blobs(self):
        self.assertEqual(release.RESOURCE_RELEASE_BASELINE, "5e1b1aada332d8ce4986c26291594a929aa95d53")
        changed = "package.json\npackage-lock.json"
        blobs = ["83f5e03b9fbbdf10f050c8dd24d06ed1ff59260b",
                 "91d44944a682f992880c44785d7b14eda9204c18",
                 "cc161d4ef33ca9affdf1c6649071cb4bf27b71dc",
                 "47a4eaca5743b768598462d8b66a2ef49a442b4e"]
        with patch.object(release, "git", side_effect=[changed, *blobs]) as git, patch.object(release.subprocess, "run"):
            self.assertEqual(release.vetted_changes(release.RESOURCE_RELEASE_BASELINE, NEW), changed.splitlines())
            self.assertEqual(git.call_args_list, [
                call("diff", "--name-only", release.RESOURCE_RELEASE_BASELINE, NEW),
                call("rev-parse", release.RESOURCE_RELEASE_BASELINE + ":package.json"),
                call("rev-parse", NEW + ":package.json"),
                call("rev-parse", release.RESOURCE_RELEASE_BASELINE + ":package-lock.json"),
                call("rev-parse", NEW + ":package-lock.json")])
        for index in range(len(blobs)):
            tampered = list(blobs)
            tampered[index] = "f" * 40
            with self.subTest(blob=index), patch.object(release, "git", side_effect=[changed, *tampered]), patch.object(release.subprocess, "run"):
                with self.assertRaisesRegex(release.ReleaseError, "reviewed security patch"):
                    release.vetted_changes(release.RESOURCE_RELEASE_BASELINE, NEW)
        for baseline in (OLD, release.EMAIL_RELEASE_BASELINE):
            with self.subTest(baseline=baseline), patch.object(release, "git", side_effect=[changed, *blobs]), patch.object(release.subprocess, "run"):
                with self.assertRaisesRegex(release.ReleaseError, "reviewed security patch"):
                    release.vetted_changes(baseline, NEW)

    def test_root_transition_rejects_a_partial_package_pair(self):
        for name in ("package.json", "package-lock.json"):
            with self.subTest(name=name), patch.object(release, "git", return_value=name) as git, patch.object(release.subprocess, "run"):
                with self.assertRaisesRegex(release.ReleaseError, "both package files"):
                    release.vetted_changes(release.RESOURCE_RELEASE_BASELINE, NEW)
                git.assert_called_once_with("diff", "--name-only", release.RESOURCE_RELEASE_BASELINE, NEW)

    def test_resource_changes_admit_only_the_exact_reviewed_application_bytes(self):
        with patch.object(release.subprocess, "run"):
            for name, blob in self.pins.items():
                with self.subTest(name=name):
                    self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], blob)
                    with patch.object(release, "git", side_effect=[name, blob]):
                        self.assertEqual(release.vetted_changes(release.RESOURCE_RELEASE_BASELINE, NEW), [name])
                    with patch.object(release, "git", side_effect=[name, "f" * 40]):
                        with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                            release.vetted_changes(release.RESOURCE_RELEASE_BASELINE, NEW)

    def test_resource_admission_keeps_neighbouring_application_paths_closed(self):
        with patch.object(release.subprocess, "run"):
            for name in ("app/admin/operations/unreviewed.tsx", "lib/unreviewed-flashes.ts",
                         "runtime/vps/unreviewed-queue.mjs", "worker/unreviewed-room.ts",
                         ".github/workflows/unreviewed-browser.yml"):
                with self.subTest(name=name), patch.object(release, "git", return_value=name):
                    with self.assertRaisesRegex(release.ReleaseError, "Unvetted source path"):
                        release.vetted_changes(release.RESOURCE_RELEASE_BASELINE, NEW)


class CloudflareCostAdmissionTests(unittest.TestCase):
    pins = {
        "app/api/customer/notifications/route.ts": "6712aa29c24593ee65650c2c0e1a2e52e1636462",
        "docs/reliability/event-capacity.md": "e52c861a5ce2465610aafc58d9c37ffdd2fb1fc6",
        "tests/cloudflare-image-budget.test.mjs": "6b67fac15bc5e620ddd666ff85bbe20299c4e276",
        "tests/cloudflare-notification-metering.test.mjs": "0b226d1cce9c255c92c49f62fee3aee0296041ae",
        "tests/notification-read-budget.test.ts": "c7d44367f67124f70f3c10c26d6c84a7d8f8a9e8",
        "tests/repository-boundaries.test.mjs": "cf49012d4db8fef0273603b3ffbadd5a422341cd",
        "worker/index.ts": "620c06554292d8a8236d35349462f53371ab7415",
    }

    def test_cost_guards_admit_only_the_seven_exact_reviewed_blobs(self):
        with patch.object(release, "verify_changed_modes"), patch.object(release.subprocess, "run"):
            for name, blob in self.pins.items():
                with self.subTest(name=name):
                    self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], blob)
                    with patch.object(release, "git", side_effect=[name, blob]):
                        self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                    with patch.object(release, "git", side_effect=[name, "f" * 40]):
                        with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                            release.vetted_changes(OLD, NEW)

    def test_cost_admission_keeps_neighbouring_application_paths_closed(self):
        with patch.object(release, "verify_changed_modes"), patch.object(release.subprocess, "run"):
            for name in ("app/api/customer/notifications/unreviewed.ts", "worker/unreviewed-image.ts",
                         "lib/unreviewed-notification.ts", "wrangler.unreviewed.jsonc"):
                with self.subTest(name=name), patch.object(release, "git", return_value=name):
                    with self.assertRaisesRegex(release.ReleaseError, "Unvetted source path"):
                        release.vetted_changes(OLD, NEW)

    def test_cost_candidate_cannot_be_its_own_trusted_operator_baseline(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=NEW), patch.object(release.subprocess, "check_output") as git:
            with self.assertRaisesRegex(release.ReleaseError, "cannot be its own trusted"):
                release.verify_trusted_operator(NEW)
            git.assert_not_called()


class HostRsvpPushAdmissionTests(unittest.TestCase):
    pins = {'app/api/organizer/notifications/subscription/route.ts': '1326df418932f18b8007e3410232a725f105f7eb', 'app/organizer/workspace/host-rsvp-alerts.tsx': 'eac1f7be6fa0a3515dc87549b0cdd1fc6b870832', 'app/organizer/workspace/organizer-suite.tsx': 'fbe4e78c876ce03a3bc36c26ce97087ab24931a5', 'app/organizer/workspace/page.tsx': 'b92e80fb99297cab5cfb100bf62e85f8948c2bfa', 'app/organizer/workspace/suite.css': '427038c93ca19550c65e7cbafe4eb95c5ad250c7', 'app/registration-manager.tsx': '388a488887b5d0b52a5a77b536904659dc311d32', 'db/schema.ts': 'bcd304ce4bf518e2b71d707e36a1438c6a65ee04', 'lib/event-audience.ts': 'fb8e73aee376426e9b58abb02dc6dc8ba85e3892', 'lib/organizer-rsvp-push.ts': 'f843394ca5c7c4f9d823aa37e78ecb4f25585126', 'lib/payment-operations.ts': 'd8701182ced11abcbae5b3590a4d6db203ee45b7', 'public/sw.js': '5e59b045ded41b5e6033fea174993349d5742373', 'worker/background.ts': 'd5683c2699242330cec52fe5962614e33e635bdb', 'lib/email-delivery.ts': 'dcad73b8a824af75949a8b02cba9977d00b182f8'}

    def test_exact_application_pins_and_no_neighbouring_authority(self):
        for name, digest in self.pins.items():
            self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], digest)
            self.assertNotIn(name, release.APPLICATION_FILES)
        with patch.object(release, 'verify_changed_modes'), patch.object(release.subprocess, 'run'):
            for name, digest in self.pins.items():
                with self.subTest(path=name), patch.object(release, 'git', side_effect=[name, digest]):
                    self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                with self.subTest(changed=name), patch.object(release, 'git', side_effect=[name, 'f'*40]):
                    with self.assertRaisesRegex(release.ReleaseError, 'reviewed source'):
                        release.vetted_changes(OLD, NEW)
            for name in ('lib/unreviewed-host-push.ts', 'app/api/organizer/notifications/admin/route.ts', 'drizzle/0064_unreviewed.sql'):
                with self.subTest(unrelated=name), patch.object(release, 'git', return_value=name):
                    with self.assertRaisesRegex(release.ReleaseError, 'Unvetted source path'):
                        release.vetted_changes(OLD, NEW)


class HostRsvpPushMigrationTests(unittest.TestCase):
    # Embedded exact bytes allow the production staged-operator layout to run
    # these checks without copying application SQL into its trusted control tree.
    SQL = b"-- Additive, opt-in host devices; no historical RSVP backfill.\nCREATE TABLE organizer_push_subscriptions (\n id TEXT PRIMARY KEY,\n account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,\n session_id TEXT NOT NULL REFERENCES staff_sessions(id) ON DELETE CASCADE,\n consent_id TEXT NOT NULL,\n endpoint TEXT NOT NULL UNIQUE,\n p256dh TEXT NOT NULL,\n auth TEXT NOT NULL,\n created_at TEXT NOT NULL,\n updated_at TEXT NOT NULL,\n revoked_at TEXT\n);\nCREATE INDEX organizer_push_account ON organizer_push_subscriptions(account_id, revoked_at);\nCREATE TABLE organizer_rsvp_push_deliveries (\n id TEXT PRIMARY KEY,\n subscription_version TEXT NOT NULL,\n registration_id TEXT NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,\n subscription_id TEXT NOT NULL REFERENCES organizer_push_subscriptions(id) ON DELETE CASCADE,\n account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,\n created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),\n attempts INTEGER NOT NULL DEFAULT 0,\n lease_until TEXT,\n claim TEXT,\n completed_at TEXT,\n outcome TEXT\n);\nCREATE UNIQUE INDEX organizer_rsvp_push_device ON organizer_rsvp_push_deliveries(registration_id, subscription_id);\nCREATE INDEX organizer_rsvp_push_pending ON organizer_rsvp_push_deliveries(completed_at, lease_until, created_at);\nCREATE TRIGGER organizer_rsvp_push_created AFTER INSERT ON event_registrations\nWHEN NEW.kind='rsvp' AND NEW.status IN ('requested','waitlisted','confirmed')\nBEGIN\n INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)\n SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id\n FROM organizer_push_subscriptions p JOIN staff_event_assignments a ON a.account_id=p.account_id\n JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id\n WHERE a.event_slug=NEW.event_slug AND p.revoked_at IS NULL AND s.role='organizer' AND s.status='active'\n AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');\nEND;\nCREATE TRIGGER organizer_rsvp_push_verified AFTER UPDATE OF status ON event_registrations\nWHEN NEW.kind='rsvp' AND OLD.status='unverified' AND NEW.status IN ('requested','waitlisted','confirmed')\nBEGIN\n INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)\n SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id\n FROM organizer_push_subscriptions p JOIN staff_event_assignments a ON a.account_id=p.account_id\n JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id\n WHERE a.event_slug=NEW.event_slug AND p.revoked_at IS NULL AND s.role='organizer' AND s.status='active'\n AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');\nEND;\n"

    @staticmethod
    def seed(connection):
        connection.executescript("""
            CREATE TABLE orders(id TEXT PRIMARY KEY, status TEXT);
            INSERT INTO orders VALUES('preserved-order','paid');
            CREATE TABLE staff_accounts(id TEXT PRIMARY KEY, role TEXT, status TEXT, must_change_password INTEGER);
            INSERT INTO staff_accounts VALUES('host','organizer','active',0);
            CREATE TABLE staff_sessions(id TEXT PRIMARY KEY,account_id TEXT,revoked_at TEXT,expires_at TEXT);
            INSERT INTO staff_sessions VALUES('session','host',NULL,'2099-01-01');
            CREATE TABLE staff_event_assignments(account_id TEXT,event_slug TEXT);
            INSERT INTO staff_event_assignments VALUES('host','event');
            CREATE TABLE event_registrations(id TEXT PRIMARY KEY,event_slug TEXT,kind TEXT,status TEXT);
            INSERT INTO event_registrations VALUES('historical','event','rsvp','requested');
            CREATE TABLE preserved_business_audit(registration_id TEXT);
            CREATE TRIGGER existing_business_trigger AFTER INSERT ON event_registrations
            BEGIN INSERT INTO preserved_business_audit VALUES(NEW.id); END;
        """)
        connection.commit()

    @staticmethod
    def opt_in(connection):
        connection.execute("INSERT INTO organizer_push_subscriptions(id,account_id,session_id,consent_id,endpoint,p256dh,auth,created_at,updated_at) VALUES('device','host','session','consent','https://fcm.googleapis.com/fcm/send/fixture','fixture','fixture','2026-01-01','2026-01-01')")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root/'tickets.sqlite'
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.seed(connection)
        self.database.chmod(0o600)
        self.staging = self.root/'backup'
        self.spec = release.migration_plan([release.HOST_RSVP_PUSH_PATH])[0]

    def migrate(self, raw=None, spec=None):
        return release.migrate_database(self.database, self.staging, [(self.spec if spec is None else spec, self.SQL if raw is None else raw)])

    def test_exact_admission_backup_and_no_backfill_preserve_existing_schema_and_rows(self):
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            before=release.schema_rows(connection)
        result=self.migrate()
        self.assertTrue(result['created'])
        self.assertTrue(result['tablesPreservedOnRollback'])
        self.assertEqual(result['backupSha256'],release.digest_file(self.staging/'before.sqlite'))
        self.assertEqual(stat.S_IMODE((self.staging/'before.sqlite').stat().st_mode),0o600)
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.assertTrue(all(row in release.schema_rows(connection) for row in before))
            self.assertEqual(connection.execute('SELECT * FROM orders').fetchall(),[('preserved-order','paid')])
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM organizer_rsvp_push_deliveries').fetchone(),(0,))
            self.opt_in(connection)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM organizer_rsvp_push_deliveries').fetchone(),(0,))
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_replay_is_exact_noop_preserving_devices_and_captured_work(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.opt_in(connection)
            connection.execute("INSERT INTO event_registrations VALUES('new','event','rsvp','requested')")
            before=connection.execute('SELECT * FROM organizer_rsvp_push_deliveries').fetchall()
        self.staging=self.root/'second-backup'
        self.assertFalse(self.migrate()['created'])
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.assertEqual(connection.execute('SELECT * FROM organizer_rsvp_push_deliveries').fetchall(),before)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM organizer_push_subscriptions').fetchone(),(1,))

    def test_modified_bytes_target_timing_and_forged_specification_rejected_before_backup(self):
        for raw in (self.SQL+b'\n',self.SQL+b'DELETE FROM orders;',self.SQL.replace(b'AFTER INSERT',b'BEFORE INSERT'),self.SQL.replace(b'ON event_registrations',b'ON orders')):
            with self.subTest(raw=release.hashlib.sha256(raw).hexdigest()), self.assertRaisesRegex(release.ReleaseError,'exact reviewed source'):
                self.migrate(raw=raw)
            self.assertFalse(self.staging.exists())
        for key,value in [('sha256','a'*64),('blob','a'*40),('schemaSha256','a'*64),('tables',['orders']),('triggers',{'arbitrary':'orders'})]:
            with self.subTest(field=key),self.assertRaisesRegex(release.ReleaseError,'exact reviewed source'):
                self.migrate(spec=dict(self.spec,**{key:value}))
            self.assertFalse(self.staging.exists())

    def test_generic_trigger_grammar_stays_closed(self):
        with self.assertRaisesRegex(release.ReleaseError,'Only the reviewed refund rollback guard'):
            release.additive_statements(self.SQL,self.spec)
        with self.assertRaises(release.ReleaseError):
            release.reviewed_migration(self.SQL,dict(self.spec,path='drizzle/0064_unreviewed.sql'))

    def test_partial_schema_rejected_and_existing_booking_preserved(self):
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            connection.execute('CREATE TABLE organizer_push_subscriptions(id TEXT PRIMARY KEY)')
        with self.assertRaisesRegex(release.ReleaseError,'partial or differs'):
            self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.assertEqual(connection.execute('SELECT * FROM orders').fetchall(),[('preserved-order','paid')])
            self.assertIsNone(connection.execute("SELECT name FROM sqlite_schema WHERE name='organizer_rsvp_push_deliveries'").fetchone())

    def test_drifted_trigger_rejected_without_destroying_pending_work(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.opt_in(connection)
            connection.execute("INSERT INTO event_registrations VALUES('new','event','rsvp','requested')")
            connection.execute('DROP TRIGGER organizer_rsvp_push_created')
            connection.execute('CREATE TRIGGER organizer_rsvp_push_created AFTER INSERT ON event_registrations BEGIN SELECT 1; END')
        self.staging=self.root/'second-backup'
        with self.assertRaisesRegex(release.ReleaseError,'partial or differs'):
            self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.assertEqual(connection.execute('SELECT registration_id FROM organizer_rsvp_push_deliveries').fetchall(),[('new',)])

    def test_booking_capture_rolls_back_and_later_approval_does_not_duplicate(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.opt_in(connection);connection.commit()
            with self.assertRaises(release.sqlite3.OperationalError), connection:
                connection.execute("INSERT INTO event_registrations VALUES('rollback','event','rsvp','requested')")
                connection.execute('INSERT INTO missing_table VALUES(1)')
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM organizer_rsvp_push_deliveries').fetchone(),(0,))
            connection.execute("INSERT INTO event_registrations VALUES('new','event','rsvp','unverified')")
            connection.execute("UPDATE event_registrations SET status='requested' WHERE id='new'")
            connection.execute("UPDATE event_registrations SET status='confirmed' WHERE id='new'")
            self.assertEqual(connection.execute('SELECT registration_id FROM organizer_rsvp_push_deliveries').fetchall(),[('new',)])

    def test_failed_schema_transaction_rolls_back_every_addition(self):
        # Simulate a disk/SQL failure after the exact admitted first statement;
        # the live operator must roll back rather than leave a partial schema.
        original=release.reviewed_migration
        def fail_after_first(raw,spec):
            statements,rows=original(raw,spec)
            return [statements[0],'INSERT INTO missing_table VALUES(1)'],rows
        with patch.object(release,'reviewed_migration',side_effect=fail_after_first):
            with self.assertRaises(release.sqlite3.OperationalError):self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as connection, connection:
            self.assertIsNone(connection.execute("SELECT name FROM sqlite_schema WHERE name='organizer_push_subscriptions'").fetchone())
            self.assertEqual(connection.execute('SELECT * FROM orders').fetchall(),[('preserved-order','paid')])


class HostRsvpPushDeploymentTests(DeploymentFixture):
    def prepare_push(self, raw=None):
        state=self.root/'var/lib/becore-tickets';state.chmod(0o700)
        with release.closing(release.sqlite3.connect(state/'tickets.sqlite')) as connection, connection:HostRsvpPushMigrationTests.seed(connection)
        (state/'tickets.sqlite').chmod(0o600)
        member=tarfile.TarInfo('migrations/0063_host_rsvp_push.sql');member.mode=0o644
        self.make_archive(extra=(member,HostRsvpPushMigrationTests.SQL if raw is None else raw))
        self.proof['changedFiles']=[release.HOST_RSVP_PUSH_PATH]
        self.proof['migrations']=release.migration_plan(self.proof['changedFiles'])
        self.refresh_digests()
        return state

    def test_tampered_migration_never_restarts_the_service(self):
        self.prepare_push(HostRsvpPushMigrationTests.SQL+b'\n')
        with self.assertRaises(release.ReleaseError):self.deployment.transact()
        self.assertEqual(self.system.restarts,0)
        self.assert_restored()

    def test_failed_activation_preserves_bookings_devices_and_pending_alerts(self):
        state=self.prepare_push();self.system.fail='local'
        restart=self.system.restart
        def activated():
            restart()
            if self.system.revision==NEW:
                with release.closing(release.sqlite3.connect(state/'tickets.sqlite')) as connection, connection:
                    HostRsvpPushMigrationTests.opt_in(connection)
                    connection.execute("INSERT INTO orders VALUES('new-paid-order','paid')")
                    connection.execute("INSERT INTO event_registrations VALUES('new','event','rsvp','requested')")
        self.system.restart=activated
        with self.assertRaisesRegex(release.ReleaseError,'previous release restored'):self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.revision,OLD)
        with release.closing(release.sqlite3.connect(state/'tickets.sqlite')) as connection, connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM orders').fetchone(),(2,))
            self.assertEqual(connection.execute('SELECT registration_id FROM organizer_rsvp_push_deliveries').fetchall(),[('new',)])
        # Structural rollback only. OLD restores its original host-email behavior;
        # it does not inherit the candidate's push-only suppression. Release review
        # must explicitly retain that caveat/forward-recovery plan, never erase data.
        self.assertTrue((self.deployment.snapshot/'database/before.sqlite').is_file())

    def test_successful_activation_records_exact_migration_and_backup(self):
        self.prepare_push();result=self.deployment.transact()
        self.assertTrue(result['dataMigration'])
        journal=release.strict_json(self.deployment.journal.read_bytes())
        self.assertEqual(journal['lastCodeRelease']['additiveMigrations'],release.migration_plan([release.HOST_RSVP_PUSH_PATH]))
        self.assertEqual(len(journal['lastCodeRelease']['databaseBackupSha256']),64)


class HostPurchaseMigrationTests(unittest.TestCase):
    SQL = b"-- Additive delivery outbox; captured by the verified-payment transaction only.\nCREATE TABLE organizer_purchase_push_deliveries (\n id TEXT PRIMARY KEY,\n subscription_version TEXT NOT NULL,\n order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,\n subscription_id TEXT NOT NULL REFERENCES organizer_push_subscriptions(id) ON DELETE CASCADE,\n account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,\n created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),\n attempts INTEGER NOT NULL DEFAULT 0,\n lease_until TEXT,\n claim TEXT,\n completed_at TEXT,\n outcome TEXT\n);\nCREATE UNIQUE INDEX organizer_purchase_push_device ON organizer_purchase_push_deliveries(order_id, subscription_id);\nCREATE INDEX organizer_purchase_push_pending ON organizer_purchase_push_deliveries(completed_at, lease_until, created_at);\n"
    PATH = 'drizzle/0064_host_purchase_push.sql'

    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);self.database=self.root/'tickets.sqlite';self.staging=self.root/'backup'
        with release.closing(release.sqlite3.connect(self.database)) as db,db:
            HostRsvpPushMigrationTests.seed(db)
            db.executescript(HostRsvpPushMigrationTests.SQL.decode())
            HostRsvpPushMigrationTests.opt_in(db)
        self.database.chmod(0o600)
        self.spec=release.migration_plan([self.PATH])[0]

    def migrate(self,raw=None):
        return release.migrate_database(self.database,self.staging,[(self.spec,self.SQL if raw is None else raw)])

    def test_exact_existing_grammar_accepts_only_new_table_and_indexes(self):
        statements,rows=release.additive_statements(self.SQL,self.spec)
        self.assertEqual(len(statements),3)
        self.assertEqual(sorted(row[0] for row in rows),['index','index','table'])
        self.assertTrue(all(row[2]=='organizer_purchase_push_deliveries' for row in rows))
        self.assertNotIn('triggers',self.spec)
        with release.closing(release.sqlite3.connect(self.database)) as db:
            before=release.schema_rows(db)
        result=self.migrate();self.assertTrue(result['created'])
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.assertTrue(all(row in release.schema_rows(db) for row in before))
            self.assertEqual(db.execute('SELECT * FROM orders').fetchall(),[('preserved-order','paid')])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM organizer_purchase_push_deliveries').fetchone(),(0,))
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(stat.S_IMODE((self.staging/'before.sqlite').stat().st_mode),0o600)

    def test_one_byte_target_or_extra_statement_rejected_before_backup(self):
        for raw in (self.SQL+b'\n',self.SQL.replace(b'ON organizer_purchase_push_deliveries',b'ON orders'),self.SQL+b'DELETE FROM orders;'):
            with self.subTest(raw=release.hashlib.sha256(raw).hexdigest()),self.assertRaises(release.ReleaseError):self.migrate(raw)
            self.assertFalse(self.staging.exists())

    def test_generic_existing_table_trigger_restriction_is_unchanged(self):
        raw=b'CREATE TRIGGER purchase_test BEFORE INSERT ON orders BEGIN SELECT 1; END;'
        forged=dict(self.spec,sha256=release.hashlib.sha256(raw).hexdigest(),triggers={'purchase_test':'orders'})
        with self.assertRaisesRegex(release.ReleaseError,'Only the reviewed refund rollback guard'):release.additive_statements(raw,forged)

    def test_replay_preserves_captured_purchase_and_parent_booking(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db,db:
            db.execute("INSERT INTO organizer_purchase_push_deliveries(id,subscription_version,order_id,subscription_id,account_id) VALUES('capture','consent','preserved-order','device','host')")
            before=db.execute('SELECT * FROM organizer_purchase_push_deliveries').fetchall()
        self.staging=self.root/'second-backup';self.assertFalse(self.migrate()['created'])
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute('SELECT * FROM organizer_purchase_push_deliveries').fetchall(),before)
            self.assertEqual(db.execute('SELECT * FROM orders').fetchall(),[('preserved-order','paid')])

    def test_partial_schema_rejected_without_rewriting_bookings(self):
        with release.closing(release.sqlite3.connect(self.database)) as db,db:db.execute('CREATE TABLE organizer_purchase_push_deliveries(id TEXT)')
        with self.assertRaisesRegex(release.ReleaseError,'partial or differs'):self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db:self.assertEqual(db.execute('SELECT * FROM orders').fetchall(),[('preserved-order','paid')])


class HostNotificationsDeploymentTests(DeploymentFixture):
    def prepare_notifications(self,tampered=False):
        state=self.root/'var/lib/becore-tickets';state.chmod(0o700)
        with release.closing(release.sqlite3.connect(state/'tickets.sqlite')) as db,db:HostRsvpPushMigrationTests.seed(db)
        (state/'tickets.sqlite').chmod(0o600)
        items=[]
        for path,raw in [(release.HOST_RSVP_PUSH_PATH,HostRsvpPushMigrationTests.SQL),(HostPurchaseMigrationTests.PATH,HostPurchaseMigrationTests.SQL+(b'\n' if tampered else b''))]:
            member=tarfile.TarInfo('migrations/'+Path(path).name);member.mode=0o644;items.append((member,raw))
        self.make_archive(extra=items);self.proof['changedFiles']=[release.HOST_RSVP_PUSH_PATH,HostPurchaseMigrationTests.PATH]
        self.proof['migrations']=release.migration_plan(self.proof['changedFiles']);self.refresh_digests();return state

    def test_both_migrations_and_backup_recorded(self):
        self.prepare_notifications();self.assertTrue(self.deployment.transact()['dataMigration'])
        journal=release.strict_json(self.deployment.journal.read_bytes())
        self.assertEqual(journal['lastCodeRelease']['additiveMigrations'],self.proof['migrations'])
        self.assertEqual(len(journal['lastCodeRelease']['databaseBackupSha256']),64)

    def test_tampered_purchase_sql_prevents_any_restart(self):
        self.prepare_notifications(tampered=True)
        with self.assertRaises(release.ReleaseError):self.deployment.transact()
        self.assertEqual(self.system.restarts,0);self.assert_restored()

    def test_failed_activation_retains_both_outboxes_and_new_paid_booking(self):
        state=self.prepare_notifications();self.system.fail='local';restart=self.system.restart
        def activated():
            restart()
            if self.system.revision==NEW:
                with release.closing(release.sqlite3.connect(state/'tickets.sqlite')) as db,db:
                    HostRsvpPushMigrationTests.opt_in(db)
                    db.execute("INSERT INTO orders VALUES('new-paid-order','paid')")
                    db.execute("INSERT INTO event_registrations VALUES('new','event','rsvp','requested')")
                    db.execute("INSERT INTO organizer_purchase_push_deliveries(id,subscription_version,order_id,subscription_id,account_id) VALUES('capture','consent','new-paid-order','device','host')")
        self.system.restart=activated
        with self.assertRaisesRegex(release.ReleaseError,'previous release restored'):self.deployment.transact()
        self.assert_restored()
        with release.closing(release.sqlite3.connect(state/'tickets.sqlite')) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM orders').fetchone(),(2,))
            self.assertEqual(db.execute('SELECT registration_id FROM organizer_rsvp_push_deliveries').fetchall(),[('new',)])
            self.assertEqual(db.execute('SELECT order_id FROM organizer_purchase_push_deliveries').fetchall(),[('new-paid-order',)])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
        # Structural rollback; separate exact-F application rehearsal verifies mail policy.


class WorkspaceReleaseAdmissionTests(unittest.TestCase):
    """Real Git: independent controls C and copied snapshot S application bytes."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git("init", "-q")
        self.git("config", "user.name", "Workspace release tests")
        self.git("config", "user.email", "tests@example.invalid")
        self.write("app/source.ts", "baseline application\n")
        self.write("ops/vps/code-release.py", "baseline operator\n")
        self.write("ops/vps/test_code_release.py", "baseline tests\n")
        self.write("scripts/audit-release-manifest.json", "frozen expired exception\n")
        self.write("package.json", '{"scripts":{"test:ui":"old"},"dependencies":{"same":"1"}}\n')
        self.write("package-lock.json", '{"locked":"unchanged"}\n')
        self.base = self.commit()
        self.write("app/source.ts", "reviewed workspace application\n")
        self.write("package.json", '{"scripts":{"test:ui":"new"},"dependencies":{"same":"1"}}\n')
        self.snapshot = self.commit()
        self.pins = {name: self.git("rev-parse", self.snapshot + ":" + name)
                     for name in ("app/source.ts", "package.json")}
        self.git("checkout", "-q", self.base)
        self.write("ops/vps/code-release.py", "independently reviewed operator\n")
        self.write("ops/vps/test_code_release.py", "independently reviewed tests\n")
        self.control = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", self.control)
        for name in self.pins:
            self.write(name, self.git("show", self.snapshot + ":" + name) + "\n")
        self.candidate = self.commit()
        settings = {
            "WORKSPACE_RELEASE_BASELINE": self.base,
            "WORKSPACE_BASE_TREE": self.git("rev-parse", self.base + "^{tree}"),
            "WORKSPACE_APP_SNAPSHOT": self.snapshot,
            "WORKSPACE_APP_TREE": self.git("rev-parse", self.snapshot + "^{tree}"),
            "WORKSPACE_APPLICATION_BLOBS": self.pins,
            "WORKSPACE_MIGRATION_FILES": set(),
            "WORKSPACE_PACKAGE_BLOBS": tuple(self.git("rev-parse", ref + ":package.json")
                                             for ref in (self.base, self.snapshot)),
            "WORKSPACE_LOCK_BLOB": self.git("rev-parse", self.base + ":package-lock.json"),
            "__file__": str(self.root / "ops/vps/code-release.py"),
        }
        for name, value in settings.items():
            patcher = patch.object(release, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        environment = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        environment.start()
        self.addCleanup(environment.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(raw)
        return path

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "isolated workspace release")
        return self.git("rev-parse", "HEAD")

    def verify(self, candidate=None):
        return release.vetted_changes(self.base, candidate or self.candidate)

    def test_exact_snapshot_copy_onto_independent_controls_is_accepted(self):
        self.assertEqual(set(self.verify()), set(self.pins) | release.WORKSPACE_CONTROL_FILES)
        self.assertNotEqual(self.snapshot, self.candidate)
        result = subprocess.run(["git", "merge-base", "--is-ancestor", self.snapshot, self.candidate],
                                capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_snapshot_tree_parent_and_complete_inventory_are_immutable(self):
        for name, value in (("WORKSPACE_BASE_TREE", "f" * 40),
                            ("WORKSPACE_APP_TREE", "f" * 40),
                            ("WORKSPACE_APPLICATION_BLOBS", {"app/source.ts": self.pins["app/source.ts"]})):
            with self.subTest(field=name), patch.object(release, name, value):
                with self.assertRaisesRegex(release.ReleaseError, "snapshot"):
                    self.verify()
        other = self.git("commit-tree", release.WORKSPACE_APP_TREE, "-m", "unrelated snapshot")
        with patch.object(release, "WORKSPACE_APP_SNAPSHOT", other):
            with self.assertRaisesRegex(release.ReleaseError, "snapshot"):
                self.verify()

    def test_application_mutation_missing_change_and_unrelated_paths_are_rejected(self):
        for name, raw in (("app/source.ts", "unreviewed\n"),
                          ("app/source.ts", "baseline application\n"),
                          ("docs/unreviewed.md", "even ordinary documentation is outside this snapshot\n"),
                          ("tests/unreviewed.test.ts", "unreviewed test\n"),
                          ("scripts/audit-release-manifest.json", "revived exception\n")):
            with self.subTest(path=name, raw=raw):
                self.git("reset", "--hard", self.candidate)
                self.write(name, raw)
                with self.assertRaisesRegex(release.ReleaseError, "exact application snapshot"):
                    self.verify(self.commit())

    def test_exact_new_application_blob_is_not_admitted_from_another_baseline(self):
        with self.assertRaises(release.ReleaseError):
            release.vetted_changes(self.control, self.candidate)

    def test_candidate_cannot_select_itself_or_snapshot_as_control(self):
        for trusted in (self.candidate, self.snapshot):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_control_must_be_merged_and_ancestor_of_the_candidate(self):
        self.git("update-ref", "refs/remotes/origin/main", self.base)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()
        self.git("update-ref", "refs/remotes/origin/main", self.control)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify(self.snapshot)

    def test_changed_control_bytes_and_application_in_trusted_controls_fail_closed(self):
        self.write("ops/vps/test_code_release.py", "candidate rewrote its tests\n")
        with self.assertRaisesRegex(release.ReleaseError, "controls differ"):
            self.verify(self.commit())
        self.git("reset", "--hard", self.control)
        self.write("app/source.ts", "changed inside controls\n")
        changed_control = self.commit()
        for name in self.pins:
            self.write(name, self.git("show", self.snapshot + ":" + name) + "\n")
        candidate = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", changed_control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed_control):
            with self.assertRaisesRegex(release.ReleaseError, "controls contain application"):
                self.verify(candidate)

    def test_deletion_symlink_and_mode_changes_remain_rejected(self):
        for kind in ("delete", "symlink", "executable"):
            self.git("reset", "--hard", self.candidate)
            path = self.root / "app/source.ts"
            if kind == "executable":
                path.chmod(0o755)
            else:
                path.unlink()
                if kind == "symlink":
                    path.symlink_to("../package.json")
            with self.subTest(kind=kind), self.assertRaises(release.ReleaseError):
                self.verify(self.commit())

    def test_package_and_lock_each_require_the_exact_reviewed_blobs(self):
        for field, value in (("WORKSPACE_PACKAGE_BLOBS", ("f" * 40, release.WORKSPACE_PACKAGE_BLOBS[1])),
                             ("WORKSPACE_PACKAGE_BLOBS", (release.WORKSPACE_PACKAGE_BLOBS[0], "f" * 40)),
                             ("WORKSPACE_LOCK_BLOB", "f" * 40)):
            with self.subTest(field=field, value=value), patch.object(release, field, value):
                with self.assertRaisesRegex(release.ReleaseError, "unchanged dependency lock"):
                    self.verify()
        original = release.git
        def non_script_change(*args):
            raw = original(*args)
            if args == ("show", self.candidate + ":package.json"):
                return raw.replace('"same":"1"', '"same":"2"')
            return raw
        with patch.object(release, "git", side_effect=non_script_change):
            with self.assertRaisesRegex(release.ReleaseError, "not scripts-only"):
                self.verify()

    def test_complete_application_byte_pins_are_checked_after_snapshot_selection(self):
        with patch.dict(release.WORKSPACE_APPLICATION_BLOBS, {"app/source.ts": "f" * 40}):
            with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                self.verify()

    def test_git_replacement_cannot_redirect_the_snapshot(self):
        self.git("replace", self.snapshot, self.candidate)
        self.assertEqual(set(self.verify()), set(self.pins) | release.WORKSPACE_CONTROL_FILES)


class WorkspaceReleasePinTests(unittest.TestCase):
    def test_scope_is_finite_and_root_dependencies_are_unchanged(self):
        self.assertEqual(release.WORKSPACE_RELEASE_BASELINE, "379be609c49e8994dbd6b5bf5883c9be733369b1")
        self.assertEqual(release.WORKSPACE_APP_TREE, "1f2533264b8e48d440ee6bbeeb3c503652e1f659")
        self.assertEqual(len(release.WORKSPACE_APPLICATION_BLOBS), 76)
        self.assertEqual(release.WORKSPACE_CONTROL_FILES,
                         {"ops/vps/code-release.py", "ops/vps/test_code_release.py"})
        self.assertEqual(release.WORKSPACE_PACKAGE_BLOBS,
                         ("91d44944a682f992880c44785d7b14eda9204c18", "ee7d351bd660b932e9870b6d542da4426386eca5"))
        self.assertEqual(release.WORKSPACE_LOCK_BLOB, "47a4eaca5743b768598462d8b66a2ef49a442b4e")
        self.assertFalse(set(release.WORKSPACE_APPLICATION_BLOBS) & release.WORKSPACE_MIGRATION_FILES)
        self.assertNotIn("scripts/audit-release-manifest.json", release.WORKSPACE_APPLICATION_BLOBS)
        self.assertNotIn("scripts/audit-release-dependencies.py", release.WORKSPACE_APPLICATION_BLOBS)



class WorkspaceSchemaMigrationTests(unittest.TestCase):
    # Exact reviewed application SQL is embedded for the staged-control layout.
    ARCHIVE_SQL = b'-- A reversible display archive. Do not reuse removed_at: removal destroys data.\nALTER TABLE curated_event_records ADD COLUMN archived_at TEXT;\nCREATE INDEX curated_event_archive_idx ON curated_event_records(archived_at, starts_at);\n'
    OWNER_SQL = b"-- Extend opt-in notifications to owner existing all-event access. No historical backfill.\nDROP TRIGGER organizer_rsvp_push_created;\nDROP TRIGGER organizer_rsvp_push_verified;\nCREATE TRIGGER organizer_rsvp_push_created AFTER INSERT ON event_registrations\nWHEN NEW.kind='rsvp' AND NEW.status IN ('requested','waitlisted','confirmed')\nBEGIN\n INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)\n SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id\n FROM organizer_push_subscriptions p\n JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=p.account_id\n WHERE p.revoked_at IS NULL AND (s.role='owner' OR (s.role='organizer' AND EXISTS (SELECT 1 FROM staff_event_assignments a WHERE a.account_id=s.id AND a.event_slug=NEW.event_slug))) AND s.status='active'\n AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');\nEND;\nCREATE TRIGGER organizer_rsvp_push_verified AFTER UPDATE OF status ON event_registrations\nWHEN NEW.kind='rsvp' AND OLD.status='unverified' AND NEW.status IN ('requested','waitlisted','confirmed')\nBEGIN\n INSERT OR IGNORE INTO organizer_rsvp_push_deliveries(id,registration_id,subscription_id,account_id,subscription_version)\n SELECT lower(hex(randomblob(16))),NEW.id,p.id,p.account_id,p.consent_id\n FROM organizer_push_subscriptions p\n JOIN staff_accounts s ON s.id=p.account_id JOIN staff_sessions ss ON ss.id=p.session_id AND ss.account_id=p.account_id\n WHERE p.revoked_at IS NULL AND (s.role='owner' OR (s.role='organizer' AND EXISTS (SELECT 1 FROM staff_event_assignments a WHERE a.account_id=s.id AND a.event_slug=NEW.event_slug))) AND s.status='active'\n AND ss.revoked_at IS NULL AND s.must_change_password=0 AND ss.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');\nEND;\n"
    # Result of the curated-table CREATE/ALTER statements in migrations 0001–0054.
    ARCHIVE_BEFORE_SQL = "CREATE TABLE `curated_event_records` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`submission_id` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`title` text NOT NULL,\n\t`venue` text NOT NULL,\n\t`area` text NOT NULL,\n\t`starts_at` text NOT NULL,\n\t`ends_at` text NOT NULL,\n\t`vibe` text NOT NULL,\n\t`price_from_minor` integer NOT NULL,\n\t`image_url` text NOT NULL,\n\t`curation_note` text NOT NULL,\n\t`status` text NOT NULL,\n\t`scheduled_publish_at` text,\n\t`published_at` text,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL\n, `capacity` integer DEFAULT 0 NOT NULL, `sales_open_at` text, `sales_close_at` text, `venue_map_url` text, `age_restriction` text DEFAULT '18+' NOT NULL, `lineup` text DEFAULT 'Line-up to be announced' NOT NULL, `event_state` text DEFAULT 'on_sale' NOT NULL, `rescheduled_from` text, `is_test_event` integer DEFAULT false NOT NULL, `dress_code` text, `colour_scheme` text, `awareness_note` text, `guest_perk` text, `schedule_status` text DEFAULT 'confirmed' NOT NULL, `is_verified` integer DEFAULT false NOT NULL, `tagline` text, `removed_at` text, schedule_label TEXT, organizer_owner_id TEXT)"

    @staticmethod
    def seed(db):
        HostRsvpPushMigrationTests.seed(db)
        db.execute(WorkspaceSchemaMigrationTests.ARCHIVE_BEFORE_SQL)
        db.executescript("""
            CREATE UNIQUE INDEX `curated_events_submission_unique` ON `curated_event_records` (`submission_id`);
            CREATE UNIQUE INDEX `curated_events_slug_unique` ON `curated_event_records` (`slug`);
            CREATE INDEX `curated_events_publication_idx` ON `curated_event_records` (`status`,`scheduled_publish_at`);
            CREATE TABLE preserved_payload(id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), payload BLOB CHECK(length(payload)>0));
            INSERT INTO preserved_payload VALUES('private-payload','preserved-order',x'00ff1122');
            CREATE TRIGGER removed_event_stays_removed BEFORE UPDATE ON curated_event_records
            WHEN OLD.removed_at IS NOT NULL AND (NEW.removed_at IS NULL OR NEW.status <> 'unpublished')
            BEGIN SELECT RAISE(ABORT, 'Removed events cannot be republished'); END;
        """)
        for event in ('event', 'removed', 'other'):
            db.execute("""INSERT INTO curated_event_records
                (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,
                 price_from_minor,image_url,curation_note,status,created_at,updated_at,removed_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (event, 'submission-' + event, event, 'Preserved ' + event, 'Venue', 'Area',
                 '2026-11-01', '2026-11-02', 'vibe', 123, '/event.webp', 'note',
                 'unpublished' if event == 'removed' else 'published', 'before', 'before',
                 'already-removed' if event == 'removed' else None))
        db.executescript(HostRsvpPushMigrationTests.SQL.decode())
        db.executescript(HostPurchaseMigrationTests.SQL.decode())
        HostRsvpPushMigrationTests.opt_in(db)
        db.executescript("""
            INSERT INTO staff_accounts VALUES('owner','owner','active',0);
            INSERT INTO staff_sessions VALUES('owner-session','owner',NULL,'2099-01-01');
            INSERT INTO organizer_push_subscriptions(id,account_id,session_id,consent_id,endpoint,p256dh,auth,created_at,updated_at)
            VALUES('owner-device','owner','owner-session','owner-consent','https://fcm.googleapis.com/fcm/send/owner','fixture','fixture','before','before');
            INSERT INTO event_registrations VALUES('pending-before','event','rsvp','requested');
            INSERT INTO organizer_purchase_push_deliveries(id,subscription_version,order_id,subscription_id,account_id)
            VALUES('purchase-before','consent','preserved-order','device','host');
        """)
        for statement in HostVerificationMigrationTests.WRITER_GUARD_STATEMENTS[:2]:
            db.execute(statement)
        db.execute("UPDATE _bct_handover_state SET transfer_id='preserved-transfer'")
        # These are the original handover generator's exact, quoted guards.
        for table in ('curated_event_records', 'event_registrations', 'orders'):
            for statement in HostVerificationMigrationTests.WRITER_GUARD_STATEMENTS[2:]:
                db.execute(statement.replace('hosts', table))
        db.commit()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.use_database('initial')

    def use_database(self, name):
        self.database = self.root / (name + '.sqlite')
        self.staging = self.root / (name + '-backup')
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.seed(db)
        self.database.chmod(0o600)

    def plan(self):
        return list(zip(release.migration_plan(release.WORKSPACE_SCHEMA_PATHS), (self.ARCHIVE_SQL, self.OWNER_SQL)))

    def migrate(self, migrations=None):
        return release.migrate_database(self.database, self.staging, self.plan() if migrations is None else migrations)

    def snapshot(self, database=None):
        with release.closing(release.sqlite3.connect(database or self.database)) as db:
            schema = release.schema_rows(db)
            data = {name: db.execute('SELECT * FROM "' + name + '" ORDER BY rowid').fetchall()
                    for kind, name, _, _ in schema if kind == 'table'}
            return schema, data

    def test_exact_schema_pins_preserve_all_data_constraints_and_writer_guards(self):
        before, data = self.snapshot()
        with release.closing(release.sqlite3.connect(self.database)) as db:
            columns = db.execute('PRAGMA table_xinfo(curated_event_records)').fetchall()
        result = self.migrate()
        after, actual = self.snapshot()
        expected_data = dict(data, curated_event_records=[row + (None,) for row in data['curated_event_records']])
        self.assertEqual(actual, expected_data)
        changed = {name for spec, _ in self.plan() for name in spec['objects']}
        self.assertEqual([row for row in before if row[1] not in changed], [row for row in after if row[1] not in changed])
        for spec, _ in self.plan():
            self.assertEqual(release.schema_digest([row for row in before if row[1] in spec['objects']]), spec['beforeSchemaSha256'])
            self.assertEqual(release.schema_digest([row for row in after if row[1] in spec['objects']]), spec['schemaSha256'])
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            self.assertEqual(db.execute('PRAGMA table_xinfo(curated_event_records)').fetchall(),
                             columns + [(len(columns), 'archived_at', 'TEXT', 0, None, 0, 0)])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
            with self.assertRaises(release.sqlite3.IntegrityError):
                db.execute("UPDATE curated_event_records SET id=NULL WHERE id='event'")
            with self.assertRaises(release.sqlite3.IntegrityError):
                db.execute("UPDATE curated_event_records SET slug='event' WHERE id='other'")
            with self.assertRaisesRegex(release.sqlite3.IntegrityError, 'cannot be republished'):
                db.execute("UPDATE curated_event_records SET removed_at=NULL WHERE id='removed'")
            db.execute('UPDATE _bct_handover_state SET frozen=1')
            for sql in ("UPDATE curated_event_records SET archived_at='later' WHERE id='event'",
                        "INSERT INTO event_registrations VALUES('blocked','event','rsvp','requested')",
                        "DELETE FROM orders WHERE id='preserved-order'"):
                with self.assertRaisesRegex(release.sqlite3.IntegrityError, 'paused for verified handover'):
                    db.execute(sql)
        self.assertTrue(result['created'])
        self.assertTrue(result['tablesPreservedOnRollback'])
        self.assertEqual(result['migrations'], [spec for spec, _ in self.plan()])
        self.assertEqual(result['backupSha256'], release.digest_file(self.staging / 'before.sqlite'))
        self.assertEqual(stat.S_IMODE((self.staging / 'before.sqlite').stat().st_mode), 0o600)
        self.assertEqual(self.snapshot(self.staging / 'before.sqlite'), (before, data))

    def test_complete_replay_is_noop_preserving_archives_and_pending_work(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute("UPDATE curated_event_records SET archived_at='owner-archived' WHERE id='event'")
            db.execute("INSERT INTO event_registrations VALUES('new-pending','other','rsvp','requested')")
        before = self.snapshot()
        self.staging = self.root / 'replay-backup'
        self.assertFalse(self.migrate()['created'])
        self.assertEqual(self.snapshot(), before)

    def test_individual_migrations_and_resumed_pair_remain_exact(self):
        archive, owner = self.plan()
        self.assertTrue(self.migrate([archive])['created'])
        self.staging = self.root / 'resume-backup'
        self.assertTrue(self.migrate()['created'])
        self.staging = self.root / 'owner-replay-backup'
        self.assertFalse(self.migrate([owner])['created'])
        self.use_database('owner-first')
        self.assertTrue(self.migrate([owner])['created'])
        self.staging = self.root / 'archive-after-owner-backup'
        self.assertTrue(self.migrate([archive])['created'])

    def test_owner_capture_and_old_registration_writes_work_without_backfill(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            self.assertEqual(db.execute('SELECT registration_id,account_id FROM organizer_rsvp_push_deliveries').fetchall(),
                             [('pending-before', 'host')])
            # Legacy runtime insert/update shapes remain valid. Owners need no
            # assignment; organizers still need the existing event assignment.
            for identity, event, kind, status in (
                    ('assigned', 'event', 'rsvp', 'requested'),
                    ('unassigned', 'other', 'rsvp', 'requested'),
                    ('unverified', 'other', 'rsvp', 'unverified'),
                    ('ticket', 'other', 'ticket', 'confirmed'),
                    ('cancelled', 'other', 'rsvp', 'cancelled')):
                db.execute('INSERT INTO event_registrations VALUES(?,?,?,?)', (identity, event, kind, status))
            db.execute("UPDATE event_registrations SET status='requested' WHERE id='unverified'")
            db.execute("UPDATE event_registrations SET status='confirmed' WHERE id='unverified'")
            self.assertEqual(db.execute('SELECT registration_id,account_id FROM organizer_rsvp_push_deliveries ORDER BY registration_id,account_id').fetchall(),
                             [('assigned', 'host'), ('assigned', 'owner'), ('pending-before', 'host'),
                              ('unassigned', 'owner'), ('unverified', 'owner')])
            self.assertEqual(db.execute("SELECT archived_at FROM curated_event_records WHERE id='event'").fetchone(), (None,))

    def test_owner_capture_preserves_optin_role_session_and_account_boundaries(self):
        self.migrate()
        cases = (
            "UPDATE organizer_push_subscriptions SET revoked_at='revoked' WHERE account_id='owner'",
            "UPDATE staff_accounts SET status='disabled' WHERE id='owner'",
            "UPDATE staff_accounts SET role='scanner' WHERE id='owner'",
            "UPDATE staff_accounts SET must_change_password=1 WHERE id='owner'",
            "UPDATE staff_sessions SET revoked_at='revoked' WHERE account_id='owner'",
            "UPDATE staff_sessions SET expires_at='2000-01-01' WHERE account_id='owner'",
            "UPDATE organizer_push_subscriptions SET session_id='session' WHERE account_id='owner'",
        )
        with release.closing(release.sqlite3.connect(self.database)) as db:
            for index, sql in enumerate(cases):
                with self.subTest(sql=sql):
                    db.execute('BEGIN')
                    db.execute(sql)
                    db.execute("INSERT INTO event_registrations VALUES(?, 'other','rsvp','requested')", ('blocked-' + str(index),))
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM organizer_rsvp_push_deliveries WHERE registration_id=?', ('blocked-' + str(index),)).fetchone(), (0,))
                    db.rollback()

    def test_mutated_sql_and_every_forged_specification_field_fail_before_backup(self):
        for spec, raw in self.plan():
            for mutation in (raw + b'\n', raw + b'DELETE FROM orders;', raw.replace(b'curated_event_records', b'orders')
                             if spec['path'] == release.RECOVERABLE_ARCHIVE_PATH else raw.replace(b's.role=\'owner\'', b'1=1')):
                with self.subTest(path=spec['path'], mutation=release.hashlib.sha256(mutation).hexdigest()), self.assertRaisesRegex(release.ReleaseError, 'exact reviewed source'):
                    self.migrate([(spec, mutation)])
                self.assertFalse(self.staging.exists())
            for key in spec:
                value = ['orders'] if key == 'objects' else 'forged'
                with self.subTest(path=spec['path'], field=key), self.assertRaises(release.ReleaseError):
                    self.migrate([(dict(spec, **{key: value}), raw)])
                self.assertFalse(self.staging.exists())
            with self.assertRaises(release.ReleaseError):
                self.migrate([(dict(spec, extra=True), raw)])
            self.assertFalse(self.staging.exists())

    def test_generic_alter_drop_and_arbitrary_trigger_grammar_remain_closed(self):
        for raw in (b'ALTER TABLE curated_event_records ADD COLUMN other TEXT;',
                    b'DROP TRIGGER organizer_rsvp_push_created;',
                    b'CREATE TRIGGER arbitrary AFTER INSERT ON event_registrations BEGIN SELECT 1; END;'):
            spec = dict(path='drizzle/unreviewed.sql', sha256=release.hashlib.sha256(raw).hexdigest(),
                        tables=['curated_event_records'], schemaSha256='0' * 64)
            with self.subTest(sql=raw), self.assertRaises(release.ReleaseError):
                release.reviewed_migration(raw, spec)
        archive, owner = self.plan()
        for plan in ([archive, archive], [owner, archive],
                     [archive, (AdditiveMigrationTests.specification(), AdditiveMigrationTests.SQL)],
                     [(release.migration_plan([release.HOST_RSVP_PUSH_PATH])[0], HostRsvpPushMigrationTests.SQL), owner]):
            with self.subTest(paths=[spec['path'] for spec, _ in plan]), self.assertRaisesRegex(release.ReleaseError, 'isolated, ordered, non-duplicate'):
                self.migrate(plan)
            self.assertFalse(self.staging.exists())

    def test_archive_partial_column_index_and_constraint_drift_rejected(self):
        cases = (
            'ALTER TABLE curated_event_records ADD COLUMN archived_at TEXT',
            'CREATE INDEX curated_event_archive_idx ON curated_event_records(starts_at)',
            'ALTER TABLE curated_event_records ADD COLUMN archived_at INTEGER',
            "ALTER TABLE curated_event_records ADD COLUMN archived_at TEXT NOT NULL DEFAULT 'changed'",
            'ALTER TABLE curated_event_records ADD COLUMN unreviewed TEXT',
        )
        for index, sql in enumerate(cases):
            self.use_database('archive-drift-' + str(index))
            with release.closing(release.sqlite3.connect(self.database)) as db, db:
                db.execute(sql)
            before = self.snapshot()
            with self.subTest(sql=sql), self.assertRaisesRegex(release.ReleaseError, 'partial or differs'):
                self.migrate()
            self.assertEqual(self.snapshot(), before)

    def test_missing_drifted_mixed_and_replayed_trigger_states_rejected(self):
        for index, state in enumerate(('missing', 'changed', 'mixed', 'new-missing')):
            self.use_database('trigger-drift-' + str(index))
            if state in ('mixed', 'new-missing'):
                self.migrate()
                self.staging = self.root / ('trigger-replay-' + str(index))
            with release.closing(release.sqlite3.connect(self.database)) as db, db:
                db.execute('DROP TRIGGER organizer_rsvp_push_created')
                if state == 'changed':
                    db.execute('CREATE TRIGGER organizer_rsvp_push_created AFTER INSERT ON event_registrations BEGIN SELECT 1; END')
                if state == 'mixed':
                    old = release.reviewed_migration(HostRsvpPushMigrationTests.SQL,
                                                    release.migration_plan([release.HOST_RSVP_PUSH_PATH])[0])[0]
                    db.execute(old[-2])
            before = self.snapshot()
            with self.subTest(state=state), self.assertRaisesRegex(release.ReleaseError, 'partial or differs'):
                self.migrate()
            # In pre-migration states, 0065 has also been rolled back atomically.
            self.assertEqual(self.snapshot(), before)

    def test_drifted_outbox_prerequisites_fail_without_altering_archive_or_rows(self):
        for index, sql in enumerate((
                'DROP INDEX organizer_rsvp_push_device',
                'ALTER TABLE organizer_rsvp_push_deliveries ADD COLUMN unreviewed TEXT',
                'DROP INDEX organizer_push_account')):
            self.use_database('prerequisite-drift-' + str(index))
            with release.closing(release.sqlite3.connect(self.database)) as db, db:
                db.execute(sql)
            before = self.snapshot()
            with self.subTest(sql=sql), self.assertRaisesRegex(release.ReleaseError, 'prerequisites differ'):
                self.migrate()
            self.assertEqual(self.snapshot(), before)

    def test_frozen_missing_and_drifted_writer_state_rejected_including_replay(self):
        cases = (
            'UPDATE _bct_handover_state SET frozen=1',
            'DELETE FROM _bct_handover_state',
            'ALTER TABLE _bct_handover_state ADD COLUMN unreviewed TEXT',
            'DROP TRIGGER _bct_guard_curated_event_records_update',
            'DROP TRIGGER _bct_guard_event_registrations_insert',
            'DROP TRIGGER _bct_guard_curated_event_records_delete; CREATE TRIGGER _bct_guard_curated_event_records_delete BEFORE DELETE ON curated_event_records BEGIN SELECT 1; END;',
        )
        for applied in (False, True):
            for index, sql in enumerate(cases):
                self.use_database('writer-' + str(applied) + '-' + str(index))
                if applied:
                    self.migrate()
                    self.staging = self.root / ('writer-replay-' + str(index))
                with release.closing(release.sqlite3.connect(self.database)) as db, db:
                    db.executescript(sql)
                before = self.snapshot()
                with self.subTest(applied=applied, sql=sql), self.assertRaises(release.ReleaseError):
                    self.migrate()
                self.assertEqual(self.snapshot(), before)

    def test_sql_failure_after_each_ddl_statement_rolls_back_both_migrations(self):
        original = release.reviewed_migration
        for path, count in ((release.RECOVERABLE_ARCHIVE_PATH, 2), (release.OWNER_NOTIFICATIONS_PATH, 4)):
            for stop in range(1, count + 1):
                self.use_database('failure-' + Path(path).stem + '-' + str(stop))
                before = self.snapshot()
                def inject_failure(raw, spec):
                    statements, rows = original(raw, spec)
                    if spec['path'] == path:
                        statements = statements[:stop] + ['INSERT INTO missing_table VALUES(1)'] + statements[stop:]
                    return statements, rows
                with patch.object(release, 'reviewed_migration', side_effect=inject_failure):
                    with self.subTest(path=path, stop=stop), self.assertRaises(release.sqlite3.OperationalError):
                        self.migrate()
                self.assertEqual(self.snapshot(), before)
                self.assertEqual(self.snapshot(self.staging / 'before.sqlite'), before)
                self.assertEqual(release.strict_json((self.staging / 'result.json').read_bytes())['phase'], 'backed-up')

    def test_unreviewed_schema_or_row_mutation_after_exact_ddl_rolls_back(self):
        original = release.reviewed_migration
        for index, extra in enumerate(('CREATE TABLE unreviewed(id TEXT)',
                                       "UPDATE orders SET status='rewritten'",
                                       'DROP TRIGGER _bct_guard_orders_update')):
            self.use_database('postcondition-' + str(index))
            before = self.snapshot()
            def inject_mutation(raw, spec):
                statements, rows = original(raw, spec)
                return statements + ([extra] if spec['path'] == release.OWNER_NOTIFICATIONS_PATH else []), rows
            with patch.object(release, 'reviewed_migration', side_effect=inject_mutation):
                with self.subTest(extra=extra), self.assertRaisesRegex(release.ReleaseError, 'unreviewed schema, rows or writer state'):
                    self.migrate()
            self.assertEqual(self.snapshot(), before)

    def test_pair_is_invisible_until_commit_and_competing_writer_cannot_interleave(self):
        before = self.snapshot()
        original = release.apply_workspace_schema
        def observe_transaction(connection, specification, statements):
            changed = original(connection, specification, statements)
            # A second connection still sees the complete original schema and
            # data even after ALTER and each trigger replacement have run.
            self.assertEqual(self.snapshot(), before)
            with release.closing(release.sqlite3.connect(self.database, timeout=0)) as competing:
                with self.assertRaisesRegex(release.sqlite3.OperationalError, 'locked'):
                    competing.execute("INSERT INTO event_registrations VALUES('concurrent','event','rsvp','requested')")
            return changed
        with patch.object(release, 'apply_workspace_schema', side_effect=observe_transaction):
            self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute("INSERT INTO event_registrations VALUES('after-commit','event','rsvp','requested')")
            self.assertEqual(db.execute("SELECT account_id FROM organizer_rsvp_push_deliveries WHERE registration_id='after-commit' ORDER BY account_id").fetchall(), [('host',), ('owner',)])

    def test_post_commit_evidence_failure_preserves_schema_and_safe_replay(self):
        original = release.write_json
        def fail_verified_result(path, value):
            if value.get('phase') == 'verified':
                raise OSError('simulated evidence write failure')
            return original(path, value)
        with patch.object(release, 'write_json', side_effect=fail_verified_result):
            with self.assertRaisesRegex(OSError, 'evidence write failure'):
                self.migrate()
        before = self.snapshot()
        self.staging = self.root / 'recovery-backup'
        self.assertFalse(self.migrate()['created'])
        self.assertEqual(self.snapshot(), before)


class WorkspaceSchemaDeploymentTests(DeploymentFixture):
    def prepare_workspace(self, tampered=False):
        state = self.root / 'var/lib/becore-tickets'
        state.chmod(0o700)
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db:
            WorkspaceSchemaMigrationTests.seed(db)
        (state / 'tickets.sqlite').chmod(0o600)
        items = []
        for path, raw in zip(release.WORKSPACE_SCHEMA_PATHS,
                             (WorkspaceSchemaMigrationTests.ARCHIVE_SQL, WorkspaceSchemaMigrationTests.OWNER_SQL)):
            member = tarfile.TarInfo('migrations/' + Path(path).name)
            member.mode = 0o644
            items.append((member, raw + (b'\n' if tampered and path == release.OWNER_NOTIFICATIONS_PATH else b'')))
        self.make_archive(extra=items)
        self.proof['changedFiles'] = list(release.WORKSPACE_SCHEMA_PATHS)
        self.proof['migrations'] = release.migration_plan(self.proof['changedFiles'])
        self.refresh_digests()
        return state

    def test_success_records_exact_migrations_private_backup_and_preserved_schema(self):
        self.prepare_workspace()
        self.assertTrue(self.deployment.transact()['dataMigration'])
        journal = release.strict_json(self.deployment.journal.read_bytes())
        self.assertEqual(journal['lastCodeRelease']['reviewedDataMigrations'], self.proof['migrations'])
        self.assertEqual(len(journal['lastCodeRelease']['databaseBackupSha256']), 64)
        self.assertTrue((self.deployment.snapshot / 'database/before.sqlite').is_file())

    def test_tampered_migration_prevents_restart_or_schema_change(self):
        state = self.prepare_workspace(tampered=True)
        with self.assertRaises(release.ReleaseError):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assert_restored()
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db:
            self.assertNotIn('archived_at', [row[1] for row in db.execute('PRAGMA table_xinfo(curated_event_records)')])

    def test_runtime_rollback_preserves_new_schema_and_post_activation_data(self):
        state = self.prepare_workspace()
        self.system.fail = 'local'
        restart = self.system.restart
        def activated():
            restart()
            if self.system.revision == NEW:
                with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
                    db.execute("UPDATE curated_event_records SET archived_at='owner-archived' WHERE id='event'")
                    db.execute("INSERT INTO orders VALUES('new-paid-order','paid')")
                    db.execute("INSERT INTO event_registrations VALUES('new-owner-alert','other','rsvp','requested')")
        self.system.restart = activated
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.revision, OLD)
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM orders').fetchone(), (2,))
            self.assertEqual(db.execute("SELECT archived_at FROM curated_event_records WHERE id='event'").fetchone(), ('owner-archived',))
            self.assertEqual(db.execute("SELECT account_id FROM organizer_rsvp_push_deliveries WHERE registration_id='new-owner-alert'").fetchall(), [('owner',)])
            # The previous runtime still has compatible explicit-column writes.
            db.execute("UPDATE curated_event_records SET title='Old runtime write' WHERE id='event'")
            db.execute("INSERT INTO event_registrations VALUES('after-rollback','event','rsvp','requested')")
            self.assertEqual(db.execute("SELECT account_id FROM organizer_rsvp_push_deliveries WHERE registration_id='after-rollback' ORDER BY account_id").fetchall(), [('host',), ('owner',)])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        self.assertTrue((self.deployment.snapshot / 'database/before.sqlite').is_file())
        # This proves schema/data compatibility, not old-application delivery of
        # the newly captured owner work. Keep pending work for forward recovery.



class HostBrandIdentityMigrationTests(unittest.TestCase):
    # Embedded immutable application SQL also supports the staged-control layout.
    SQL = (b"-- Public brand presentation only. Preserve personal identity, verification,\n"
           b"-- event associations, organizer credits, permissions and financial records.\n"
           b"ALTER TABLE hosts ADD COLUMN brand_name TEXT;\n"
           b"ALTER TABLE hosts ADD COLUMN brand_logo_url TEXT;\n\n"
           b"UPDATE hosts\n"
           b"SET brand_name = 'The Yorke Way', brand_logo_url = '/hosts/the-yorke-way.svg',\n"
           b"    updated_at = CURRENT_TIMESTAMP\n"
           b"WHERE id = 'host:kofi-bills' AND slug = 'kofi-bills';\n")
    # Result of the original hosts CREATE in 0011 and the three ALTERs in 0045.
    BEFORE_SQL = "CREATE TABLE `hosts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`slug` text NOT NULL,\n\t`name` text NOT NULL,\n\t`bio` text NOT NULL,\n\t`city` text DEFAULT 'Accra' NOT NULL,\n\t`verification_status` text DEFAULT 'reviewed' NOT NULL,\n\t`profile_image_url` text,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL\n, full_name TEXT, instagram_handle TEXT, snapchat_handle TEXT)"

    @staticmethod
    def seed(db):
        db.execute(HostBrandIdentityMigrationTests.BEFORE_SQL)
        db.executescript("""
            CREATE UNIQUE INDEX `hosts_slug_unique` ON `hosts` (`slug`);
            INSERT INTO hosts VALUES ('host:kofi-bills','kofi-bills','Kofi Bills','Personal bio','Accra',
                'verified','/hosts/kofi-bills.webp','created','before','Henry Yorke','mr.yorke','kofi_billz123');
            INSERT INTO hosts VALUES ('host:other','other','Other host','Other biography','Cape Coast',
                'reviewed','/hosts/other.webp','other-created','other-updated','Other Person',NULL,NULL);
            CREATE TABLE events(id TEXT PRIMARY KEY, title TEXT, flyer TEXT, credit TEXT);
            INSERT INTO events VALUES('event','Original title','/events/flyer.webp','Club House Inc');
            CREATE TABLE event_hosts(event_slug TEXT REFERENCES events(id),host_id TEXT REFERENCES hosts(id),role TEXT,is_primary INTEGER);
            INSERT INTO event_hosts VALUES('event','host:kofi-bills','Host',0);
            INSERT INTO event_hosts VALUES('event','host:other','Organiser',1);
            CREATE TABLE staff(id TEXT PRIMARY KEY,role TEXT);
            INSERT INTO staff VALUES('staff','scanner');
            CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT);
            INSERT INTO orders VALUES('preserved-order','paid');
            CREATE TABLE preserved_payload(id TEXT PRIMARY KEY,order_id TEXT REFERENCES orders(id),payload BLOB);
            INSERT INTO preserved_payload VALUES('private','preserved-order',x'00ff1122');
        """)
        for statement in HostVerificationMigrationTests.WRITER_GUARD_STATEMENTS:
            db.execute(statement)
        db.execute("UPDATE _bct_handover_state SET transfer_id='preserved-original-transfer'")
        db.commit()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.specification = release.migration_plan([release.HOST_BRAND_IDENTITY_PATH])[0]
        self.use_database('initial')

    def use_database(self, name):
        self.database = self.root / (name + '.sqlite')
        self.staging = self.root / (name + '-backup')
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.seed(db)
        self.database.chmod(0o600)

    def migrate(self, plan=None):
        return release.migrate_database(self.database, self.staging,
            [(self.specification, self.SQL)] if plan is None else plan)

    def snapshot(self, path=None):
        with release.closing(release.sqlite3.connect(path or self.database)) as db:
            schema = release.schema_rows(db)
            return schema, {row[1]: db.execute('SELECT * FROM "' + row[1] + '" ORDER BY rowid').fetchall()
                            for row in schema if row[0] == 'table'}

    def test_exact_transition_preserves_every_other_table_and_personal_field(self):
        before_schema, before = self.snapshot()
        result = self.migrate()
        schema, after = self.snapshot()
        self.assertEqual(result['publicHostBrand'], {'hostId': 'host:kofi-bills', 'changed': True,
                                                   'preservedOnCodeRollback': True})
        self.assertTrue(result['created'])
        self.assertTrue(result['tablesPreservedOnRollback'])
        self.assertEqual(result['schemaSha256'], self.specification['schemaSha256'])
        self.assertEqual(result['migrations'], [self.specification])
        self.assertEqual([r for r in schema if r[1] != 'hosts'], [r for r in before_schema if r[1] != 'hosts'])
        self.assertEqual({k: v for k, v in after.items() if k != 'hosts'},
                         {k: v for k, v in before.items() if k != 'hosts'})
        self.assertEqual(after['hosts'][0][:8] + after['hosts'][0][9:12],
                         before['hosts'][0][:8] + before['hosts'][0][9:12])
        self.assertEqual(after['hosts'][0][-2:], ('The Yorke Way', '/hosts/the-yorke-way.svg'))
        self.assertRegex(after['hosts'][0][8], r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
        self.assertEqual(after['hosts'][1], before['hosts'][1] + (None, None))
        self.assertEqual(self.snapshot(self.staging / 'before.sqlite'), (before_schema, before))
        self.assertEqual(stat.S_IMODE(self.staging.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.staging / 'before.sqlite').stat().st_mode), 0o600)
        self.assertEqual(result['backupSha256'], release.digest_file(self.staging / 'before.sqlite'))

    def test_exact_replay_preserves_timestamps_and_later_unrelated_host_brand(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute("UPDATE hosts SET brand_name='Other brand',brand_logo_url='/other.svg',updated_at='later' WHERE id='host:other'")
            db.execute("UPDATE hosts SET name='Current personal name',updated_at='later-personal-edit' WHERE id='host:kofi-bills'")
        before = self.snapshot()
        self.staging = self.root / 'replay'
        result = self.migrate()
        self.assertFalse(result['created'])
        self.assertFalse(result['publicHostBrand']['changed'])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.snapshot(self.staging / 'before.sqlite'), before)

    def test_missing_mismatched_or_ambiguous_host_identity_fails_before_ddl(self):
        cases = (
            "DELETE FROM event_hosts WHERE host_id='host:kofi-bills'; DELETE FROM hosts WHERE id='host:kofi-bills'",
            "UPDATE hosts SET slug='different' WHERE id='host:kofi-bills'",
            "UPDATE hosts SET id='host:different' WHERE slug='kofi-bills'",
            "UPDATE hosts SET slug='different' WHERE id='host:kofi-bills'; UPDATE hosts SET slug='kofi-bills' WHERE id='host:other'",
        )
        for index, sql in enumerate(cases):
            with self.subTest(sql=sql):
                self.use_database('identity-' + str(index))
                with release.closing(release.sqlite3.connect(self.database)) as db:
                    db.executescript(sql)
                before = self.snapshot()
                with self.assertRaises((release.ReleaseError, release.sqlite3.IntegrityError)):
                    self.migrate()
                self.assertEqual(self.snapshot(), before)

    def test_partial_and_drifted_schema_fail_closed(self):
        for index, sql in enumerate((
            'ALTER TABLE hosts ADD COLUMN brand_name TEXT',
            'ALTER TABLE hosts ADD COLUMN brand_logo_url TEXT',
            'ALTER TABLE hosts ADD COLUMN brand_name INTEGER; ALTER TABLE hosts ADD COLUMN brand_logo_url TEXT',
            'ALTER TABLE hosts ADD COLUMN brand_name TEXT; ALTER TABLE hosts ADD COLUMN brand_logo_url TEXT NOT NULL DEFAULT ""',
            'ALTER TABLE hosts ADD COLUMN unrelated TEXT',
            'ALTER TABLE hosts RENAME COLUMN full_name TO changed_name',
        )):
            with self.subTest(sql=sql):
                self.use_database('schema-' + str(index))
                with release.closing(release.sqlite3.connect(self.database)) as db:
                    db.executescript(sql)
                before = self.snapshot()
                with self.assertRaisesRegex(release.ReleaseError, 'schema is partial'):
                    self.migrate()
                self.assertEqual(self.snapshot(), before)

    def test_complete_schema_with_partial_or_drifted_brand_is_not_repaired(self):
        for index, values in enumerate(((None, None), ('The Yorke Way', None), (None, '/hosts/the-yorke-way.svg'),
                                         ('Another brand', '/hosts/the-yorke-way.svg'), ('The Yorke Way', '/different.svg'))):
            with self.subTest(values=values):
                self.use_database('brand-' + str(index))
                self.migrate()
                with release.closing(release.sqlite3.connect(self.database)) as db, db:
                    db.execute("UPDATE hosts SET brand_name=?,brand_logo_url=? WHERE id='host:kofi-bills'", values)
                before = self.snapshot()
                self.staging = self.root / ('drifted-' + str(index))
                with self.assertRaisesRegex(release.ReleaseError, 'reviewed replay state'):
                    self.migrate()
                self.assertEqual(self.snapshot(), before)

    def test_all_original_writer_guards_and_active_state_are_required_even_on_replay(self):
        cases = (
            'DROP TRIGGER _bct_guard_hosts_insert',
            'DROP TRIGGER _bct_guard_hosts_update',
            'DROP TRIGGER _bct_guard_hosts_delete',
            'DROP TRIGGER _bct_guard_hosts_update; ' + HostVerificationMigrationTests.WRITER_GUARD_STATEMENTS[3].replace('WHERE id=1)=1', 'WHERE id=1)=0'),
            "CREATE TRIGGER unsafe AFTER UPDATE ON hosts BEGIN UPDATE staff SET role='owner'; END",
            'ALTER TABLE _bct_handover_state ADD COLUMN unexpected TEXT',
            'DELETE FROM _bct_handover_state',
            'DROP TABLE _bct_handover_state',
            'UPDATE _bct_handover_state SET frozen=1',
        )
        for replay in (False, True):
            for index, sql in enumerate(cases):
                with self.subTest(replay=replay, sql=sql):
                    self.use_database('guard-' + str(replay) + '-' + str(index))
                    if replay:
                        self.migrate()
                        self.staging = self.root / ('replay-guard-' + str(index))
                    with release.closing(release.sqlite3.connect(self.database)) as db:
                        db.executescript(sql)
                    before = self.snapshot()
                    with self.assertRaises(release.ReleaseError):
                        self.migrate()
                    self.assertEqual(self.snapshot(), before)

    def test_temporary_trigger_is_rejected(self):
        with release.closing(release.sqlite3.connect(self.database)) as db:
            db.execute("CREATE TEMP TRIGGER unsafe AFTER UPDATE ON main.hosts BEGIN UPDATE staff SET role='owner'; END")
            db.execute('BEGIN IMMEDIATE')
            statements, _ = release.reviewed_migration(self.SQL, self.specification)
            with self.assertRaisesRegex(release.ReleaseError, 'hosts triggers'):
                release.apply_host_brand_identity(db, self.specification, statements)
            db.rollback()

    def test_exact_sql_spec_and_isolated_plan_are_mandatory(self):
        for raw, spec in ((self.SQL + b'\n', self.specification),
                          (self.SQL.replace(b"AND slug = 'kofi-bills'", b'OR 1=1'), self.specification),
                          (self.SQL.replace(b'The Yorke Way', b'Other Brand'), self.specification),
                          (self.SQL + b'DELETE FROM staff;', self.specification),
                          (self.SQL, dict(self.specification, path='drizzle/unreviewed.sql')),
                          (self.SQL, dict(self.specification, kind='arbitrary-update')),
                          (self.SQL, dict(self.specification, sha256='a' * 64)),
                          (self.SQL, dict(self.specification, blob='a' * 40)),
                          (self.SQL, dict(self.specification, beforeSchemaSha256='a' * 64)),
                          (self.SQL, dict(self.specification, schemaSha256='a' * 64)),
                          (self.SQL, dict(self.specification, extra='unexpected'))):
            with self.subTest(raw=raw, spec=spec), self.assertRaises(release.ReleaseError):
                self.migrate([(spec, raw)])
        brand = (self.specification, self.SQL)
        archive = (release.migration_plan([release.RECOVERABLE_ARCHIVE_PATH])[0], WorkspaceSchemaMigrationTests.ARCHIVE_SQL)
        for plan in ([brand, brand], [archive, brand], [brand, archive],
                     [brand, (AdditiveMigrationTests.specification(), AdditiveMigrationTests.SQL)]):
            with self.subTest(plan=plan), self.assertRaisesRegex(release.ReleaseError, 'only migration'):
                self.migrate(plan)
        self.assertFalse(self.staging.exists())

    def test_generic_additive_grammar_still_rejects_alter_update_and_trigger_replacement(self):
        for raw in (self.SQL, b'ALTER TABLE hosts ADD COLUMN brand_name TEXT;', b'UPDATE hosts SET name="changed";',
                    b'DROP TRIGGER _bct_guard_hosts_update;'):
            spec = {'path': 'drizzle/unreviewed.sql', 'sha256': release.hashlib.sha256(raw).hexdigest(), 'tables': []}
            with self.subTest(raw=raw), self.assertRaisesRegex(release.ReleaseError, 'Only reviewed additive'):
                release.reviewed_migration(raw, spec)

    def test_authorizer_rejects_unrelated_columns_tables_and_control_writes(self):
        original = release.reviewed_migration
        for index, sql in enumerate(("UPDATE hosts SET name='wrong' WHERE id='host:kofi-bills'",
                                     "UPDATE hosts SET verification_status='revoked' WHERE id='host:kofi-bills'",
                                     "UPDATE staff SET role='owner'", "UPDATE orders SET status='refunded'",
                                     'UPDATE _bct_handover_state SET frozen=1', 'DELETE FROM hosts')):
            self.use_database('authorizer-' + str(index))
            before = self.snapshot()
            def inject_update(raw, spec):
                statements, rows = original(raw, spec)
                return statements[:2] + [sql], rows
            with self.subTest(sql=sql), patch.object(release, 'reviewed_migration', side_effect=inject_update):
                with self.assertRaises(release.sqlite3.DatabaseError):
                    self.migrate()
            self.assertEqual(self.snapshot(), before)

    def test_postconditions_reject_wrong_rows_wrong_brand_or_timestamp_and_ddl_side_effects(self):
        original = release.reviewed_migration
        cases = (
            (2, "UPDATE hosts SET brand_name='The Yorke Way',brand_logo_url='/hosts/the-yorke-way.svg',updated_at=CURRENT_TIMESTAMP"),
            (2, "UPDATE hosts SET brand_name='Wrong brand',brand_logo_url='/hosts/the-yorke-way.svg',updated_at=CURRENT_TIMESTAMP WHERE id='host:kofi-bills'"),
            (2, "UPDATE hosts SET brand_name='The Yorke Way',brand_logo_url='/hosts/the-yorke-way.svg',updated_at='before' WHERE id='host:kofi-bills'"),
            (2, "UPDATE hosts SET brand_name='The Yorke Way',brand_logo_url='/hosts/the-yorke-way.svg',updated_at=CURRENT_TIMESTAMP WHERE id='host:other'"),
            (1, "UPDATE orders SET status='rewritten'"),
            (1, 'DROP TRIGGER _bct_guard_hosts_update'),
        )
        for index, (position, sql) in enumerate(cases):
            self.use_database('postcondition-' + str(index))
            before = self.snapshot()
            def inject_statement(raw, spec):
                statements, rows = original(raw, spec)
                statements[position] = sql
                return statements, rows
            with self.subTest(sql=sql), patch.object(release, 'reviewed_migration', side_effect=inject_statement):
                with self.assertRaises(release.ReleaseError):
                    self.migrate()
            self.assertEqual(self.snapshot(), before)

    def test_authorizer_blocks_foreign_key_cascade_into_unrelated_data(self):
        with release.closing(release.sqlite3.connect(self.database)) as db:
            db.executescript("""
                CREATE UNIQUE INDEX hosts_updated_unique ON hosts(updated_at);
                CREATE TABLE preserved_host_link(id TEXT PRIMARY KEY, updated TEXT REFERENCES hosts(updated_at) ON UPDATE CASCADE);
                INSERT INTO preserved_host_link VALUES('link','before');
            """)
        before = self.snapshot()
        with self.assertRaises(release.sqlite3.DatabaseError):
            self.migrate()
        self.assertEqual(self.snapshot(), before)

    def test_transaction_and_complete_statement_inventory_are_required(self):
        statements, _ = release.reviewed_migration(self.SQL, self.specification)
        with release.closing(release.sqlite3.connect(self.database)) as db:
            with self.assertRaisesRegex(release.ReleaseError, 'migration transaction'):
                release.apply_host_brand_identity(db, self.specification, statements)
            db.execute('BEGIN IMMEDIATE')
            for incomplete in (statements[:2], statements + ['DELETE FROM orders']):
                with self.subTest(statements=incomplete), self.assertRaisesRegex(release.ReleaseError, 'exactly three'):
                    release.apply_host_brand_identity(db, self.specification, incomplete)
            db.rollback()

    def test_failure_after_either_ddl_and_after_update_rolls_back_the_entire_transition(self):
        original = release.reviewed_migration
        for stop in (1, 2):
            self.use_database('failure-' + str(stop))
            before = self.snapshot()
            def inject_failure(raw, spec):
                statements, rows = original(raw, spec)
                statements[stop] = 'INSERT INTO missing_table VALUES(1)'
                return statements, rows
            with self.subTest(stop=stop), patch.object(release, 'reviewed_migration', side_effect=inject_failure):
                with self.assertRaises(release.sqlite3.DatabaseError):
                    self.migrate()
            self.assertEqual(self.snapshot(), before)
            self.assertEqual(self.snapshot(self.staging / 'before.sqlite'), before)
            self.assertEqual(release.strict_json((self.staging / 'result.json').read_bytes())['phase'], 'backed-up')
        self.use_database('writer-postcondition')
        before = self.snapshot()
        original_writer = release.host_writer_state
        calls = [0]
        def changed_writer(db):
            result = original_writer(db)
            calls[0] += 1
            return [(1, 0, 'wrong-transfer')] if calls[0] == 2 else result
        with patch.object(release, 'host_writer_state', side_effect=changed_writer):
            with self.assertRaisesRegex(release.ReleaseError, 'preserved handover control'):
                self.migrate()
        self.assertEqual(self.snapshot(), before)

    def test_pending_transition_is_invisible_and_competing_writes_cannot_interleave(self):
        before = self.snapshot()
        original = release.apply_host_brand_identity
        def observe(db, spec, statements):
            result = original(db, spec, statements)
            self.assertEqual(self.snapshot(), before)
            with release.closing(release.sqlite3.connect(self.database, timeout=0)) as competing:
                with self.assertRaisesRegex(release.sqlite3.OperationalError, 'locked'):
                    competing.execute("INSERT INTO orders VALUES('concurrent','paid')")
            return result
        with patch.object(release, 'apply_host_brand_identity', side_effect=observe):
            self.migrate()

    def test_prelock_customer_writes_survive_and_a_prelock_freeze_is_obeyed(self):
        original = release.write_json
        for freeze in (False, True):
            self.use_database('prelock-' + str(freeze))
            def before_lock(path, value):
                original(path, value)
                if value.get('phase') == 'backed-up':
                    with release.closing(release.sqlite3.connect(self.database)) as db, db:
                        db.execute("INSERT INTO orders VALUES('concurrent-order','paid')")
                        db.execute("UPDATE hosts SET bio='Concurrent personal edit' WHERE id='host:kofi-bills'")
                        if freeze:
                            db.execute('UPDATE _bct_handover_state SET frozen=1')
            with patch.object(release, 'write_json', side_effect=before_lock):
                if freeze:
                    with self.assertRaisesRegex(release.ReleaseError, 'unfrozen'):
                        self.migrate()
                else:
                    self.migrate()
            schema, rows = self.snapshot()
            self.assertEqual(rows['hosts'][0][3], 'Concurrent personal edit')
            self.assertEqual(len(rows['orders']), 2)
            self.assertEqual(len(self.snapshot(self.staging / 'before.sqlite')[1]['orders']), 1)
            self.assertEqual('brand_name TEXT' in next(r[3] for r in schema if r[1] == 'hosts'), not freeze)

    def test_postcommit_evidence_failure_has_safe_byte_preserving_replay(self):
        original = release.write_json
        def fail_verified(path, value):
            if value.get('phase') == 'verified':
                raise OSError('simulated evidence failure')
            return original(path, value)
        with patch.object(release, 'write_json', side_effect=fail_verified):
            with self.assertRaisesRegex(OSError, 'evidence failure'):
                self.migrate()
        before = self.snapshot()
        self.staging = self.root / 'recovery-backup'
        self.assertFalse(self.migrate()['created'])
        self.assertEqual(self.snapshot(), before)

    def test_all_three_original_writer_fences_remain_effective_after_transition(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute('UPDATE _bct_handover_state SET frozen=1')
            for sql in ("UPDATE hosts SET brand_name='blocked' WHERE id='host:kofi-bills'",
                        "DELETE FROM hosts WHERE id='host:other'",
                        "INSERT INTO hosts(id,slug,name,bio,created_at,updated_at) VALUES('new','new','New','Bio','now','now')"):
                with self.subTest(sql=sql), self.assertRaisesRegex(release.sqlite3.IntegrityError, 'Source writer is paused'):
                    db.execute(sql)

    def test_fixture_matches_original_schema_source_and_exact_brand_sql_when_available(self):
        root = Path(__file__).resolve().parents[2]
        if (root / 'drizzle/0011_unique_mantis.sql').is_file():
            with release.closing(release.sqlite3.connect(':memory:')) as db:
                source = (root / 'drizzle/0011_unique_mantis.sql').read_text()
                db.execute(release.re.search(r'CREATE TABLE `hosts` \([\s\S]*?\n\);', source).group())
                source = (root / 'drizzle/0045_kofi_bills_host.sql').read_text()
                for statement in release.re.findall(r'ALTER TABLE hosts[^;]+;', source):
                    db.execute(statement)
                self.assertEqual(db.execute("SELECT sql FROM sqlite_schema WHERE name='hosts'").fetchone()[0], self.BEFORE_SQL)
        if (root / release.HOST_BRAND_IDENTITY_PATH).is_file():
            self.assertEqual((root / release.HOST_BRAND_IDENTITY_PATH).read_bytes(), self.SQL)
        statements, rows = release.reviewed_migration(self.SQL, self.specification)
        self.assertEqual(len(statements), 3)
        self.assertEqual(rows, [])
        with release.closing(release.sqlite3.connect(':memory:')) as db:
            db.execute(self.BEFORE_SQL)
            self.assertEqual(release.schema_digest(release.schema_rows(db)), self.specification['beforeSchemaSha256'])
            for statement in statements[:2]:
                db.execute(statement)
            self.assertEqual(release.schema_digest(release.schema_rows(db)), self.specification['schemaSha256'])


class HostBrandIdentityDeploymentTests(DeploymentFixture):
    def prepare_brand(self, tampered=False):
        state = self.root / 'var/lib/becore-tickets'
        state.chmod(0o700)
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db:
            HostBrandIdentityMigrationTests.seed(db)
        (state / 'tickets.sqlite').chmod(0o600)
        member = tarfile.TarInfo('migrations/' + Path(release.HOST_BRAND_IDENTITY_PATH).name)
        member.mode = 0o644
        self.make_archive(extra=(member, HostBrandIdentityMigrationTests.SQL + (b'\n' if tampered else b'')))
        self.proof['changedFiles'] = [release.HOST_BRAND_IDENTITY_PATH]
        self.proof['migrations'] = release.migration_plan(self.proof['changedFiles'])
        self.refresh_digests()
        return state

    def test_activation_records_exact_migration_and_private_rollback_backup(self):
        self.prepare_brand()
        self.assertTrue(self.deployment.transact()['dataMigration'])
        record = release.strict_json(self.deployment.journal.read_bytes())['lastCodeRelease']
        self.assertEqual(record['reviewedDataMigrations'], self.proof['migrations'])
        self.assertEqual(record['databaseBackupSha256'], release.digest_file(self.deployment.snapshot / 'database/before.sqlite'))

    def test_tampered_sql_prevents_service_restart_and_schema_change(self):
        state = self.prepare_brand(tampered=True)
        with self.assertRaises(release.ReleaseError):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assert_restored()
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db:
            self.assertNotIn('brand_name', [r[1] for r in db.execute('PRAGMA table_xinfo(hosts)')])

    def test_code_rollback_keeps_nullable_brand_fields_and_postactivation_customer_data(self):
        state = self.prepare_brand()
        self.system.fail = 'local'
        restart = self.system.restart
        def activated():
            restart()
            if self.system.revision == NEW:
                with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
                    self.assertEqual(db.execute("SELECT brand_name,brand_logo_url FROM hosts WHERE id='host:kofi-bills'").fetchone(),
                                     ('The Yorke Way', '/hosts/the-yorke-way.svg'))
                    db.execute("INSERT INTO orders VALUES('new-paid-order','paid')")
                    db.execute("UPDATE hosts SET bio='Later biography' WHERE id='host:kofi-bills'")
        self.system.restart = activated
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.revision, OLD)
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM orders').fetchone(), (2,))
            self.assertEqual(db.execute("SELECT bio,brand_name FROM hosts WHERE id='host:kofi-bills'").fetchone(),
                             ('Later biography', 'The Yorke Way'))
            # The old runtime's explicit-column writes retain nullable defaults.
            db.execute("UPDATE hosts SET name='Old runtime edit' WHERE id='host:kofi-bills'")
            db.execute("INSERT INTO hosts(id,slug,name,bio,created_at,updated_at) VALUES('new','new','New','Bio','now','now')")
            self.assertEqual(db.execute("SELECT brand_name,brand_logo_url FROM hosts WHERE id='new'").fetchone(), (None, None))
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        with release.closing(release.sqlite3.connect(self.deployment.snapshot / 'database/before.sqlite')) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM orders').fetchone(), (1,))
            self.assertNotIn('brand_name', [r[1] for r in db.execute('PRAGMA table_xinfo(hosts)')])


class YorkeSourceAdmissionTests(unittest.TestCase):
    """Real Git: independent controls C and copied snapshot S application bytes."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git("init", "-q")
        self.git("config", "user.name", "Yorke source tests")
        self.git("config", "user.email", "tests@example.invalid")
        self.write("app/source.ts", "baseline application\n")
        self.write("ops/vps/code-release.py", "baseline operator\n")
        self.write("ops/vps/test_code_release.py", "baseline tests\n")
        self.write("scripts/audit-release-manifest.json", "frozen expired exception\n")
        self.write("package.json", '{"scripts":{"test:ui":"old"},"dependencies":{"same":"1"}}\n')
        self.write("package-lock.json", '{"locked":"unchanged"}\n')
        self.base = self.commit()
        self.write("app/source.ts", "reviewed Yorke application\n")
        self.write("package.json", '{"scripts":{"test:ui":"new"},"dependencies":{"same":"1"}}\n')
        self.snapshot = self.commit()
        self.pins = {name: self.git("rev-parse", self.snapshot + ":" + name)
                     for name in ("app/source.ts", "package.json")}
        self.git("checkout", "-q", self.base)
        self.write("ops/vps/code-release.py", "independently reviewed operator\n")
        self.write("ops/vps/test_code_release.py", "independently reviewed tests\n")
        self.control = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", self.control)
        for name in self.pins:
            self.write(name, self.git("show", self.snapshot + ":" + name) + "\n")
        self.candidate = self.commit()
        settings = {
            "YORKE_RELEASE_BASELINE": self.base,
            "YORKE_BASE_TREE": self.git("rev-parse", self.base + "^{tree}"),
            "YORKE_APP_SNAPSHOT": self.snapshot,
            "YORKE_APP_TREE": self.git("rev-parse", self.snapshot + "^{tree}"),
            "YORKE_APPLICATION_BLOBS": self.pins,
            "YORKE_MIGRATION_FILES": set(),
            "YORKE_PACKAGE_BLOBS": tuple(self.git("rev-parse", ref + ":package.json")
                                             for ref in (self.base, self.snapshot)),
            "YORKE_LOCK_BLOB": self.git("rev-parse", self.base + ":package-lock.json"),
            "__file__": str(self.root / "ops/vps/code-release.py"),
        }
        for name, value in settings.items():
            patcher = patch.object(release, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        environment = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        environment.start()
        self.addCleanup(environment.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(raw)
        return path

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "isolated Yorke source admission")
        return self.git("rev-parse", "HEAD")

    def verify(self, candidate=None):
        return release.vetted_changes(self.base, candidate or self.candidate)

    def test_exact_snapshot_copy_onto_independent_controls_is_accepted(self):
        self.assertEqual(set(self.verify()), set(self.pins) | release.YORKE_CONTROL_FILES)
        self.assertNotEqual(self.snapshot, self.candidate)
        result = subprocess.run(["git", "merge-base", "--is-ancestor", self.snapshot, self.candidate],
                                capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_snapshot_tree_parent_and_complete_inventory_are_immutable(self):
        for name, value in (("YORKE_BASE_TREE", "f" * 40),
                            ("YORKE_APP_TREE", "f" * 40),
                            ("YORKE_APPLICATION_BLOBS", {"app/source.ts": self.pins["app/source.ts"]})):
            with self.subTest(field=name), patch.object(release, name, value):
                with self.assertRaisesRegex(release.ReleaseError, "snapshot"):
                    self.verify()
        other = self.git("commit-tree", release.YORKE_APP_TREE, "-m", "unrelated snapshot")
        with patch.object(release, "YORKE_APP_SNAPSHOT", other):
            with self.assertRaisesRegex(release.ReleaseError, "snapshot"):
                self.verify()

    def test_application_mutation_missing_change_and_unrelated_paths_are_rejected(self):
        for name, raw in (("app/source.ts", "unreviewed\n"),
                          ("app/source.ts", "baseline application\n"),
                          ("docs/unreviewed.md", "even ordinary documentation is outside this snapshot\n"),
                          ("tests/unreviewed.test.ts", "unreviewed test\n"),
                          ("scripts/audit-release-manifest.json", "revived exception\n"),
                          (".github/workflows/deploy.yml", "unreviewed release workflow\n"),
                          ("ops/vps/rollback.sh", "unreviewed rollback\n")):
            with self.subTest(path=name, raw=raw):
                self.git("reset", "--hard", self.candidate)
                self.write(name, raw)
                with self.assertRaisesRegex(release.ReleaseError, "exact application snapshot"):
                    self.verify(self.commit())

    def test_exact_new_application_blob_is_not_admitted_from_another_baseline(self):
        with self.assertRaises(release.ReleaseError):
            release.vetted_changes(self.control, self.candidate)

    def test_candidate_cannot_select_itself_or_snapshot_as_control(self):
        for trusted in (self.candidate, self.snapshot):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_control_must_be_merged_and_ancestor_of_the_candidate(self):
        self.git("update-ref", "refs/remotes/origin/main", self.base)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()
        self.git("update-ref", "refs/remotes/origin/main", self.control)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify(self.snapshot)

    def test_changed_control_bytes_and_application_in_trusted_controls_fail_closed(self):
        self.write("ops/vps/test_code_release.py", "candidate rewrote its tests\n")
        with self.assertRaisesRegex(release.ReleaseError, "controls differ"):
            self.verify(self.commit())
        self.git("reset", "--hard", self.control)
        self.write("app/source.ts", "changed inside controls\n")
        changed_control = self.commit()
        for name in self.pins:
            self.write(name, self.git("show", self.snapshot + ":" + name) + "\n")
        candidate = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", changed_control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed_control):
            with self.assertRaisesRegex(release.ReleaseError, "two reviewed control files"):
                self.verify(candidate)

    def test_deletion_symlink_and_mode_changes_remain_rejected(self):
        for kind in ("delete", "symlink", "executable"):
            self.git("reset", "--hard", self.candidate)
            path = self.root / "app/source.ts"
            if kind == "executable":
                path.chmod(0o755)
            else:
                path.unlink()
                if kind == "symlink":
                    path.symlink_to("../package.json")
            with self.subTest(kind=kind), self.assertRaises(release.ReleaseError):
                self.verify(self.commit())

    def test_package_and_lock_each_require_the_exact_reviewed_blobs(self):
        for field, value in (("YORKE_PACKAGE_BLOBS", ("f" * 40, release.YORKE_PACKAGE_BLOBS[1])),
                             ("YORKE_PACKAGE_BLOBS", (release.YORKE_PACKAGE_BLOBS[0], "f" * 40)),
                             ("YORKE_LOCK_BLOB", "f" * 40)):
            with self.subTest(field=field, value=value), patch.object(release, field, value):
                with self.assertRaisesRegex(release.ReleaseError, "unchanged dependency lock"):
                    self.verify()
        original = release.git
        def non_script_change(*args):
            raw = original(*args)
            if args == ("show", self.candidate + ":package.json"):
                return raw.replace('"same":"1"', '"same":"2"')
            return raw
        with patch.object(release, "git", side_effect=non_script_change):
            with self.assertRaisesRegex(release.ReleaseError, "not scripts-only"):
                self.verify()

    def test_complete_application_byte_pins_are_checked_after_snapshot_selection(self):
        with patch.dict(release.YORKE_APPLICATION_BLOBS, {"app/source.ts": "f" * 40}):
            with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                self.verify()

    def test_git_replacement_cannot_redirect_the_snapshot(self):
        self.git("replace", self.snapshot, self.candidate)
        self.assertEqual(set(self.verify()), set(self.pins) | release.YORKE_CONTROL_FILES)


    def test_exact_checkout_family_requires_all_bytes_and_rejects_hidden_edits(self):
        self.assertTrue(exact_application_checkout(self.root, self.snapshot,
                                                  release.YORKE_APP_TREE, release.YORKE_CONTROL_FILES))
        self.git("reset", "--hard", self.control)
        self.assertTrue(exact_application_checkout(self.root, self.base,
                                                  release.YORKE_BASE_TREE, release.YORKE_CONTROL_FILES))
        self.assertFalse(exact_application_checkout(self.root, self.snapshot,
                                                   release.YORKE_APP_TREE, release.YORKE_CONTROL_FILES))
        self.git("reset", "--hard", self.candidate)
        self.git("update-index", "--assume-unchanged", "app/source.ts")
        self.write("app/source.ts", "hidden unreviewed application\n")
        self.assertFalse(exact_application_checkout(self.root, self.snapshot,
                                                   release.YORKE_APP_TREE, release.YORKE_CONTROL_FILES))

    def test_only_one_changed_control_file_cannot_supply_the_control_baseline(self):
        self.git("reset", "--hard", self.base)
        self.write("ops/vps/code-release.py", "independently reviewed operator\n")
        incomplete_control = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", incomplete_control)
        for name in self.pins:
            self.write(name, self.git("show", self.snapshot + ":" + name) + "\n")
        candidate = self.commit()
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=incomplete_control):
            with self.assertRaisesRegex(release.ReleaseError, "two reviewed control files"):
                self.verify(candidate)

    def test_bad_control_mode_cannot_be_repaired_only_in_the_candidate(self):
        self.git("reset", "--hard", self.control)
        (self.root / "ops/vps/test_code_release.py").chmod(0o755)
        changed_control = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", changed_control)
        (self.root / "ops/vps/test_code_release.py").chmod(0o644)
        for name in self.pins:
            self.write(name, self.git("show", self.snapshot + ":" + name) + "\n")
        candidate = self.commit()
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed_control):
            with self.assertRaisesRegex(release.ReleaseError, "mode changed"):
                self.verify(candidate)

    def test_audit_window_and_dependency_lock_cannot_change_in_either_tree(self):
        for name in ("package-lock.json", "scripts/audit-release-manifest.json"):
            with self.subTest(path=name):
                self.git("reset", "--hard", self.candidate)
                self.write(name, "unreviewed dependency or audit exception\n")
                with self.assertRaisesRegex(release.ReleaseError, "exact application snapshot"):
                    self.verify(self.commit())
                self.git("reset", "--hard", self.control)
                self.write(name, "unreviewed dependency or audit exception\n")
                changed_control = self.commit()
                self.git("update-ref", "refs/remotes/origin/main", changed_control)
                for app in self.pins:
                    self.write(app, self.git("show", self.snapshot + ":" + app) + "\n")
                candidate = self.commit()
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed_control):
                    with self.assertRaisesRegex(release.ReleaseError, "two reviewed control files"):
                        self.verify(candidate)
                self.git("update-ref", "refs/remotes/origin/main", self.control)


class YorkeSourcePinTests(unittest.TestCase):
    def test_yorke_scope_is_exact_and_separate_from_historical_workspace_pins(self):
        self.assertEqual(release.YORKE_RELEASE_BASELINE, "c2058fb39bb6d9a93ef622aad08b1e9e2d22488f")
        self.assertEqual(release.YORKE_BASE_TREE, "c85475e968e1cecbd6637fe77710b032dee0ecbd")
        self.assertEqual(release.YORKE_APP_SNAPSHOT, "0babbc74b0a8d2b931289441c73aa93b36e1e52c")
        self.assertEqual(release.YORKE_APP_TREE, "28f678b6a2a7812d2d4c11240b04baace9a1ea48")
        self.assertEqual(release.YORKE_PACKAGE_BLOBS,
                         ("ee7d351bd660b932e9870b6d542da4426386eca5", "e4f736b3204696fceab081989f1cdddfd5b1bc5e"))
        self.assertEqual(release.YORKE_LOCK_BLOB, "47a4eaca5743b768598462d8b66a2ef49a442b4e")
        self.assertEqual(release.YORKE_CONTROL_FILES,
                         {"ops/vps/code-release.py", "ops/vps/test_code_release.py"})
        self.assertEqual(release.YORKE_MIGRATION_FILES, {"drizzle/0067_host_brand_identity.sql"})
        self.assertEqual(len(release.YORKE_APPLICATION_BLOBS), 27)
        self.assertFalse(set(release.YORKE_APPLICATION_BLOBS)
                         & (release.YORKE_MIGRATION_FILES | release.YORKE_CONTROL_FILES))
        self.assertEqual(release.YORKE_APPLICATION_BLOBS["package.json"], release.YORKE_PACKAGE_BLOBS[1])
        self.assertEqual(release.WORKSPACE_RELEASE_BASELINE, "379be609c49e8994dbd6b5bf5883c9be733369b1")
        self.assertEqual(release.WORKSPACE_APP_SNAPSHOT, "b0b1b4534584ab74b20c6923cf1e77bf189fa94d")
        self.assertEqual(release.WORKSPACE_APP_TREE, "1f2533264b8e48d440ee6bbeeb3c503652e1f659")
        self.assertEqual(release.WORKSPACE_APPLICATION_BLOBS["package.json"], release.YORKE_PACKAGE_BLOBS[0])
        for path in ("scripts/audit-release-manifest.json", "scripts/audit-release-dependencies.py",
                     ".github/workflows/tickets-code-release.yml", ".github/workflows/deploy.yml",
                     "ops/vps/runtime_release.py", "package-lock.json", "mobile/package-lock.json"):
            with self.subTest(path=path):
                self.assertNotIn(path, release.YORKE_APPLICATION_BLOBS)


class ReadinessSourceAdmissionTests(unittest.TestCase):
    """Real Git separates live L, merged advisory A, app S and controls C/P."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git("init", "-q")
        self.git("config", "user.name", "Readiness source tests")
        self.git("config", "user.email", "tests@example.invalid")
        self.write("app/registration-form.tsx", "baseline application\n")
        self.write("tests/e2e/guest-clarity.spec.ts", "baseline browser test\n")
        self.write("ops/vps/code-release.py", "baseline operator\n")
        self.write("ops/vps/test_code_release.py", "baseline tests\n")
        self.write("scripts/audit-release-manifest.json", "frozen expired exception\n")
        self.write("package.json", '{"scripts":{"test:ui":"old","start":"same"},"dependencies":{"same":"1"}}\n')
        self.write("package-lock.json", '{"locked":"unchanged"}\n')
        self.live = self.commit()
        self.write("ops/vps/test_code_release.py", "independently merged advisory tests\n")
        self.write("scripts/advisory.py", "independently merged advisory tooling\n")
        self.write("docs/advisory.md", "independently merged advisory evidence\n")
        self.advisory = self.commit()
        self.advisory_pins = {name: self.git("rev-parse", self.advisory + ":" + name)
                              for name in ("ops/vps/test_code_release.py", "scripts/advisory.py", "docs/advisory.md")}
        self.write("app/registration-form.tsx", "reviewed readiness application\n")
        self.write("tests/e2e/guest-clarity.spec.ts", "reviewed browser test\n")
        self.write("tests/registration-readiness.test.mjs", "reviewed static test\n")
        self.write("package.json", '{"scripts":{"test:ui":"new","start":"same"},"dependencies":{"same":"1"}}\n')
        self.snapshot = self.commit()
        self.pins = {name: self.git("rev-parse", self.snapshot + ":" + name)
                     for name in ("app/registration-form.tsx", "tests/e2e/guest-clarity.spec.ts",
                                  "tests/registration-readiness.test.mjs", "package.json")}
        self.git("checkout", "-q", self.advisory)
        self.write("ops/vps/code-release.py", "independently reviewed readiness operator\n")
        self.write("ops/vps/test_code_release.py", "independently merged advisory tests plus readiness tests\n")
        self.control = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", self.control)
        self.copy_snapshot()
        self.candidate = self.commit()
        settings = {
            "RSVP_READINESS_LIVE_BASELINE": self.live,
            "RSVP_READINESS_LIVE_TREE": self.git("rev-parse", self.live + "^{tree}"),
            "RSVP_READINESS_ADVISORY_BASE": self.advisory,
            "RSVP_READINESS_ADVISORY_TREE": self.git("rev-parse", self.advisory + "^{tree}"),
            "RSVP_READINESS_APP_SNAPSHOT": self.snapshot,
            "RSVP_READINESS_APP_TREE": self.git("rev-parse", self.snapshot + "^{tree}"),
            "RSVP_READINESS_ADVISORY_BLOBS": self.advisory_pins,
            "RSVP_READINESS_APPLICATION_BLOBS": self.pins,
            "RSVP_READINESS_PACKAGE_BLOBS": tuple(self.git("rev-parse", ref + ":package.json")
                                                  for ref in (self.live, self.snapshot)),
            "RSVP_READINESS_LOCK_BLOB": self.git("rev-parse", self.live + ":package-lock.json"),
            "__file__": str(self.root / "ops/vps/code-release.py"),
        }
        for name, value in settings.items():
            patcher = patch.object(release, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        environment = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        environment.start()
        self.addCleanup(environment.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(raw)
        return path

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "isolated readiness admission")
        return self.git("rev-parse", "HEAD")

    def copy_snapshot(self):
        for name in self.pins:
            self.write(name, self.git("show", self.snapshot + ":" + name) + "\n")

    def verify(self, candidate=None):
        return release.vetted_changes(self.live, candidate or self.candidate)

    def test_exact_advisory_then_snapshot_copy_onto_independent_controls_is_accepted(self):
        changes = self.verify()
        self.assertEqual(set(changes), set(self.pins) | set(self.advisory_pins) | release.RSVP_READINESS_CONTROL_FILES)
        self.assertEqual(release.migration_plan(changes), [])
        result = subprocess.run(["git", "merge-base", "--is-ancestor", self.snapshot, self.candidate], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotEqual(self.advisory_pins["ops/vps/test_code_release.py"],
                            self.git("rev-parse", self.candidate + ":ops/vps/test_code_release.py"))

    def test_live_advisory_snapshot_trees_and_both_inventories_are_immutable(self):
        for field, value in (
                ("RSVP_READINESS_LIVE_TREE", "f" * 40),
                ("RSVP_READINESS_ADVISORY_TREE", "f" * 40),
                ("RSVP_READINESS_APP_TREE", "f" * 40),
                ("RSVP_READINESS_ADVISORY_BLOBS", {"scripts/advisory.py": self.advisory_pins["scripts/advisory.py"]}),
                ("RSVP_READINESS_APPLICATION_BLOBS", {"package.json": self.pins["package.json"]})):
            with self.subTest(field=field), patch.object(release, field, value):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_advisory_baseline_must_descend_from_the_live_baseline(self):
        unrelated = self.git("commit-tree", release.RSVP_READINESS_ADVISORY_TREE, "-m", "unrelated advisory tree")
        with patch.object(release, "RSVP_READINESS_ADVISORY_BASE", unrelated):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()

    def test_snapshot_must_directly_parent_advisory_not_live_or_controls(self):
        for parent in (self.live, self.control):
            wrong = self.git("commit-tree", release.RSVP_READINESS_APP_TREE, "-p", parent, "-m", "wrong snapshot parent")
            with self.subTest(parent=parent), patch.object(release, "RSVP_READINESS_APP_SNAPSHOT", wrong):
                with self.assertRaisesRegex(release.ReleaseError, "exact direct child"):
                    self.verify()

    def test_all_advisory_blobs_are_checked_including_the_original_advisory_tests(self):
        for path in self.advisory_pins:
            with self.subTest(path=path), patch.dict(release.RSVP_READINESS_ADVISORY_BLOBS, {path: "f" * 40}):
                with self.assertRaisesRegex(release.ReleaseError, "advisory baseline differs from reviewed source"):
                    self.verify()

    def test_all_readiness_outputs_are_individually_byte_pinned(self):
        for path in self.pins:
            with self.subTest(path=path), patch.dict(release.RSVP_READINESS_APPLICATION_BLOBS, {path: "f" * 40}):
                with self.assertRaisesRegex(release.ReleaseError, "differs from reviewed source"):
                    self.verify()

    def test_candidate_cannot_change_readiness_advisory_audit_or_other_source(self):
        for name, raw in (
                ("app/registration-form.tsx", "unreviewed application\n"),
                ("app/registration-form.tsx", "baseline application\n"),
                ("scripts/advisory.py", "changed advisory tooling\n"),
                ("docs/advisory.md", "changed advisory evidence\n"),
                ("scripts/audit-release-manifest.json", "revived exception\n"),
                ("tests/unreviewed.test.ts", "unreviewed test\n"),
                (".github/workflows/deploy.yml", "unreviewed release workflow\n"),
                ("drizzle/9999_unreviewed.sql", "CREATE TABLE extra(id);\n"),
                ("package-lock.json", "unreviewed lock\n")):
            with self.subTest(path=name, raw=raw):
                self.git("reset", "--hard", self.candidate)
                self.write(name, raw)
                with self.assertRaisesRegex(release.ReleaseError, "exact application snapshot"):
                    self.verify(self.commit())

    def test_candidate_advisory_and_snapshot_cannot_be_trusted_controls(self):
        for trusted in (self.candidate, self.advisory, self.snapshot):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_control_must_be_merged_and_an_ancestor_of_candidate(self):
        self.git("update-ref", "refs/remotes/origin/main", self.advisory)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()
        self.git("update-ref", "refs/remotes/origin/main", self.control)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify(self.snapshot)

    def test_trusted_controls_must_descend_from_exact_advisory_commit(self):
        # Identical advisory/application bytes on another ancestry cannot act as C.
        other_control = self.git("commit-tree", self.git("rev-parse", self.control + "^{tree}"),
                                 "-p", self.live, "-m", "controls without advisory ancestry")
        other_candidate = self.git("commit-tree", self.git("rev-parse", self.candidate + "^{tree}"),
                                   "-p", other_control, "-m", "candidate without advisory ancestry")
        self.git("update-ref", "refs/remotes/origin/main", other_control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=other_control):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify(other_candidate)

    def test_controls_cannot_replace_advisory_or_application_bytes(self):
        for name in ("scripts/advisory.py", "app/registration-form.tsx"):
            self.git("reset", "--hard", self.control)
            self.write(name, "unreviewed controls payload\n")
            bad_control = self.commit()
            self.copy_snapshot()
            candidate = self.commit()
            self.git("update-ref", "refs/remotes/origin/main", bad_control)
            with self.subTest(path=name), patch.dict(os.environ, BECORE_TRUSTED_BASE=bad_control):
                with self.assertRaisesRegex(release.ReleaseError, "two reviewed control files"):
                    self.verify(candidate)

    def test_candidate_control_bytes_must_equal_the_new_control_not_advisory(self):
        self.write("ops/vps/test_code_release.py", self.git("show", self.advisory + ":ops/vps/test_code_release.py") + "\n")
        with self.assertRaisesRegex(release.ReleaseError, "candidate controls differ"):
            self.verify(self.commit())

    def test_control_cannot_omit_the_test_change(self):
        self.git("reset", "--hard", self.advisory)
        self.write("ops/vps/code-release.py", "independently reviewed readiness operator\n")
        incomplete = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", incomplete)
        self.copy_snapshot()
        candidate = self.commit()
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=incomplete):
            with self.assertRaisesRegex(release.ReleaseError, "two reviewed control files"):
                self.verify(candidate)

    def test_deletion_symlink_and_mode_changes_remain_rejected(self):
        for kind in ("delete", "symlink", "executable"):
            self.git("reset", "--hard", self.candidate)
            path = self.root / "app/registration-form.tsx"
            if kind == "executable":
                path.chmod(0o755)
            else:
                path.unlink()
                if kind == "symlink":
                    path.symlink_to("../package.json")
            with self.subTest(kind=kind), self.assertRaises(release.ReleaseError):
                self.verify(self.commit())

    def test_bad_control_mode_cannot_be_repaired_only_in_candidate(self):
        self.git("reset", "--hard", self.control)
        (self.root / "ops/vps/test_code_release.py").chmod(0o755)
        changed_control = self.commit()
        self.git("update-ref", "refs/remotes/origin/main", changed_control)
        (self.root / "ops/vps/test_code_release.py").chmod(0o644)
        self.copy_snapshot()
        candidate = self.commit()
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed_control):
            with self.assertRaisesRegex(release.ReleaseError, "mode changed"):
                self.verify(candidate)

    def test_package_pair_and_unchanged_lock_are_exact(self):
        for field, value in (("RSVP_READINESS_PACKAGE_BLOBS", ("f" * 40, release.RSVP_READINESS_PACKAGE_BLOBS[1])),
                             ("RSVP_READINESS_PACKAGE_BLOBS", (release.RSVP_READINESS_PACKAGE_BLOBS[0], "f" * 40)),
                             ("RSVP_READINESS_LOCK_BLOB", "f" * 40)):
            with self.subTest(field=field), patch.object(release, field, value):
                with self.assertRaisesRegex(release.ReleaseError, "unchanged dependency lock"):
                    self.verify()

    def test_package_semantics_permit_only_the_test_ui_script(self):
        original = release.git
        for before, after in (('"start":"same"', '"start":"changed"'), ('"same":"1"', '"same":"2"')):
            def other_package_change(*args):
                raw = original(*args)
                return raw.replace(before, after) if args == ("show", self.candidate + ":package.json") else raw
            with self.subTest(change=after), patch.object(release, "git", side_effect=other_package_change):
                with self.assertRaisesRegex(release.ReleaseError, "not test:ui-only"):
                    self.verify()

    def test_migration_plan_must_remain_empty(self):
        with patch.object(release, "migration_plan", return_value=[{"path": "unexpected"}]):
            with self.assertRaisesRegex(release.ReleaseError, "cannot introduce migrations"):
                self.verify()

    def test_exact_readiness_cannot_be_admitted_from_another_active_baseline(self):
        with self.assertRaises(release.ReleaseError):
            release.vetted_changes(self.advisory, self.candidate)

    def test_git_replacement_cannot_redirect_advisory_or_snapshot(self):
        self.git("replace", self.advisory, self.candidate)
        self.git("replace", self.snapshot, self.candidate)
        self.assertEqual(set(self.verify()), set(self.pins) | set(self.advisory_pins) | release.RSVP_READINESS_CONTROL_FILES)

    def test_complete_readiness_checkout_rejects_hidden_application_changes(self):
        self.assertTrue(exact_application_checkout(self.root, self.snapshot,
                                                  release.RSVP_READINESS_APP_TREE, release.RSVP_READINESS_CONTROL_FILES))
        self.git("update-index", "--assume-unchanged", "app/registration-form.tsx")
        self.write("app/registration-form.tsx", "hidden application change\n")
        self.assertFalse(exact_application_checkout(self.root, self.snapshot,
                                                   release.RSVP_READINESS_APP_TREE, release.RSVP_READINESS_CONTROL_FILES))


class ReadinessSourcePinTests(unittest.TestCase):
    def test_live_advisory_and_app_pins_are_finite_and_distinct(self):
        self.assertEqual(release.RSVP_READINESS_LIVE_BASELINE, "d257f41b669a542de0eebbe09993e7efa8dd5074")
        self.assertEqual(release.RSVP_READINESS_LIVE_TREE, "a4446b0a2d2fc6a03e5196fb9b3a2d90f72a5d66")
        self.assertEqual(release.RSVP_READINESS_ADVISORY_BASE, "0f82e136c8005d910f0aeb44b6f355176fc254f6")
        self.assertEqual(release.RSVP_READINESS_ADVISORY_TREE, "c805f0626b55e069e45b22e2420e4f0d463c945e")
        self.assertEqual(release.RSVP_READINESS_APP_SNAPSHOT, "d43243e28d06000465b30175dd947a4a22ce4ba0")
        self.assertEqual(release.RSVP_READINESS_APP_TREE, "b30272ddb69e5e1a9ee694bb7f8bab4c47eb541a")
        self.assertEqual(len(release.RSVP_READINESS_ADVISORY_BLOBS), 9)
        self.assertEqual(set(release.RSVP_READINESS_APPLICATION_BLOBS), {
            "app/registration-form.tsx", "package.json", "tests/e2e/guest-clarity.spec.ts", "tests/registration-readiness.test.mjs"})
        self.assertEqual(release.RSVP_READINESS_CONTROL_FILES,
                         {"ops/vps/code-release.py", "ops/vps/test_code_release.py"})
        self.assertEqual(set(release.RSVP_READINESS_ADVISORY_BLOBS) & release.RSVP_READINESS_CONTROL_FILES,
                         {"ops/vps/test_code_release.py"})
        self.assertFalse(set(release.RSVP_READINESS_ADVISORY_BLOBS) & set(release.RSVP_READINESS_APPLICATION_BLOBS))
        self.assertEqual(release.RSVP_READINESS_PACKAGE_BLOBS,
                         ("e4f736b3204696fceab081989f1cdddfd5b1bc5e", "eccb3af63298d7642c1ea974d7e8f18da9563507"))
        self.assertEqual(release.RSVP_READINESS_LOCK_BLOB, "47a4eaca5743b768598462d8b66a2ef49a442b4e")
        self.assertEqual(release.migration_plan(set(release.RSVP_READINESS_ADVISORY_BLOBS)
                                              | set(release.RSVP_READINESS_APPLICATION_BLOBS)), [])
        self.assertNotIn("scripts/audit-release-manifest.json", release.RSVP_READINESS_ADVISORY_BLOBS)
        self.assertNotIn("scripts/audit-release-dependencies.py", release.RSVP_READINESS_ADVISORY_BLOBS)
        self.assertEqual({name: blob for name, blob in release.RSVP_READINESS_ADVISORY_BLOBS.items()
                          if name not in release.RSVP_READINESS_CONTROL_FILES}, BENCHMARK_FILE_BLOBS)


class CincoSourceAdmissionTests(unittest.TestCase):
    """Real Git admission keeps runtime, controls, and customer state bounded."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', 'user.name', 'CINCO release tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = ('lib/registrations.ts', 'lib/confirmation-delivery.ts',
                      'tests/registrations.test.ts', 'tests/confirmation-delivery.test.ts',
                      'lib/customer-email.ts', 'tests/customer-email-rendering.test.mjs')
        for name in self.files:
            self.write(name, 'baseline\n')
        self.write('ops/vps/code-release.py', 'baseline operator\n')
        self.write('ops/vps/test_code_release.py', 'baseline tests\n')
        self.write('package-lock.json', 'unchanged dependency lock\n')
        self.live = self.commit()
        self.write('ops/advisory.py', 'reviewed operational baseline\n')
        self.write('ops/vps/code-release.py', 'merged previous operator\n')
        self.write('ops/vps/test_code_release.py', 'merged previous tests\n')
        self.advisory = self.commit()
        self.write('ops/vps/code-release.py', 'independent reviewed CINCO operator\n')
        self.write('ops/vps/test_code_release.py', 'independent reviewed CINCO tests\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        for name in self.files:
            self.write(name, 'exact reviewed ' + name + '\n')
        self.candidate = self.commit()
        self.pins = {name: self.git('rev-parse', self.candidate + ':' + name) for name in self.files}
        values = {
            'CINCO_RELEASE_BASELINE': self.live,
            'CINCO_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'CINCO_ADVISORY_BASE': self.advisory,
            'CINCO_ADVISORY_TREE': self.git('rev-parse', self.advisory + '^{tree}'),
            'CINCO_ADVISORY_BLOBS': {'ops/advisory.py': self.git('rev-parse', self.advisory + ':ops/advisory.py')},
            'CINCO_APPLICATION_BLOBS': self.pins,
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            patcher = patch.object(release, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(raw)

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated CINCO admission')
        return self.git('rev-parse', 'HEAD')

    def verify(self):
        return release.vetted_changes(self.live, self.git('rev-parse', 'HEAD'))

    def test_exact_six_file_patch_preserves_all_prior_advisory_bytes(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.CINCO_CONTROL_FILES | {'ops/advisory.py'})
        self.assertEqual(release.migration_plan(self.verify()), [])

    def test_each_application_output_is_byte_pinned(self):
        for name in self.files:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    release.reviewed_cinco_application_blobs(self.live, self.git('rev-parse', 'HEAD'))

    def test_extra_runtime_dependency_migration_and_advisory_changes_are_rejected(self):
        for name in ('runtime/vps/worker.mjs', 'package-lock.json', 'drizzle/9999_extra.sql', 'ops/advisory.py'):
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_candidate_cannot_change_its_own_controls(self):
        for name in release.CINCO_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted controls\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_wrong_live_and_advisory_trees_fail_closed(self):
        for name in ('CINCO_RELEASE_BASE_TREE', 'CINCO_ADVISORY_TREE'):
            with self.subTest(name=name), patch.object(release, name, 'f' * 40):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_executable_application_file_is_rejected(self):
        self.git('update-index', '--chmod=+x', 'lib/registrations.ts')
        self.git('commit', '-qm', 'unreviewed executable mode')
        with self.assertRaises(release.ReleaseError):
            self.verify()

    def test_source_cannot_be_its_own_trust_anchor(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            with self.assertRaises(release.ReleaseError):
                self.verify()


class CincoRecoverySourceAdmissionTests(unittest.TestCase):
    """Real Git objects exercise the separate finite recovery trust boundary."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Recovery admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.CINCO_RECOVERY_APPLICATION_BLOBS)
        self.assertTrue(self.files, 'The reviewed recovery inventory must be complete')
        self.advisories = tuple(release.CINCO_RECOVERY_ADVISORY_BLOBS)
        self.package = {'name': 'fixture', 'scripts': {'test:ui': 'node --test tests/existing.test.mjs'},
                        'dependencies': {'unchanged': '1.0.0'}}
        self.write('package.json', json.dumps(self.package))
        self.write('package-lock.json', 'unchanged dependencies\n')
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.added = {'tests/my-nights-refresh.test.mjs'}
        self.assertTrue(self.added <= set(self.files))
        for name in (*self.files, *release.CINCO_RECOVERY_CONTROL_FILES):
            if name != 'package.json' and name not in self.added:
                self.write(name, 'baseline ' + name + '\n')
        self.live = self.commit()
        for name in self.advisories:
            self.write(name, 'reviewed advisory ' + name + '\n')
        self.advisory = self.commit()
        self.operator = b'independent reviewed recovery operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed recovery tests\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        for name in self.files:
            if name == 'package.json':
                package = copy.deepcopy(self.package)
                package['scripts']['test:ui'] += ' tests/my-nights-refresh.test.mjs'
                self.write(name, json.dumps(package))
            else:
                self.write(name, 'exact reviewed recovery ' + name + '\n')
        self.candidate = self.commit()
        self.pins = {name: self.git('rev-parse', self.candidate + ':' + name) for name in self.files}
        values = {
            'CINCO_RECOVERY_RELEASE_BASELINE': self.live,
            'CINCO_RECOVERY_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'CINCO_RECOVERY_ADVISORY_BASE': self.advisory,
            'CINCO_RECOVERY_ADVISORY_TREE': self.git('rev-parse', self.advisory + '^{tree}'),
            'CINCO_RECOVERY_ADVISORY_BLOBS': {name: self.git('rev-parse', self.advisory + ':' + name)
                                           for name in self.advisories},
            'CINCO_RECOVERY_APPLICATION_BLOBS': self.pins,
            'CINCO_RECOVERY_PACKAGE_BASE_BLOB': self.git('rev-parse', self.live + ':package.json'),
            'CINCO_RECOVERY_LOCK_BLOB': self.git('rev-parse', self.live + ':package-lock.json'),
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'CINCO_RECOVERY_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.CINCO_RECOVERY_CONTROL_FILES, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.advisory + ':' + name))
                       for name in staged_names}
        self.patch_value(sys.modules[__name__], 'CINCO_RECOVERY_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated recovery source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_complete_patch_and_control_only_full_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | set(self.advisories)
                         | release.CINCO_RECOVERY_CONTROL_FILES)
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            with self.subTest(revision=revision):
                self.git('checkout', '-q', revision)
                family = checkout_source_family(self.root)
                self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
                for name in self.files:
                    if revision == self.control and name in self.added:
                        self.assertNotIn(name, family)
                    else:
                        self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_unrelated_files_dependencies_runtime_schema_and_advisories_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'package-lock.json',
                     'drizzle/9999_extra.sql', *self.advisories):
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed content\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.CINCO_RECOVERY_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_every_application_and_advisory_mode_change_is_rejected(self):
        for name in (*self.files, *self.advisories, *release.CINCO_RECOVERY_CONTROL_FILES):
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)

    def test_package_permission_is_only_the_exact_test_ui_append(self):
        for mutation in ('dependency', 'other-script', 'extra-test', 'other-field'):
            with self.subTest(mutation=mutation):
                self.git('checkout', '-q', self.candidate)
                package = json.loads((self.root / 'package.json').read_text())
                if mutation == 'dependency': package['dependencies']['unchanged'] = '2.0.0'
                elif mutation == 'other-script': package['scripts']['deploy'] = 'unreviewed'
                elif mutation == 'extra-test': package['scripts']['test:ui'] += ' tests/extra.mjs'
                else: package['name'] = 'unreviewed-name'
                self.write('package.json', json.dumps(package))
                changed = self.commit()
                with patch.dict(release.CINCO_RECOVERY_APPLICATION_BLOBS,
                                {'package.json': self.git('rev-parse', changed + ':package.json')}):
                    with self.assertRaisesRegex(release.ReleaseError, 'exact test:ui append'):
                        self.verify()
        self.git('checkout', '-q', self.candidate)
        for name in ('CINCO_RECOVERY_PACKAGE_BASE_BLOB', 'CINCO_RECOVERY_LOCK_BLOB'):
            with self.subTest(pin=name), patch.object(release, name, 'f' * 40):
                with self.assertRaisesRegex(release.ReleaseError, 'unchanged dependency lock'):
                    self.verify()

    def test_wrong_live_or_advisory_tree_is_rejected(self):
        for name in ('CINCO_RECOVERY_RELEASE_BASE_TREE', 'CINCO_RECOVERY_ADVISORY_TREE'):
            with self.subTest(name=name), patch.object(release, name, 'f' * 40):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_source_live_and_advisory_cannot_be_trust_anchors(self):
        for trusted in (self.candidate, self.live, self.advisory):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_unmerged_controls_fail_even_with_hostile_origin_main_tag(self):
        self.git('update-ref', 'refs/remotes/origin/main', self.advisory)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()

    def test_snapshot_with_identical_tree_cannot_bypass_control_ancestry(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.advisory, '-m', 'unmerged snapshot')
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify(snapshot)

    def test_advisory_cannot_hide_control_changes(self):
        self.git('checkout', '-q', self.advisory)
        self.write('ops/vps/test_code_release.py', 'unauthorized advisory control edit\n')
        advisory = self.commit()
        with patch.object(release, 'CINCO_RECOVERY_ADVISORY_BASE', advisory), \
             patch.object(release, 'CINCO_RECOVERY_ADVISORY_TREE', self.git('rev-parse', advisory + '^{tree}')):
            with self.assertRaisesRegex(release.ReleaseError, 'advisory inventory'):
                self.verify(self.candidate)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)


class FlashesSourceAdmissionTests(unittest.TestCase):
    """Real Git objects exercise the separate finite Flashes trust boundary."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Flashes admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.FLASHES_APPLICATION_BLOBS)
        self.assertTrue(self.files, 'The reviewed Flashes inventory must be complete')
        self.advisories = tuple(release.FLASHES_ADVISORY_BLOBS)
        self.security = tuple(release.FLASHES_SECURITY_BLOBS)
        self.package = {'name': 'fixture', 'scripts': {'test:ui': 'node --test tests/existing.test.mjs'},
                        'dependencies': {'unchanged': '1.0.0'}, 'devDependencies': {'vite': '8.2.1'}}
        for prefix in ('', 'mobile/'):
            self.write(prefix + 'package.json', json.dumps(self.package))
            self.write(prefix + 'package-lock.json', 'unchanged dependencies\n')
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.added = {'app/room/[slug]/flash-capture-mark.tsx'}
        self.assertTrue(self.added <= set(self.files))
        for name in (*self.files, *release.FLASHES_CONTROL_FILES):
            if name != 'package.json' and name not in self.added:
                self.write(name, 'baseline ' + name + '\n')
        self.live = self.commit()
        for name in self.advisories:
            self.write(name, 'reviewed advisory ' + name + '\n')
        self.advisory = self.commit()
        self.operator = b'independent reviewed Flashes operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed Flashes tests\n')
        package = copy.deepcopy(self.package)
        package['devDependencies']['vite'] = '8.2.4'
        for prefix in ('', 'mobile/'):
            self.write(prefix + 'package.json', json.dumps(package))
            self.write(prefix + 'package-lock.json', 'exact reviewed Vite security lock\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        for name in self.files:
            self.write(name, 'exact reviewed Flashes ' + name + '\n')
        self.candidate = self.commit()
        self.pins = {name: self.git('rev-parse', self.candidate + ':' + name) for name in self.files}
        values = {
            'FLASHES_RELEASE_BASELINE': self.live,
            'FLASHES_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'FLASHES_ADVISORY_BASE': self.advisory,
            'FLASHES_ADVISORY_TREE': self.git('rev-parse', self.advisory + '^{tree}'),
            'FLASHES_ADVISORY_BLOBS': {name: self.git('rev-parse', self.advisory + ':' + name)
                                           for name in self.advisories},
            'FLASHES_APPLICATION_BLOBS': self.pins,
            'FLASHES_SECURITY_BLOBS': {name: self.git('rev-parse', self.control + ':' + name)
                                       for name in self.security},
            'FLASHES_PACKAGE_BASE_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                           for name in self.security},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'FLASHES_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.FLASHES_CONTROL_FILES, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.advisory + ':' + name))
                       for name in staged_names}
        self.patch_value(sys.modules[__name__], 'FLASHES_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Flashes source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_complete_patch_and_control_only_full_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | set(self.advisories)
                         | set(release.FLASHES_SECURITY_BLOBS) | release.FLASHES_CONTROL_FILES)
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            with self.subTest(revision=revision):
                self.git('checkout', '-q', revision)
                family = checkout_source_family(self.root)
                self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
                for name in self.files:
                    if revision == self.control and name in self.added:
                        self.assertNotIn(name, family)
                    else:
                        self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_unrelated_files_dependencies_runtime_schema_and_advisories_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', *self.security,
                     'drizzle/9999_extra.sql', *self.advisories):
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed content\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.FLASHES_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_every_application_and_advisory_mode_change_is_rejected(self):
        for name in (*self.files, *self.advisories, *release.FLASHES_SECURITY_BLOBS, *release.FLASHES_CONTROL_FILES):
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)

    def test_security_patch_is_exact_in_control_and_candidate(self):
        for name in self.security:
            self.git('checkout', '-q', self.candidate)
            self.write(name, 'unreviewed security output\n')
            self.commit()
            with self.subTest(path=name), self.assertRaises(release.ReleaseError):
                self.verify()
        self.git('checkout', '-q', self.candidate)
        for name in release.FLASHES_PACKAGE_BASE_BLOBS:
            with self.subTest(base_pin=name), patch.dict(release.FLASHES_PACKAGE_BASE_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'package or dependency lock'):
                    self.verify()

    def test_each_security_file_must_be_exact_in_independent_controls(self):
        for name in self.security:
            for mutation in ('unreviewed', 'missing-change'):
                with self.subTest(path=name, mutation=mutation):
                    self.git('checkout', '-q', self.control)
                    if mutation == 'unreviewed':
                        self.write(name, 'unreviewed prerequisite dependency output\n')
                    else:
                        self.git('checkout', self.advisory, '--', name)
                    control = self.commit()
                    self.git('update-ref', 'refs/remotes/origin/main', control)
                    for application in self.files:
                        self.git('checkout', self.candidate, '--', application)
                    self.commit()
                    with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                        with self.assertRaises(release.ReleaseError):
                            self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)
        self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_independently_pinned_security_output_cannot_expand_package_semantics(self):
        for name in ('package.json', 'mobile/package.json'):
            for mutation in ('version', 'dependency', 'script', 'field'):
                with self.subTest(path=name, mutation=mutation):
                    self.git('checkout', '-q', self.control)
                    package = copy.deepcopy(self.package)
                    package['devDependencies']['vite'] = '8.2.4'
                    if mutation == 'version': package['devDependencies']['vite'] = '8.2.5'
                    elif mutation == 'dependency': package['dependencies']['unchanged'] = '2.0.0'
                    elif mutation == 'script': package['scripts']['deploy'] = 'unreviewed'
                    else: package['name'] = 'unreviewed'
                    self.write(name, json.dumps(package))
                    control = self.commit()
                    self.git('update-ref', 'refs/remotes/origin/main', control)
                    for application in self.files:
                        self.git('checkout', self.candidate, '--', application)
                    self.commit()
                    pins = {name: self.git('rev-parse', control + ':' + name)
                            for name in self.security}
                    with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
                         patch.dict(release.FLASHES_SECURITY_BLOBS, pins):
                        with self.assertRaisesRegex(release.ReleaseError, 'exact(?:ly Vite| Vite security patch)'):
                            self.verify()
            self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_wrong_live_or_advisory_tree_is_rejected(self):
        for name in ('FLASHES_RELEASE_BASE_TREE', 'FLASHES_ADVISORY_TREE'):
            with self.subTest(name=name), patch.object(release, name, 'f' * 40):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_source_live_and_advisory_cannot_be_trust_anchors(self):
        for trusted in (self.candidate, self.live, self.advisory):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_unmerged_controls_fail_even_with_hostile_origin_main_tag(self):
        self.git('update-ref', 'refs/remotes/origin/main', self.advisory)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify()

    def test_snapshot_with_identical_tree_cannot_bypass_control_ancestry(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.advisory, '-m', 'unmerged snapshot')
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify(snapshot)

    def test_advisory_cannot_hide_control_changes(self):
        self.git('checkout', '-q', self.advisory)
        self.write('ops/vps/test_code_release.py', 'unauthorized advisory control edit\n')
        advisory = self.commit()
        with patch.object(release, 'FLASHES_ADVISORY_BASE', advisory), \
             patch.object(release, 'FLASHES_ADVISORY_TREE', self.git('rev-parse', advisory + '^{tree}')):
            with self.assertRaisesRegex(release.ReleaseError, 'advisory inventory'):
                self.verify(self.candidate)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)


class NavigationSourceAdmissionTests(unittest.TestCase):
    """Real Git objects bind the new B/S/C/P family without changing older grants."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Navigation admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.NAVIGATION_APPLICATION_BLOBS)
        self.added = {name for name, blob in release.NAVIGATION_APPLICATION_INPUTS.items() if blob is None}
        self.assertTrue(self.added and self.added < set(self.files))
        self.package = {'name': 'fixture', 'scripts': {'test:repo': 'node --test tests/repo.mjs',
                        'test:ui': 'node --test tests/ui.mjs'}, 'dependencies': {'unchanged': '1.0.0'},
                        'devDependencies': {'vitest': '4.1.11'}}
        for name in (*self.files, *release.NAVIGATION_CONTROL_FILES):
            if name not in self.added:
                self.write(name, json.dumps(self.package, indent=2) if name == 'package.json' else 'baseline ' + name + '\n')
        for name in release.NAVIGATION_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        self.write('package-lock.json', 'baseline root dependency lock\n')
        self.security_package = copy.deepcopy(self.package)
        self.security_package['devDependencies']['vitest'] = '4.1.12'
        self.security_lock = 'exact reviewed root Vitest security lock\n'
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.live = self.commit()
        # S may contain several reviewed commits; direct-child ancestry is not assumed.
        self.git('commit', '--allow-empty', '-qm', 'feature preparation')
        for name in self.files:
            if name == 'package.json':
                package = copy.deepcopy(self.security_package)
                for script, append in release.NAVIGATION_TEST_SCRIPT_APPENDS.items():
                    package['scripts'][script] += append
                self.write(name, json.dumps(package, indent=2))
            else:
                self.write(name, 'exact reviewed navigation ' + name + '\n')
        self.write('package-lock.json', self.security_lock)
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.live)
        self.operator = b'independent reviewed navigation operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed navigation tests\n')
        self.write('package.json', json.dumps(self.security_package, indent=2))
        self.write('package-lock.json', self.security_lock)
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'NAVIGATION_RELEASE_BASELINE': self.live,
            'NAVIGATION_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'NAVIGATION_APP_SNAPSHOT': self.snapshot,
            'NAVIGATION_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'NAVIGATION_APPLICATION_INPUTS': self.inputs,
            'NAVIGATION_APPLICATION_BLOBS': self.pins,
            'NAVIGATION_PREREQUISITE_INPUTS': {name: self.git('rev-parse', self.live + ':' + name)
                                              for name in release.NAVIGATION_PREREQUISITE_INPUTS},
            'NAVIGATION_PREREQUISITE_BLOBS': {name: self.git('rev-parse', self.control + ':' + name)
                                             for name in release.NAVIGATION_PREREQUISITE_BLOBS},
            'NAVIGATION_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                          for name in release.NAVIGATION_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'NAVIGATION_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.NAVIGATION_CONTROL_FILES, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.live + ':' + name)) for name in staged_names}
        self.patch_value(sys.modules[__name__], 'NAVIGATION_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Navigation source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.NAVIGATION_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)

    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.NAVIGATION_CONTROL_FILES | set(release.NAVIGATION_PREREQUISITE_BLOBS))
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files) | set(release.NAVIGATION_PREREQUISITE_BLOBS):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)

    def test_revision_preserves_published_control_candidate_and_snapshot_ancestry(self):
        self.git('checkout', '-q', self.snapshot)
        name = self.files[0]
        self.write(name, 'reviewed source revision\n')
        snapshot = self.commit()
        blob = self.git('rev-parse', snapshot + ':' + name)
        self.git('checkout', '-q', self.control)
        operator = b'independent reviewed revised navigation operator\n'
        self.write('ops/vps/code-release.py', operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed revision tests\n')
        control = self.commit()
        self.git('checkout', '-q', self.candidate)
        self.git('merge', '--no-ff', '--no-commit', control, snapshot)
        candidate = self.commit()
        self.assertEqual(self.git('show', '-s', '--format=%P', candidate).split(),
                         [self.candidate, control, snapshot])
        self.assertEqual(self.git('show', '-s', '--format=%P', control), self.control)
        self.assertEqual(self.git('show', '-s', '--format=%P', snapshot), self.snapshot)
        for ancestor in (self.control, self.candidate, self.snapshot, control, snapshot):
            self.git('merge-base', '--is-ancestor', ancestor, candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
             patch.object(release, 'NAVIGATION_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'NAVIGATION_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             patch.dict(release.NAVIGATION_APPLICATION_BLOBS, {name: blob}), \
             patch.object(sys.modules[__name__], 'NAVIGATION_OPERATOR_BLOB', self.blob(operator)):
            self.assertEqual(set(self.verify()), set(self.files) | release.NAVIGATION_CONTROL_FILES | set(release.NAVIGATION_PREREQUISITE_BLOBS))
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'],
                             self.blob(operator))
            self.git('update-ref', 'refs/remotes/origin/main', self.control)
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *release.NAVIGATION_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *release.NAVIGATION_CONTROL_FILES, *release.NAVIGATION_PREREQUISITE_BLOBS}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('NAVIGATION_RELEASE_BASE_TREE', 'NAVIGATION_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.NAVIGATION_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.NAVIGATION_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'complete reviewed inventory'): self.verify()
        for name in release.NAVIGATION_DEPENDENCY_BLOBS:
            with patch.dict(release.NAVIGATION_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()

    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)

    def test_package_semantics_allow_only_exact_test_registration_appends(self):
        for mutation in ('dependency', 'other-script', 'extra-test', 'name'):
            self.git('checkout', '-q', self.snapshot)
            package = json.loads((self.root / 'package.json').read_text())
            if mutation == 'dependency': package['dependencies']['unchanged'] = '2.0.0'
            elif mutation == 'other-script': package['scripts']['deploy'] = 'unreviewed'
            elif mutation == 'extra-test': package['scripts']['test:ui'] += ' tests/unreviewed.mjs'
            else: package['name'] = 'unreviewed'
            self.write('package.json', json.dumps(package, indent=2))
            snapshot = self.commit()
            blob = self.git('rev-parse', snapshot + ':package.json')
            self.git('checkout', '-q', self.control)
            self.git('merge', '--no-ff', '--no-commit', snapshot)
            self.commit()
            with self.subTest(mutation=mutation), patch.object(release, 'NAVIGATION_APP_SNAPSHOT', snapshot), \
                 patch.object(release, 'NAVIGATION_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                 patch.dict(release.NAVIGATION_APPLICATION_BLOBS, {'package.json': blob}):
                with self.assertRaisesRegex(release.ReleaseError, 'exact test registration append'): self.verify()


    def test_prerequisite_schema_rejects_missing_extra_and_overlapping_paths(self):
        for constant in ('NAVIGATION_PREREQUISITE_INPUTS', 'NAVIGATION_PREREQUISITE_BLOBS'):
            original = getattr(release, constant)
            for mapping in ({'package.json': original['package.json']},
                            {**original, 'unreviewed.json': 'f' * 40}):
                with self.subTest(constant=constant, mapping=mapping), \
                     patch.object(release, constant, mapping):
                    with self.assertRaisesRegex(release.ReleaseError, 'prerequisite inventory'):
                        self.verify()
        for controls in (release.NAVIGATION_CONTROL_FILES | {'package-lock.json'},
                         {'ops/vps/code-release.py'}):
            with patch.object(release, 'NAVIGATION_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'prerequisite inventory'):
                    self.verify()
        for application in ({**self.pins, 'package-lock.json': 'f' * 40},
                            {name: blob for name, blob in self.pins.items() if name != 'package.json'},
                            {**self.pins, 'ops/vps/code-release.py': 'f' * 40}):
            with patch.object(release, 'NAVIGATION_APPLICATION_BLOBS', application):
                with self.assertRaisesRegex(release.ReleaseError, 'prerequisite inventory'):
                    self.verify()

    def test_every_prerequisite_input_and_output_pin_is_required(self):
        for constant in ('NAVIGATION_PREREQUISITE_INPUTS', 'NAVIGATION_PREREQUISITE_BLOBS'):
            for name in release.NAVIGATION_PREREQUISITE_BLOBS:
                with self.subTest(constant=constant, name=name), \
                     patch.dict(getattr(release, constant), {name: 'f' * 40}):
                    with self.assertRaises(release.ReleaseError):
                        self.verify()

    def test_prerequisite_pair_rejects_unpatched_mutated_missing_and_mode_changes(self):
        for revision in (self.control, self.candidate):
            for name in release.NAVIGATION_PREREQUISITE_BLOBS:
                for mutation in ('unpatched', 'bytes', 'missing', 'mode'):
                    with self.subTest(revision=revision, name=name, mutation=mutation):
                        self.git('checkout', '-q', revision)
                        if mutation == 'unpatched':
                            self.git('checkout', self.live, '--', name)
                        elif mutation == 'bytes':
                            self.write(name, 'unreviewed prerequisite bytes\n')
                        elif mutation == 'missing':
                            self.git('rm', name)
                        else:
                            (self.root / name).chmod(0o755)
                        changed = self.commit()
                        with self.assertRaises(AssertionError):
                            checkout_source_family(self.root)
                        if revision == self.control:
                            # Preserve the exact reviewed P tree and all ancestry;
                            # only the selected, merged prerequisite is malformed.
                            candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                                 '-p', self.candidate, '-p', changed, '-m', 'bad prerequisite ancestor')
                            self.git('checkout', '-q', candidate)
                            self.git('update-ref', 'refs/remotes/origin/main', changed)
                            with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed):
                                with self.assertRaises(release.ReleaseError):
                                    self.verify()
                            self.git('update-ref', 'refs/remotes/origin/main', self.control)
                        else:
                            with self.assertRaises(release.ReleaseError):
                                self.verify()

    def test_unpatched_merged_controls_cannot_authorize_patched_candidate(self):
        self.git('checkout', '-q', self.control)
        for name in release.NAVIGATION_PREREQUISITE_BLOBS:
            self.git('checkout', self.live, '--', name)
        old_control = self.commit()
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.candidate, '-p', old_control, '-m', 'unpatched merged control ancestor')
        self.git('checkout', '-q', candidate)
        self.git('update-ref', 'refs/remotes/origin/main', old_control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=old_control):
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_prerequisite_semantics_reject_changes_even_with_matching_blob_pins(self):
        for mutation in ('version', 'dependency', 'override', 'script', 'extra-test', 'name'):
            with self.subTest(mutation=mutation):
                control_package = copy.deepcopy(self.security_package)
                if mutation == 'version': control_package['devDependencies']['vitest'] = '4.1.13'
                elif mutation == 'dependency': control_package['dependencies']['unchanged'] = '2.0.0'
                elif mutation == 'override': control_package['overrides'] = {'vitest': '4.1.12'}
                elif mutation == 'script': control_package['scripts']['deploy'] = 'unreviewed'
                elif mutation == 'extra-test': control_package['scripts']['test:ui'] += ' tests/unreviewed.mjs'
                else: control_package['name'] = 'unreviewed'
                self.git('checkout', '-q', self.control)
                self.write('package.json', json.dumps(control_package, indent=2))
                control = self.commit()
                control_blob = self.git('rev-parse', control + ':package.json')
                package = copy.deepcopy(control_package)
                for name, append in release.NAVIGATION_TEST_SCRIPT_APPENDS.items():
                    package['scripts'][name] += append
                self.git('checkout', '-q', self.snapshot)
                self.write('package.json', json.dumps(package, indent=2))
                snapshot = self.commit()
                blob = self.git('rev-parse', snapshot + ':package.json')
                for name in release.NAVIGATION_CONTROL_FILES:
                    self.git('checkout', control, '--', name)
                tree = self.git('write-tree')
                candidate = self.git('commit-tree', tree, '-p', control, '-p', snapshot,
                                     '-m', 'matching pins cannot grant arbitrary package semantics')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
                     patch.object(release, 'NAVIGATION_APP_SNAPSHOT', snapshot), \
                     patch.object(release, 'NAVIGATION_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                     patch.dict(release.NAVIGATION_APPLICATION_BLOBS, {'package.json': blob}), \
                     patch.dict(release.NAVIGATION_PREREQUISITE_BLOBS, {'package.json': control_blob}):
                    with self.assertRaisesRegex(release.ReleaseError, 'exactly Vitest|exact Vitest security patch'):
                        self.verify()


class FiltersRoomSourceAdmissionTests(unittest.TestCase):
    """Real Git objects bind the new B/S/C/P family without changing older grants."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Filters/Room admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.FILTERS_ROOM_APPLICATION_BLOBS)
        self.added = {name for name, blob in release.FILTERS_ROOM_APPLICATION_INPUTS.items() if blob is None}
        self.assertTrue(self.added and self.added < set(self.files))
        self.package = {'name': 'fixture', 'scripts': {'test:repo': 'node --test tests/repo.mjs',
                        'test:ui': 'node --test tests/ui.mjs'}, 'dependencies': {'unchanged': '1.0.0'},
                        'devDependencies': {'vitest': '4.1.12'}}
        for name in (*self.files, *release.FILTERS_ROOM_CONTROL_FILES):
            if name not in self.added:
                self.write(name, json.dumps(self.package, indent=2) if name == 'package.json' else 'baseline ' + name + '\n')
        for name in release.FILTERS_ROOM_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.live = self.commit()
        # S may contain several reviewed commits; direct-child ancestry is not assumed.
        self.git('commit', '--allow-empty', '-qm', 'feature preparation')
        for name in self.files:
            if name == 'package.json':
                package = copy.deepcopy(self.package)
                for script, append in release.FILTERS_ROOM_TEST_SCRIPT_APPENDS.items():
                    package['scripts'][script] += append
                self.write(name, json.dumps(package, indent=2))
            else:
                self.write(name, 'exact reviewed filters_room ' + name + '\n')
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.live)
        self.operator = b'independent reviewed filters_room operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed filters_room tests\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'FILTERS_ROOM_RELEASE_BASELINE': self.live,
            'FILTERS_ROOM_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'FILTERS_ROOM_APP_SNAPSHOT': self.snapshot,
            'FILTERS_ROOM_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'FILTERS_ROOM_APPLICATION_INPUTS': self.inputs,
            'FILTERS_ROOM_APPLICATION_BLOBS': self.pins,
            'FILTERS_ROOM_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                          for name in release.FILTERS_ROOM_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'FILTERS_ROOM_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.FILTERS_ROOM_CONTROL_FILES, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.live + ':' + name)) for name in staged_names}
        self.patch_value(sys.modules[__name__], 'FILTERS_ROOM_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Filters/Room source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.FILTERS_ROOM_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)

    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.FILTERS_ROOM_CONTROL_FILES)
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)

    def test_revision_preserves_published_control_candidate_and_snapshot_ancestry(self):
        self.git('checkout', '-q', self.snapshot)
        name = 'tests/e2e/room-shortcut.spec.ts'
        self.write(name, 'reviewed source revision\n')
        snapshot = self.commit()
        blob = self.git('rev-parse', snapshot + ':' + name)
        self.git('checkout', '-q', self.control)
        operator = b'independent reviewed revised filters_room operator\n'
        self.write('ops/vps/code-release.py', operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed revision tests\n')
        control = self.commit()
        self.git('checkout', '-q', self.candidate)
        self.git('merge', '--no-ff', '--no-commit', control, snapshot)
        candidate = self.commit()
        self.assertEqual(self.git('show', '-s', '--format=%P', candidate).split(),
                         [self.candidate, control, snapshot])
        self.assertEqual(self.git('show', '-s', '--format=%P', control), self.control)
        self.assertEqual(self.git('show', '-s', '--format=%P', snapshot), self.snapshot)
        for ancestor in (self.control, self.candidate, self.snapshot, control, snapshot):
            self.git('merge-base', '--is-ancestor', ancestor, candidate)
        # The old merged operator cannot authorize new operator bytes.
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            release.verify_trusted_operator(candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
             patch.object(release, 'FILTERS_ROOM_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'FILTERS_ROOM_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             patch.dict(release.FILTERS_ROOM_APPLICATION_BLOBS, {name: blob}), \
             patch.object(sys.modules[__name__], 'FILTERS_ROOM_OPERATOR_BLOB', self.blob(operator)):
            self.assertEqual(len(self.files), 19)
            self.assertEqual(set(self.git('diff', '--name-only', self.live, control).splitlines()),
                             release.FILTERS_ROOM_CONTROL_FILES)
            self.assertEqual(set(self.git('diff', '--name-only', snapshot, candidate).splitlines()),
                             release.FILTERS_ROOM_CONTROL_FILES)
            self.assertEqual(set(self.git('diff', '--name-only', control, candidate).splitlines()),
                             set(self.files))
            self.assertEqual(set(self.verify()), set(self.files) | release.FILTERS_ROOM_CONTROL_FILES)
            self.assertEqual(release.migration_plan(self.verify()), [])
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'],
                             self.blob(operator))
            self.git('update-ref', 'refs/remotes/origin/main', self.control)
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *release.FILTERS_ROOM_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *release.FILTERS_ROOM_CONTROL_FILES}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('FILTERS_ROOM_RELEASE_BASE_TREE', 'FILTERS_ROOM_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.FILTERS_ROOM_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.FILTERS_ROOM_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
        for name in release.FILTERS_ROOM_DEPENDENCY_BLOBS:
            with patch.dict(release.FILTERS_ROOM_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()

    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)

    def test_package_semantics_allow_only_exact_test_registration_appends(self):
        for mutation in ('dependency', 'other-script', 'extra-repo-test', 'extra-ui-test',
                         'missing-repo-test', 'missing-ui-test', 'reordered-ui-tests', 'name'):
            self.git('checkout', '-q', self.snapshot)
            package = json.loads((self.root / 'package.json').read_text())
            if mutation == 'dependency': package['dependencies']['unchanged'] = '2.0.0'
            elif mutation == 'other-script': package['scripts']['deploy'] = 'unreviewed'
            elif mutation == 'extra-repo-test': package['scripts']['test:repo'] += ' tests/unreviewed.mjs'
            elif mutation == 'extra-ui-test': package['scripts']['test:ui'] += ' tests/unreviewed.mjs'
            elif mutation == 'missing-repo-test': package['scripts']['test:repo'] = self.package['scripts']['test:repo']
            elif mutation == 'missing-ui-test': package['scripts']['test:ui'] = self.package['scripts']['test:ui']
            elif mutation == 'reordered-ui-tests':
                package['scripts']['test:ui'] = self.package['scripts']['test:ui'] + \
                    ' tests/flash-camera-state.test.mjs tests/flash-photo-filters.test.mjs'
            else: package['name'] = 'unreviewed'
            self.write('package.json', json.dumps(package, indent=2))
            snapshot = self.commit()
            blob = self.git('rev-parse', snapshot + ':package.json')
            self.git('checkout', '-q', self.control)
            self.git('merge', '--no-ff', '--no-commit', snapshot)
            self.commit()
            with self.subTest(mutation=mutation), patch.object(release, 'FILTERS_ROOM_APP_SNAPSHOT', snapshot), \
                 patch.object(release, 'FILTERS_ROOM_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                 patch.dict(release.FILTERS_ROOM_APPLICATION_BLOBS, {'package.json': blob}):
                with self.assertRaisesRegex(release.ReleaseError, 'exact test registration append'): self.verify()



    def test_scope_schema_rejects_controls_dependencies_and_forbidden_application_paths(self):
        for controls in ({'ops/vps/code-release.py'},
                         release.FILTERS_ROOM_CONTROL_FILES | {'package-lock.json'}):
            with self.subTest(controls=controls), patch.object(release, 'FILTERS_ROOM_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for dependencies in ({}, {**release.FILTERS_ROOM_DEPENDENCY_BLOBS, 'other.lock': 'f' * 40}):
            with self.subTest(dependencies=dependencies), \
                 patch.object(release, 'FILTERS_ROOM_DEPENDENCY_BLOBS', dependencies):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for name in ('package-lock.json', 'mobile/package.json', '.github/workflows/new.yml',
                     'runtime/vps/package.json', 'drizzle/9999_extra.sql', 'ops/vps/code-release.py'):
            with self.subTest(path=name), \
                 patch.dict(release.FILTERS_ROOM_APPLICATION_BLOBS, {name: 'f' * 40}), \
                 patch.dict(release.FILTERS_ROOM_APPLICATION_INPUTS, {name: None}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        application = {name: blob for name, blob in self.pins.items() if name != 'package.json'}
        inputs = {name: blob for name, blob in self.inputs.items() if name != 'package.json'}
        with patch.object(release, 'FILTERS_ROOM_APPLICATION_BLOBS', application), \
             patch.object(release, 'FILTERS_ROOM_APPLICATION_INPUTS', inputs):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                self.verify()

    def test_controls_only_baseline_rejects_any_application_dependency_or_workflow_change(self):
        for name in (self.files[0], *release.FILTERS_ROOM_DEPENDENCY_BLOBS,
                     '.github/workflows/candidate-checks.yml'):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.write(name, 'unreviewed control-side change\n')
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'retain exact candidate bytes')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_both_controls_must_change_and_remain_identical_in_promotion(self):
        for name in release.FILTERS_ROOM_CONTROL_FILES:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.git('checkout', self.live, '--', name)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', self.snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_every_output_pin_is_required_independently_of_the_snapshot_tree(self):
        for name in self.files:
            with self.subTest(path=name), \
                 patch.dict(release.FILTERS_ROOM_APPLICATION_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'snapshot output'):
                    self.verify()

    def test_controls_index_edits_cannot_hide_behind_restored_worktree_bytes(self):
        for revision in (self.control, self.candidate):
            for name in release.FILTERS_ROOM_CONTROL_FILES:
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    original = (self.root / name).read_bytes()
                    self.write(name, 'hidden staged control change\n')
                    self.git('add', name)
                    self.write(name, original)
                    with self.assertRaisesRegex(AssertionError, 'index differs'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)

    def test_snapshot_with_matching_tree_but_without_baseline_ancestry_is_rejected(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                            '-m', 'unrelated snapshot with matching bytes')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', snapshot, '-m', 'include unrelated source')
        self.git('checkout', '-q', candidate)
        with patch.object(release, 'FILTERS_ROOM_APP_SNAPSHOT', snapshot):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()

    def test_family_dispatch_uses_filters_room_before_historical_navigation(self):
        with patch(__name__ + '.navigation_source_family', side_effect=AssertionError('old family selected')):
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'], self.blob(self.operator))
        with patch.object(release, 'reviewed_navigation_application_blobs',
                          side_effect=AssertionError('old admission selected')):
            self.assertEqual(set(self.verify()), set(self.files) | release.FILTERS_ROOM_CONTROL_FILES)


    def test_executing_filters_room_tests_cannot_fall_back_to_an_older_operator_family(self):
        self.git('checkout', '-q', self.control)
        self.write('ops/vps/code-release.py', 'historical operator bytes\n')
        self.git('add', 'ops/vps/code-release.py')
        with patch.object(sys.modules[__name__], '__file__', str(self.root / 'ops/vps/test_code_release.py')), \
             patch(__name__ + '.navigation_source_family', return_value={'old': 'accepted'}) as old_family:
            with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                checkout_source_family(self.root)
            old_family.assert_not_called()


    def test_staged_deletions_restored_as_untracked_exact_files_are_rejected(self):
        for revision in (self.control, self.candidate):
            for name in (self.files[0], *release.FILTERS_ROOM_CONTROL_FILES):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    self.git('rm', '--cached', name)
                    with self.assertRaisesRegex(AssertionError, 'full inventory'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_normal_main_merge_accepts_original_control_ancestor(self):
        merged = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                          '-p', self.live, '-p', self.control, '-m', 'normal merge of reviewed controls')
        self.git('update-ref', 'refs/remotes/origin/main', merged)
        self.assertEqual(self.git('show', '-s', '--format=%P', self.control), self.live)
        self.assertEqual(self.git('show', '-s', '--format=%P', merged).split(), [self.live, self.control])
        self.assertEqual(self.git('show', '-s', '--format=%P', self.candidate).split(),
                         [self.control, self.snapshot])
        self.assertEqual(set(self.verify()), set(self.files) | release.FILTERS_ROOM_CONTROL_FILES)
        # The branch commit C is the trust anchor, not a newer same-tree main merge
        # which is deliberately absent from the already-published P ancestry.
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=merged):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_missing_invalid_and_unrelated_same_tree_controls_are_rejected(self):
        for trusted in ('', 'HEAD', 'a' * 12, 'A' * 40, 'f' * 40):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises((release.ReleaseError, subprocess.CalledProcessError)):
                    self.verify()
        unrelated = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                             '-m', 'unrelated same-tree controls')
        self.git('update-ref', 'refs/remotes/origin/main', unrelated)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_same_tree_wrong_baseline_and_source_commit_identities_are_rejected(self):
        wrong_base = self.git('commit-tree', self.git('rev-parse', self.live + '^{tree}'),
                              '-m', 'same-tree wrong live identity')
        with self.assertRaisesRegex(release.ReleaseError, 'live or snapshot tree'):
            release.reviewed_filters_room_application_blobs(wrong_base, self.candidate)
        wrong_source = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                                '-p', self.live, '-m', 'same-tree unreviewed source identity')
        impostor = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                           '-p', self.control, '-p', wrong_source, '-m', 'wrong source ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(impostor)


class RecoveryAuditSourceAdmissionTests(unittest.TestCase):
    """Real Git objects bind the new M/S/C/P family without changing older grants."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Recovery/audit admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.RECOVERY_AUDIT_APPLICATION_BLOBS)
        self.added = {name for name, blob in release.RECOVERY_AUDIT_APPLICATION_INPUTS.items() if blob is None}
        self.assertFalse(self.added)
        self.assertEqual(len(self.files), 5)
        for name in (*self.files, *release.RECOVERY_AUDIT_CONTROL_FILES):
            if name not in self.added:
                self.write(name, 'baseline ' + name + '\n')
        for name in release.RECOVERY_AUDIT_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.live = self.commit()
        # S may contain several reviewed commits; direct-child ancestry is not assumed.
        self.git('commit', '--allow-empty', '-qm', 'feature preparation')
        for name in self.files:
            self.write(name, 'exact reviewed recovery_audit ' + name + '\n')
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.live)
        self.operator = b'independent reviewed recovery_audit operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed recovery_audit tests\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'RECOVERY_AUDIT_RELEASE_BASELINE': self.live,
            'RECOVERY_AUDIT_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'RECOVERY_AUDIT_APP_SNAPSHOT': self.snapshot,
            'RECOVERY_AUDIT_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'RECOVERY_AUDIT_APPLICATION_INPUTS': self.inputs,
            'RECOVERY_AUDIT_APPLICATION_BLOBS': self.pins,
            'RECOVERY_AUDIT_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                          for name in release.RECOVERY_AUDIT_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'RECOVERY_AUDIT_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.RECOVERY_AUDIT_CONTROL_FILES, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.live + ':' + name)) for name in staged_names}
        self.patch_value(sys.modules[__name__], 'RECOVERY_AUDIT_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Recovery/audit source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.RECOVERY_AUDIT_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)

    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.RECOVERY_AUDIT_CONTROL_FILES)
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)

    def test_revision_preserves_published_control_candidate_and_snapshot_ancestry(self):
        self.git('checkout', '-q', self.snapshot)
        name = 'tests/e2e/discovery-pass-access.spec.ts'
        self.write(name, 'reviewed source revision\n')
        snapshot = self.commit()
        blob = self.git('rev-parse', snapshot + ':' + name)
        self.git('checkout', '-q', self.control)
        operator = b'independent reviewed revised recovery_audit operator\n'
        self.write('ops/vps/code-release.py', operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed revision tests\n')
        control = self.commit()
        self.git('checkout', '-q', self.candidate)
        self.git('merge', '--no-ff', '--no-commit', control, snapshot)
        candidate = self.commit()
        self.assertEqual(self.git('show', '-s', '--format=%P', candidate).split(),
                         [self.candidate, control, snapshot])
        self.assertEqual(self.git('show', '-s', '--format=%P', control), self.control)
        self.assertEqual(self.git('show', '-s', '--format=%P', snapshot), self.snapshot)
        for ancestor in (self.control, self.candidate, self.snapshot, control, snapshot):
            self.git('merge-base', '--is-ancestor', ancestor, candidate)
        # The old merged operator cannot authorize new operator bytes.
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            release.verify_trusted_operator(candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
             patch.object(release, 'RECOVERY_AUDIT_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'RECOVERY_AUDIT_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             patch.dict(release.RECOVERY_AUDIT_APPLICATION_BLOBS, {name: blob}), \
             patch.object(sys.modules[__name__], 'RECOVERY_AUDIT_OPERATOR_BLOB', self.blob(operator)):
            self.assertEqual(len(self.files), 5)
            self.assertEqual(set(self.git('diff', '--name-only', self.live, control).splitlines()),
                             release.RECOVERY_AUDIT_CONTROL_FILES)
            self.assertEqual(set(self.git('diff', '--name-only', snapshot, candidate).splitlines()),
                             release.RECOVERY_AUDIT_CONTROL_FILES)
            self.assertEqual(set(self.git('diff', '--name-only', control, candidate).splitlines()),
                             set(self.files))
            self.assertEqual(set(self.verify()), set(self.files) | release.RECOVERY_AUDIT_CONTROL_FILES)
            self.assertEqual(release.migration_plan(self.verify()), [])
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'],
                             self.blob(operator))
            self.git('update-ref', 'refs/remotes/origin/main', self.control)
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *release.RECOVERY_AUDIT_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *release.RECOVERY_AUDIT_CONTROL_FILES}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('RECOVERY_AUDIT_RELEASE_BASE_TREE', 'RECOVERY_AUDIT_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.RECOVERY_AUDIT_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.RECOVERY_AUDIT_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
        for name in release.RECOVERY_AUDIT_DEPENDENCY_BLOBS:
            with patch.dict(release.RECOVERY_AUDIT_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()

    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)

    def test_scope_schema_rejects_controls_dependencies_and_forbidden_application_paths(self):
        for controls in ({'ops/vps/code-release.py'},
                         release.RECOVERY_AUDIT_CONTROL_FILES | {'package-lock.json'}):
            with self.subTest(controls=controls), patch.object(release, 'RECOVERY_AUDIT_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for dependencies in ({}, {**release.RECOVERY_AUDIT_DEPENDENCY_BLOBS, 'other.lock': 'f' * 40}):
            with self.subTest(dependencies=dependencies), \
                 patch.object(release, 'RECOVERY_AUDIT_DEPENDENCY_BLOBS', dependencies):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for name in ('package-lock.json', 'mobile/package.json', '.github/workflows/new.yml',
                     'runtime/vps/package.json', 'drizzle/9999_extra.sql', 'ops/vps/code-release.py'):
            with self.subTest(path=name), \
                 patch.dict(release.RECOVERY_AUDIT_APPLICATION_BLOBS, {name: 'f' * 40}), \
                 patch.dict(release.RECOVERY_AUDIT_APPLICATION_INPUTS, {name: None}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        application = {name: blob for name, blob in self.pins.items() if name != self.files[0]}
        inputs = {name: blob for name, blob in self.inputs.items() if name != self.files[0]}
        with patch.object(release, 'RECOVERY_AUDIT_APPLICATION_BLOBS', application), \
             patch.object(release, 'RECOVERY_AUDIT_APPLICATION_INPUTS', inputs):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                self.verify()

    def test_controls_only_baseline_rejects_any_application_dependency_or_workflow_change(self):
        for name in (self.files[0], *release.RECOVERY_AUDIT_DEPENDENCY_BLOBS,
                     '.github/workflows/candidate-checks.yml'):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.write(name, 'unreviewed control-side change\n')
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'retain exact candidate bytes')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_both_controls_must_change_and_remain_identical_in_promotion(self):
        for name in release.RECOVERY_AUDIT_CONTROL_FILES:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.git('checkout', self.live, '--', name)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', self.snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_every_output_pin_is_required_independently_of_the_snapshot_tree(self):
        for name in self.files:
            with self.subTest(path=name), \
                 patch.dict(release.RECOVERY_AUDIT_APPLICATION_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'snapshot output'):
                    self.verify()

    def test_controls_index_edits_cannot_hide_behind_restored_worktree_bytes(self):
        for revision in (self.control, self.candidate):
            for name in release.RECOVERY_AUDIT_CONTROL_FILES:
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    original = (self.root / name).read_bytes()
                    self.write(name, 'hidden staged control change\n')
                    self.git('add', name)
                    self.write(name, original)
                    with self.assertRaisesRegex(AssertionError, 'index differs'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)

    def test_snapshot_with_matching_tree_but_without_baseline_ancestry_is_rejected(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                            '-m', 'unrelated snapshot with matching bytes')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', snapshot, '-m', 'include unrelated source')
        self.git('checkout', '-q', candidate)
        with patch.object(release, 'RECOVERY_AUDIT_APP_SNAPSHOT', snapshot):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()

    def test_family_dispatch_uses_recovery_audit_before_historical_filters_room(self):
        with patch(__name__ + '.filters_room_source_family', side_effect=AssertionError('old family selected')):
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'], self.blob(self.operator))
        with patch.object(release, 'reviewed_filters_room_application_blobs',
                          side_effect=AssertionError('old admission selected')):
            self.assertEqual(set(self.verify()), set(self.files) | release.RECOVERY_AUDIT_CONTROL_FILES)


    def test_executing_recovery_audit_tests_cannot_fall_back_to_an_older_operator_family(self):
        self.git('checkout', '-q', self.control)
        self.write('ops/vps/code-release.py', 'historical operator bytes\n')
        self.git('add', 'ops/vps/code-release.py')
        with patch.object(sys.modules[__name__], 'RECOVERY_AUDIT_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             patch(__name__ + '.filters_room_source_family', return_value={'old': 'accepted'}) as old_family:
            with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                checkout_source_family(self.root)
            old_family.assert_not_called()


    def test_staged_deletions_restored_as_untracked_exact_files_are_rejected(self):
        for revision in (self.control, self.candidate):
            for name in (self.files[0], *release.RECOVERY_AUDIT_CONTROL_FILES):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    self.git('rm', '--cached', name)
                    with self.assertRaisesRegex(AssertionError, 'full inventory'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_normal_main_merge_accepts_original_control_ancestor(self):
        merged = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                          '-p', self.live, '-p', self.control, '-m', 'normal merge of reviewed controls')
        self.git('update-ref', 'refs/remotes/origin/main', merged)
        self.assertEqual(self.git('show', '-s', '--format=%P', self.control), self.live)
        self.assertEqual(self.git('show', '-s', '--format=%P', merged).split(), [self.live, self.control])
        self.assertEqual(self.git('show', '-s', '--format=%P', self.candidate).split(),
                         [self.control, self.snapshot])
        self.assertEqual(set(self.verify()), set(self.files) | release.RECOVERY_AUDIT_CONTROL_FILES)
        # The branch commit C is the trust anchor, not a newer same-tree main merge
        # which is deliberately absent from the already-published P ancestry.
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=merged):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_missing_invalid_and_unrelated_same_tree_controls_are_rejected(self):
        for trusted in ('', 'HEAD', 'a' * 12, 'A' * 40, 'f' * 40):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises((release.ReleaseError, subprocess.CalledProcessError)):
                    self.verify()
        unrelated = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                             '-m', 'unrelated same-tree controls')
        self.git('update-ref', 'refs/remotes/origin/main', unrelated)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_same_tree_wrong_baseline_and_source_commit_identities_are_rejected(self):
        wrong_base = self.git('commit-tree', self.git('rev-parse', self.live + '^{tree}'),
                              '-m', 'same-tree wrong live identity')
        with self.assertRaisesRegex(release.ReleaseError, 'live or snapshot tree'):
            release.reviewed_recovery_audit_application_blobs(wrong_base, self.candidate)
        wrong_source = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                                '-p', self.live, '-m', 'same-tree unreviewed source identity')
        impostor = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                           '-p', self.control, '-p', wrong_source, '-m', 'wrong source ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(impostor)


class IntegratedExperienceSourceAdmissionTests(unittest.TestCase):
    """Real Git objects bind the new M/S/C/P family without changing older grants."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        # Keep automatic maintenance enabled, but finish its writers before cleanup.
        self.git('config', '--local', 'maintenance.autoDetach', 'false')
        self.git('config', '--local', 'gc.autoDetach', 'false')
        self.git('config', 'user.name', 'Integrated experience admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.INTEGRATED_EXPERIENCE_APPLICATION_BLOBS)
        self.added = {name for name, blob in release.INTEGRATED_EXPERIENCE_APPLICATION_INPUTS.items() if blob is None}
        self.assertEqual(self.added, {'app/global-error.tsx',
         'app/header-origin-menu.css',
         'docs/audits/pwa-resume-2026-10-23.md',
         'lib/mobile-viewport.ts',
         'lib/room-viewport.ts',
         'lib/website-event-listings.ts',
         'scripts/iphone-layout-parity.mjs',
         'tests/e2e/pwa-resume.spec.ts',
         'tests/e2e/website-event-unlisting.spec.ts',
         'tests/header-origin-menu.test.mjs',
         'tests/iphone-layout-parity.test.mjs',
         'tests/pwa-resume.test.mjs',
         'tests/scanner-browser-lifecycle.test.mjs',
         'tests/website-event-listings.test.ts'})
        self.assertEqual(len(self.files), 38)
        self.package = {'name': 'fixture', 'scripts': {'test:ui': 'node --test tests/header-panel-focus.test.mjs',
                                                     'test:repo': 'node --test tests/repository-boundaries.test.mjs'},
                        'dependencies': {'next': '16.3.8', 'unchanged': '1.0.0'},
                        'overrides': {'unchanged': '1.0.0'}}
        self.security_package = copy.deepcopy(self.package)
        self.security_package['dependencies']['next'] = '16.4.1'
        self.security_package['overrides']['zod'] = '4.6.6'
        self.security_lock = 'exact reviewed Next.js security lock\n'
        self.write('package-lock.json', 'baseline root lock\n')
        for name in (*self.files, *release.INTEGRATED_EXPERIENCE_CONTROL_FILES):
            if name not in self.added:
                self.write(name, json.dumps(self.package, indent=2) if name == 'package.json' else 'baseline ' + name + '\n')
        for name in release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.workflow = '.github/workflows/tickets-release-operator-checks.yml'
        self.workflow_before = ('permissions:\n  contents: read\njobs:\n  verify:\n'
                                '    timeout-minutes: 5\n    steps:\n'
                                '      - run: python3 -m unittest discover -s ops/vps\n')
        self.workflow_after = self.workflow_before.replace('    timeout-minutes: 5\n',
                                                          '    timeout-minutes: 10\n')
        self.write(self.workflow, self.workflow_before)
        self.live = self.commit()
        # S may contain several reviewed commits; direct-child ancestry is not assumed.
        self.git('commit', '--allow-empty', '-qm', 'feature preparation')
        for name in self.files:
            if name == 'package.json':
                package = copy.deepcopy(self.security_package)
                package['scripts']['test:ui'] = package['scripts']['test:ui'].replace(
                    'tests/header-panel-focus.test.mjs', 'tests/header-panel-focus.test.mjs tests/header-origin-menu.test.mjs'
                ) + ' tests/pwa-resume.test.mjs'
                package['scripts']['test:repo'] += ' tests/scanner-browser-lifecycle.test.mjs'
                self.write(name, json.dumps(package, indent=2))
            else:
                self.write(name, 'exact reviewed integrated_experience ' + name + '\n')
        self.write('package-lock.json', self.security_lock)
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.live)
        self.operator = b'independent reviewed integrated_experience operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed integrated_experience tests\n')
        self.write(self.workflow, self.workflow_after)
        self.write('package.json', json.dumps(self.security_package, indent=2))
        self.write('package-lock.json', self.security_lock)
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'INTEGRATED_EXPERIENCE_RELEASE_BASELINE': self.live,
            'INTEGRATED_EXPERIENCE_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'INTEGRATED_EXPERIENCE_APP_SNAPSHOT': self.snapshot,
            'INTEGRATED_EXPERIENCE_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'INTEGRATED_EXPERIENCE_APPLICATION_INPUTS': self.inputs,
            'INTEGRATED_EXPERIENCE_APPLICATION_BLOBS': self.pins,
            'INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS': {name: self.git('rev-parse', self.live + ':' + name)
                                                      for name in release.INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS},
            'INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS': {name: self.git('rev-parse', self.control + ':' + name)
                                                     for name in release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS},
            'INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                          for name in release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'INTEGRATED_EXPERIENCE_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.INTEGRATED_EXPERIENCE_CONTROL_FILES, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml', self.workflow)
        self.staged = {name: ('100644', self.git('rev-parse',
                       (self.control if name == self.workflow else self.live) + ':' + name))
                       for name in staged_names}
        self.patch_value(sys.modules[__name__], 'INTEGRATED_EXPERIENCE_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Integrated experience source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_fixture_automatic_git_maintenance_finishes_before_cleanup(self):
        for name in ('maintenance.autoDetach', 'gc.autoDetach'):
            self.assertEqual(self.git('config', '--local', '--bool', name), 'false')
        with tempfile.TemporaryDirectory() as directory:
            trace = Path(directory) / 'git-trace.jsonl'
            environment = {**release.git_environment(), 'GIT_TRACE2_EVENT': str(trace)}
            with patch.object(release, 'git_environment', return_value=environment):
                self.git('commit', '--allow-empty', '-qm', 'foreground fixture maintenance')
            events = [json.loads(line) for line in trace.read_text().splitlines()]
            children = [event['argv'] for event in events
                        if event.get('event') == 'child_start'
                        and 'maintenance' in event.get('argv', [])]
            self.assertTrue(children, 'Automatic maintenance must remain enabled')
            self.assertTrue(all('--no-detach' in argv and '--detach' not in argv for argv in children))
            self.assertFalse(any(event.get('event') == 'region_enter'
                                 and event.get('category') == 'maintenance'
                                 and event.get('label') == 'detach' for event in events))
            self.assertFalse((self.root / '.git/objects/maintenance.lock').exists())

    def test_workflow_prerequisite_rejects_repinning_any_change_except_timeout(self):
        mutations = (self.workflow_after.replace('10', '11'),
                     self.workflow_after.replace('contents: read', 'contents: write'),
                     self.workflow_after.replace('python3 -m unittest discover -s ops/vps', 'true'),
                     self.workflow_after + 'unexpected: true\n')
        for raw in mutations:
            with self.subTest(workflow=raw):
                self.git('checkout', '-q', self.control)
                self.write(self.workflow, raw)
                control = self.commit()
                self.git('checkout', '-q', self.candidate)
                self.write(self.workflow, raw)
                candidate = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', candidate + '^{tree}'),
                                     '-p', candidate, '-p', control, '-m', 'revised workflow ancestry')
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
                     patch.dict(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS,
                                {self.workflow: self.git('rev-parse', control + ':' + self.workflow)}), \
                     self.assertRaisesRegex(release.ReleaseError, 'exact timeout headroom patch'):
                    self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_workflow_output_is_exact_in_promotion_and_unchanged_in_snapshot(self):
        for mutation in ('bytes', 'mode', 'missing', 'baseline'):
            with self.subTest(mutation=mutation):
                self.git('checkout', '-q', self.candidate)
                if mutation == 'bytes': self.write(self.workflow, 'unreviewed workflow\n')
                elif mutation == 'mode': (self.root / self.workflow).chmod(0o755)
                elif mutation == 'missing': self.git('rm', self.workflow)
                else: self.write(self.workflow, self.workflow_before)
                candidate = self.commit()
                with self.assertRaises(release.ReleaseError): self.verify(candidate)
                with self.assertRaises(AssertionError): checkout_source_family(self.root)
        self.git('checkout', '-q', self.snapshot)
        self.write(self.workflow, self.workflow_after)
        snapshot = self.commit()
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.candidate, '-p', snapshot, '-m', 'source workflow mutation')
        with patch.object(release, 'INTEGRATED_EXPERIENCE_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'INTEGRATED_EXPERIENCE_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             self.assertRaisesRegex(release.ReleaseError, 'snapshot differs'):
            self.verify(candidate)

    def test_root_security_pair_is_exact_and_cannot_be_moved_into_frozen_dependencies(self):
        root_pair = {'package.json', 'package-lock.json'}
        self.assertEqual(root_pair & set(self.inputs) & set(self.pins), {'package.json'})
        self.assertEqual(root_pair | {self.workflow}, set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS)
                         & set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS))
        self.assertTrue(root_pair.isdisjoint(release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS))
        for name in root_pair:
            self.assertNotEqual(release.INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS[name],
                                release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS[name])
            with self.subTest(path=name), patch.dict(
                    release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS, {name: release.INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS[name]}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()

    def test_prerequisite_pair_inventory_and_each_input_output_pin_are_required(self):
        for constant in ('INTEGRATED_EXPERIENCE_PREREQUISITE_INPUTS',
                         'INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS'):
            original = getattr(release, constant)
            for inventory in ({}, {**original, 'other.lock': 'f' * 40}):
                with self.subTest(constant=constant, inventory=inventory), \
                     patch.object(release, constant, inventory), \
                     self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
            for name in original:
                with self.subTest(constant=constant, path=name), \
                     patch.dict(original, {name: 'f' * 40}), self.assertRaises(release.ReleaseError):
                    self.verify()

    def test_control_security_pair_rejects_mutation_omission_mode_and_script_drift(self):
        for name in release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS:
            for mutation in ('bytes', 'baseline', 'mode', 'missing', 'scripts'):
                if mutation == 'scripts' and name != 'package.json':
                    continue
                with self.subTest(path=name, mutation=mutation):
                    self.git('checkout', '-q', self.control)
                    if mutation == 'baseline': self.git('checkout', self.live, '--', name)
                    elif mutation == 'mode': (self.root / name).chmod(0o755)
                    elif mutation == 'missing': self.git('rm', name)
                    elif mutation == 'scripts':
                        package = copy.deepcopy(self.security_package)
                        package['scripts']['test:ui'] += ' tests/unreviewed.mjs'
                        self.write(name, json.dumps(package, indent=2))
                    else: self.write(name, 'unreviewed prerequisite bytes\n')
                    control = self.commit()
                    with self.assertRaises(AssertionError): checkout_source_family(self.root)
                    candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                         '-p', self.candidate, '-p', control, '-m', 'preserve exact source with changed prerequisite')
                    self.git('checkout', '-q', candidate)
                    self.git('update-ref', 'refs/remotes/origin/main', control)
                    with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), self.assertRaises(release.ReleaseError):
                        self.verify()
                    self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_prerequisite_semantics_reject_repinning_scripts_or_other_dependencies(self):
        for field in ('scripts', 'next', 'other_dependency', 'zod_missing', 'zod_version', 'other_override'):
            with self.subTest(field=field):
                self.git('checkout', '-q', self.control)
                package = copy.deepcopy(self.security_package)
                if field == 'scripts': package['scripts']['test:ui'] += ' tests/unreviewed.mjs'
                elif field == 'next': package['dependencies']['next'] = '16.4.2'
                elif field == 'zod_missing': del package['overrides']['zod']
                elif field == 'zod_version': package['overrides']['zod'] = '4.6.7'
                elif field == 'other_override': package['overrides']['unchanged'] = '2.0.0'
                else: package['dependencies']['unchanged'] = '2.0.0'
                self.write('package.json', json.dumps(package, indent=2))
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'preserve exact application output')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
                     patch.dict(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS,
                                {'package.json': self.git('rev-parse', control + ':package.json')}), \
                     self.assertRaisesRegex(release.ReleaseError, 'requires exactly|prerequisite is not'):
                    self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_promotion_test_script_drift_is_rejected_even_with_revised_snapshot_pins(self):
        for script in ('test:ui', 'test:repo'):
            with self.subTest(script=script):
                self.git('checkout', '-q', self.snapshot)
                package = json.loads((self.root / 'package.json').read_text())
                package['scripts'][script] += ' tests/unreviewed.mjs'
                self.write('package.json', json.dumps(package, indent=2))
                snapshot = self.commit()
                self.git('checkout', '-q', self.control)
                self.git('merge', '--no-ff', '--no-commit', snapshot)
                candidate = self.commit()
                with patch.object(release, 'INTEGRATED_EXPERIENCE_APP_SNAPSHOT', snapshot), \
                     patch.object(release, 'INTEGRATED_EXPERIENCE_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                     patch.dict(release.INTEGRATED_EXPERIENCE_APPLICATION_BLOBS,
                                {'package.json': self.git('rev-parse', snapshot + ':package.json')}), \
                     self.assertRaisesRegex(release.ReleaseError, 'exact test registration patch'):
                    self.verify(candidate)

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.INTEGRATED_EXPERIENCE_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        # Model this test module executing from the candidate checkout. Unknown
        # external roots may return None, but an executing family cannot downgrade.
        with patch.object(sys.modules[__name__], 'INTEGRATED_EXPERIENCE_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)

    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.INTEGRATED_EXPERIENCE_CONTROL_FILES | set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS))
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files) | set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)

    def test_revision_preserves_published_control_candidate_and_snapshot_ancestry(self):
        self.git('checkout', '-q', self.snapshot)
        name = 'tests/e2e/discovery-pass-access.spec.ts'
        self.write(name, 'reviewed source revision\n')
        snapshot = self.commit()
        blob = self.git('rev-parse', snapshot + ':' + name)
        self.git('checkout', '-q', self.control)
        operator = b'independent reviewed revised integrated_experience operator\n'
        self.write('ops/vps/code-release.py', operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed revision tests\n')
        control = self.commit()
        self.git('checkout', '-q', self.candidate)
        self.git('merge', '--no-ff', '--no-commit', control, snapshot)
        candidate = self.commit()
        self.assertEqual(self.git('show', '-s', '--format=%P', candidate).split(),
                         [self.candidate, control, snapshot])
        self.assertEqual(self.git('show', '-s', '--format=%P', control), self.control)
        self.assertEqual(self.git('show', '-s', '--format=%P', snapshot), self.snapshot)
        for ancestor in (self.control, self.candidate, self.snapshot, control, snapshot):
            self.git('merge-base', '--is-ancestor', ancestor, candidate)
        # The old merged operator cannot authorize new operator bytes.
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            release.verify_trusted_operator(candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
             patch.object(release, 'INTEGRATED_EXPERIENCE_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'INTEGRATED_EXPERIENCE_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             patch.dict(release.INTEGRATED_EXPERIENCE_APPLICATION_BLOBS, {name: blob}), \
             patch.object(sys.modules[__name__], 'INTEGRATED_EXPERIENCE_OPERATOR_BLOB', self.blob(operator)):
            self.assertEqual(len(self.files), 38)
            self.assertEqual(set(self.git('diff', '--name-only', self.live, control).splitlines()),
                             release.INTEGRATED_EXPERIENCE_CONTROL_FILES | set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS))
            self.assertEqual(set(self.git('diff', '--name-only', snapshot, candidate).splitlines()),
                             release.INTEGRATED_EXPERIENCE_CONTROL_FILES | {self.workflow})
            self.assertEqual(set(self.git('diff', '--name-only', control, candidate).splitlines()),
                             set(self.files))
            self.assertEqual(set(self.verify()), set(self.files) | release.INTEGRATED_EXPERIENCE_CONTROL_FILES | set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS))
            self.assertEqual(release.migration_plan(self.verify()), [])
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'],
                             self.blob(operator))
            self.git('update-ref', 'refs/remotes/origin/main', self.control)
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'app/events.ts', 'app/api/public/events/route.ts',
                     'app/mobile-navigation.tsx', 'app/my-nights/my-nights-client.tsx',
                     'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *release.INTEGRATED_EXPERIENCE_CONTROL_FILES}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('INTEGRATED_EXPERIENCE_RELEASE_BASE_TREE', 'INTEGRATED_EXPERIENCE_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.INTEGRATED_EXPERIENCE_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.INTEGRATED_EXPERIENCE_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
        for name in release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS:
            with patch.dict(release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()

    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)

    def test_scope_schema_rejects_controls_dependencies_and_forbidden_application_paths(self):
        for controls in ({'ops/vps/code-release.py'},
                         release.INTEGRATED_EXPERIENCE_CONTROL_FILES | {'package-lock.json'}):
            with self.subTest(controls=controls), patch.object(release, 'INTEGRATED_EXPERIENCE_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for dependencies in ({}, {**release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS, 'other.lock': 'f' * 40}):
            with self.subTest(dependencies=dependencies), \
                 patch.object(release, 'INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS', dependencies):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for name in ('mobile/package.json', '.github/workflows/new.yml',
                     'runtime/vps/package.json', 'drizzle/9999_extra.sql', 'ops/vps/code-release.py'):
            with self.subTest(path=name), \
                 patch.dict(release.INTEGRATED_EXPERIENCE_APPLICATION_BLOBS, {name: 'f' * 40}), \
                 patch.dict(release.INTEGRATED_EXPERIENCE_APPLICATION_INPUTS, {name: None}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        application = {name: blob for name, blob in self.pins.items() if name != self.files[0]}
        inputs = {name: blob for name, blob in self.inputs.items() if name != self.files[0]}
        with patch.object(release, 'INTEGRATED_EXPERIENCE_APPLICATION_BLOBS', application), \
             patch.object(release, 'INTEGRATED_EXPERIENCE_APPLICATION_INPUTS', inputs):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                self.verify()

    def test_controls_only_baseline_rejects_any_application_dependency_or_workflow_change(self):
        for name in (self.files[0], *release.INTEGRATED_EXPERIENCE_DEPENDENCY_BLOBS,
                     '.github/workflows/candidate-checks.yml'):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.write(name, 'unreviewed control-side change\n')
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'retain exact candidate bytes')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_both_controls_must_change_and_remain_identical_in_promotion(self):
        for name in release.INTEGRATED_EXPERIENCE_CONTROL_FILES:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.git('checkout', self.live, '--', name)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', self.snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_every_output_pin_is_required_independently_of_the_snapshot_tree(self):
        for name in self.files:
            with self.subTest(path=name), \
                 patch.dict(release.INTEGRATED_EXPERIENCE_APPLICATION_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'snapshot output'):
                    self.verify()

    def test_controls_index_edits_cannot_hide_behind_restored_worktree_bytes(self):
        for revision in (self.control, self.candidate):
            for name in release.INTEGRATED_EXPERIENCE_CONTROL_FILES:
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    original = (self.root / name).read_bytes()
                    self.write(name, 'hidden staged control change\n')
                    self.git('add', name)
                    self.write(name, original)
                    with self.assertRaisesRegex(AssertionError, 'index differs'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)

    def test_snapshot_with_matching_tree_but_without_baseline_ancestry_is_rejected(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                            '-m', 'unrelated snapshot with matching bytes')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', snapshot, '-m', 'include unrelated source')
        self.git('checkout', '-q', candidate)
        with patch.object(release, 'INTEGRATED_EXPERIENCE_APP_SNAPSHOT', snapshot):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()

    def test_family_dispatch_uses_integrated_experience_before_historical_recovery_audit(self):
        with patch(__name__ + '.recovery_audit_source_family', side_effect=AssertionError('old family selected')):
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'], self.blob(self.operator))
        with patch.object(release, 'reviewed_recovery_audit_application_blobs',
                          side_effect=AssertionError('old admission selected')):
            self.assertEqual(set(self.verify()), set(self.files) | release.INTEGRATED_EXPERIENCE_CONTROL_FILES | set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS))


    def test_executing_integrated_experience_tests_cannot_fall_back_to_an_older_operator_family(self):
        self.git('checkout', '-q', self.control)
        self.write('ops/vps/code-release.py', 'historical operator bytes\n')
        self.git('add', 'ops/vps/code-release.py')
        with patch.object(sys.modules[__name__], 'INTEGRATED_EXPERIENCE_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             patch(__name__ + '.recovery_audit_source_family', return_value={'old': 'accepted'}) as old_family:
            with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                checkout_source_family(self.root)
            old_family.assert_not_called()


    def test_staged_deletions_restored_as_untracked_exact_files_are_rejected(self):
        for revision in (self.control, self.candidate):
            for name in (self.files[0], *release.INTEGRATED_EXPERIENCE_CONTROL_FILES):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    self.git('rm', '--cached', name)
                    with self.assertRaisesRegex(AssertionError, 'full inventory'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_normal_main_merge_accepts_original_control_ancestor(self):
        merged = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                          '-p', self.live, '-p', self.control, '-m', 'normal merge of reviewed controls')
        self.git('update-ref', 'refs/remotes/origin/main', merged)
        self.assertEqual(self.git('show', '-s', '--format=%P', self.control), self.live)
        self.assertEqual(self.git('show', '-s', '--format=%P', merged).split(), [self.live, self.control])
        self.assertEqual(self.git('show', '-s', '--format=%P', self.candidate).split(),
                         [self.control, self.snapshot])
        self.assertEqual(set(self.verify()), set(self.files) | release.INTEGRATED_EXPERIENCE_CONTROL_FILES | set(release.INTEGRATED_EXPERIENCE_PREREQUISITE_BLOBS))
        # The branch commit C is the trust anchor, not a newer same-tree main merge
        # which is deliberately absent from the already-published P ancestry.
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=merged):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_missing_invalid_and_unrelated_same_tree_controls_are_rejected(self):
        for trusted in ('', 'HEAD', 'a' * 12, 'A' * 40, 'f' * 40):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises((release.ReleaseError, subprocess.CalledProcessError)):
                    self.verify()
        unrelated = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                             '-m', 'unrelated same-tree controls')
        self.git('update-ref', 'refs/remotes/origin/main', unrelated)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_same_tree_wrong_baseline_and_source_commit_identities_are_rejected(self):
        wrong_base = self.git('commit-tree', self.git('rev-parse', self.live + '^{tree}'),
                              '-m', 'same-tree wrong live identity')
        with self.assertRaisesRegex(release.ReleaseError, 'live or snapshot tree'):
            release.reviewed_integrated_experience_application_blobs(wrong_base, self.candidate)
        wrong_source = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                                '-p', self.live, '-m', 'same-tree unreviewed source identity')
        impostor = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                           '-p', self.control, '-p', wrong_source, '-m', 'wrong source ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(impostor)


class CameraLooksSourceAdmissionTests(unittest.TestCase):
    """Real Git objects bind the new M/S/C/P family without changing older grants."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', '--local', 'maintenance.autoDetach', 'false')
        self.git('config', '--local', 'gc.autoDetach', 'false')
        self.git('config', 'user.name', 'Camera looks admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.CAMERA_LOOKS_APPLICATION_BLOBS)
        self.added = {name for name, blob in release.CAMERA_LOOKS_APPLICATION_INPUTS.items() if blob is None}
        self.assertEqual(self.added, {'app/room/[slug]/flash-live-preview.tsx'})
        self.assertEqual(len(self.files), 14)
        self.prerequisites = tuple(release.CAMERA_LOOKS_PREREQUISITE_BLOBS)
        for name in (*self.files, *release.CAMERA_LOOKS_CONTROL_FILES):
            if name not in self.added:
                self.write(name, 'baseline ' + name + '\n')
        for name in release.CAMERA_LOOKS_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        package = {'scripts': {'test:repo': 'node --test tests/example.mjs'},
                   'dependencies': {'next': '16.4.1'}, 'devDependencies': {'vitest': '4.1.12'},
                   'overrides': {'fast-uri': '3.1.8', 'undici': '7.29.1', 'zod': '4.6.6'}}
        self.write('package.json', json.dumps(package))
        self.write('package-lock.json', json.dumps({'packages': {
            'node_modules/fast-uri': {'version': '3.1.8'},
            'node_modules/undici': {'version': '7.29.1'}}}))
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.live = self.commit()
        # S may contain several reviewed commits; direct-child ancestry is not assumed.
        self.git('commit', '--allow-empty', '-qm', 'feature preparation')
        for name in self.files:
            self.write(name, 'exact reviewed camera_looks ' + name + '\n')
        package['overrides'].update({'fast-uri': '3.1.9', 'undici': '7.30.1'})
        self.write('package.json', json.dumps(package))
        self.write('package-lock.json', json.dumps({'packages': {
            'node_modules/fast-uri': {'version': '3.1.9'},
            'node_modules/undici': {'version': '7.30.1'}}}))
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.live)
        self.operator = b'independent reviewed camera_looks operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed camera_looks tests\n')
        self.git('checkout', self.snapshot, '--', *self.prerequisites)
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'CAMERA_LOOKS_RELEASE_BASELINE': self.live,
            'CAMERA_LOOKS_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'CAMERA_LOOKS_APP_SNAPSHOT': self.snapshot,
            'CAMERA_LOOKS_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'CAMERA_LOOKS_PREREQUISITE_INPUTS': {name: self.git('rev-parse', self.live + ':' + name)
                                                 for name in self.prerequisites},
            'CAMERA_LOOKS_PREREQUISITE_BLOBS': {name: self.git('rev-parse', self.snapshot + ':' + name)
                                                for name in self.prerequisites},
            'CAMERA_LOOKS_APPLICATION_INPUTS': self.inputs,
            'CAMERA_LOOKS_APPLICATION_BLOBS': self.pins,
            'CAMERA_LOOKS_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                          for name in release.CAMERA_LOOKS_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'CAMERA_LOOKS_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.CAMERA_LOOKS_CONTROL_FILES, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.live + ':' + name)) for name in staged_names}
        self.patch_value(sys.modules[__name__], 'CAMERA_LOOKS_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Camera looks source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.CAMERA_LOOKS_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)

    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | set(self.prerequisites) | release.CAMERA_LOOKS_CONTROL_FILES)
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)

    def test_revision_preserves_published_control_candidate_and_snapshot_ancestry(self):
        self.git('checkout', '-q', self.snapshot)
        name = 'tests/e2e/flash-camera.spec.ts'
        self.write(name, 'reviewed source revision\n')
        snapshot = self.commit()
        blob = self.git('rev-parse', snapshot + ':' + name)
        self.git('checkout', '-q', self.control)
        operator = b'independent reviewed revised camera_looks operator\n'
        self.write('ops/vps/code-release.py', operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed revision tests\n')
        control = self.commit()
        self.git('checkout', '-q', self.candidate)
        self.git('merge', '--no-ff', '--no-commit', control, snapshot)
        candidate = self.commit()
        self.assertEqual(self.git('show', '-s', '--format=%P', candidate).split(),
                         [self.candidate, control, snapshot])
        self.assertEqual(self.git('show', '-s', '--format=%P', control), self.control)
        self.assertEqual(self.git('show', '-s', '--format=%P', snapshot), self.snapshot)
        for ancestor in (self.control, self.candidate, self.snapshot, control, snapshot):
            self.git('merge-base', '--is-ancestor', ancestor, candidate)
        # The old merged operator cannot authorize new operator bytes.
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            release.verify_trusted_operator(candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
             patch.object(release, 'CAMERA_LOOKS_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'CAMERA_LOOKS_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             patch.dict(release.CAMERA_LOOKS_APPLICATION_BLOBS, {name: blob}), \
             patch.object(sys.modules[__name__], 'CAMERA_LOOKS_OPERATOR_BLOB', self.blob(operator)):
            self.assertEqual(len(self.files), 14)
            self.assertEqual(set(self.git('diff', '--name-only', self.live, control).splitlines()),
                             release.CAMERA_LOOKS_CONTROL_FILES | set(self.prerequisites))
            self.assertEqual(set(self.git('diff', '--name-only', snapshot, candidate).splitlines()),
                             release.CAMERA_LOOKS_CONTROL_FILES)
            self.assertEqual(set(self.git('diff', '--name-only', control, candidate).splitlines()),
                             set(self.files))
            self.assertEqual(set(self.verify()), set(self.files) | set(self.prerequisites) | release.CAMERA_LOOKS_CONTROL_FILES)
            self.assertEqual(release.migration_plan(self.verify()), [])
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'],
                             self.blob(operator))
            self.git('update-ref', 'refs/remotes/origin/main', self.control)
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *self.prerequisites,
                     *release.CAMERA_LOOKS_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *self.prerequisites, *release.CAMERA_LOOKS_CONTROL_FILES}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('CAMERA_LOOKS_RELEASE_BASE_TREE', 'CAMERA_LOOKS_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.CAMERA_LOOKS_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.CAMERA_LOOKS_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
        for name in release.CAMERA_LOOKS_DEPENDENCY_BLOBS:
            with patch.dict(release.CAMERA_LOOKS_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()

    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)

    def test_scope_schema_rejects_controls_dependencies_and_forbidden_application_paths(self):
        for controls in ({'ops/vps/code-release.py'},
                         release.CAMERA_LOOKS_CONTROL_FILES | {'package-lock.json'}):
            with self.subTest(controls=controls), patch.object(release, 'CAMERA_LOOKS_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for dependencies in ({}, {**release.CAMERA_LOOKS_DEPENDENCY_BLOBS, 'other.lock': 'f' * 40}):
            with self.subTest(dependencies=dependencies), \
                 patch.object(release, 'CAMERA_LOOKS_DEPENDENCY_BLOBS', dependencies):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for name in ('package-lock.json', 'mobile/package.json', '.github/workflows/new.yml',
                     'runtime/vps/package.json', 'drizzle/9999_extra.sql', 'ops/vps/code-release.py'):
            with self.subTest(path=name), \
                 patch.dict(release.CAMERA_LOOKS_APPLICATION_BLOBS, {name: 'f' * 40}), \
                 patch.dict(release.CAMERA_LOOKS_APPLICATION_INPUTS, {name: None}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        application = {name: blob for name, blob in self.pins.items() if name != self.files[0]}
        inputs = {name: blob for name, blob in self.inputs.items() if name != self.files[0]}
        with patch.object(release, 'CAMERA_LOOKS_APPLICATION_BLOBS', application), \
             patch.object(release, 'CAMERA_LOOKS_APPLICATION_INPUTS', inputs):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                self.verify()

    def test_controls_only_baseline_rejects_any_application_dependency_or_workflow_change(self):
        for name in (self.files[0], *release.CAMERA_LOOKS_DEPENDENCY_BLOBS,
                     '.github/workflows/candidate-checks.yml'):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.write(name, 'unreviewed control-side change\n')
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'retain exact candidate bytes')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_both_controls_must_change_and_remain_identical_in_promotion(self):
        for name in release.CAMERA_LOOKS_CONTROL_FILES:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.git('checkout', self.live, '--', name)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', self.snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_every_output_pin_is_required_independently_of_the_snapshot_tree(self):
        for name in self.files:
            with self.subTest(path=name), \
                 patch.dict(release.CAMERA_LOOKS_APPLICATION_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'snapshot output'):
                    self.verify()

    def test_controls_index_edits_cannot_hide_behind_restored_worktree_bytes(self):
        for revision in (self.control, self.candidate):
            for name in (*release.CAMERA_LOOKS_CONTROL_FILES, *self.prerequisites):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    original = (self.root / name).read_bytes()
                    self.write(name, 'hidden staged control change\n')
                    self.git('add', name)
                    self.write(name, original)
                    with self.assertRaisesRegex(AssertionError, 'index differs'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)

    def test_snapshot_with_matching_tree_but_without_baseline_ancestry_is_rejected(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                            '-m', 'unrelated snapshot with matching bytes')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', snapshot, '-m', 'include unrelated source')
        self.git('checkout', '-q', candidate)
        with patch.object(release, 'CAMERA_LOOKS_APP_SNAPSHOT', snapshot):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()

    def test_family_dispatch_uses_camera_looks_before_historical_integrated_experience(self):
        with patch(__name__ + '.integrated_experience_source_family', side_effect=AssertionError('old family selected')):
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'], self.blob(self.operator))
        with patch.object(release, 'reviewed_integrated_experience_application_blobs',
                          side_effect=AssertionError('old admission selected')):
            self.assertEqual(set(self.verify()), set(self.files) | set(self.prerequisites) | release.CAMERA_LOOKS_CONTROL_FILES)


    def test_executing_camera_looks_tests_cannot_fall_back_to_an_older_operator_family(self):
        self.git('checkout', '-q', self.control)
        self.write('ops/vps/code-release.py', 'historical operator bytes\n')
        self.git('add', 'ops/vps/code-release.py')
        with patch.object(sys.modules[__name__], 'CAMERA_LOOKS_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             patch(__name__ + '.integrated_experience_source_family', return_value={'old': 'accepted'}) as old_family:
            with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                checkout_source_family(self.root)
            old_family.assert_not_called()


    def test_staged_deletions_restored_as_untracked_exact_files_are_rejected(self):
        for revision in (self.control, self.candidate):
            for name in (self.files[0], *self.prerequisites, *release.CAMERA_LOOKS_CONTROL_FILES):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    self.git('rm', '--cached', name)
                    with self.assertRaisesRegex(AssertionError, 'full inventory'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_normal_main_merge_accepts_original_control_ancestor(self):
        merged = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                          '-p', self.live, '-p', self.control, '-m', 'normal merge of reviewed controls')
        self.git('update-ref', 'refs/remotes/origin/main', merged)
        self.assertEqual(self.git('show', '-s', '--format=%P', self.control), self.live)
        self.assertEqual(self.git('show', '-s', '--format=%P', merged).split(), [self.live, self.control])
        self.assertEqual(self.git('show', '-s', '--format=%P', self.candidate).split(),
                         [self.control, self.snapshot])
        self.assertEqual(set(self.verify()), set(self.files) | set(self.prerequisites) | release.CAMERA_LOOKS_CONTROL_FILES)
        # The branch commit C is the trust anchor, not a newer same-tree main merge
        # which is deliberately absent from the already-published P ancestry.
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=merged):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_missing_invalid_and_unrelated_same_tree_controls_are_rejected(self):
        for trusted in ('', 'HEAD', 'a' * 12, 'A' * 40, 'f' * 40):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises((release.ReleaseError, subprocess.CalledProcessError)):
                    self.verify()
        unrelated = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                             '-m', 'unrelated same-tree controls')
        self.git('update-ref', 'refs/remotes/origin/main', unrelated)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_same_tree_wrong_baseline_and_source_commit_identities_are_rejected(self):
        wrong_base = self.git('commit-tree', self.git('rev-parse', self.live + '^{tree}'),
                              '-m', 'same-tree wrong live identity')
        with self.assertRaisesRegex(release.ReleaseError, 'live or snapshot tree'):
            release.reviewed_camera_looks_application_blobs(wrong_base, self.candidate)
        wrong_source = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                                '-p', self.live, '-m', 'same-tree unreviewed source identity')
        impostor = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                           '-p', self.control, '-p', wrong_source, '-m', 'wrong source ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(impostor)


    def test_security_pair_rejects_links_and_hidden_worktree_changes(self):
        for revision in (self.control, self.candidate):
            for name in self.prerequisites:
                for mutation in ('symlink', 'hardlink', 'assume-unchanged'):
                    with self.subTest(revision=revision, path=name, mutation=mutation), \
                         tempfile.TemporaryDirectory() as directory:
                        self.git('checkout', '-q', revision)
                        path = self.root / name
                        raw = path.read_bytes()
                        backup = Path(directory) / 'exact-original'
                        backup.write_bytes(raw)
                        if mutation == 'assume-unchanged':
                            self.git('update-index', '--assume-unchanged', name)
                            path.write_bytes(b'hidden dependency drift\n')
                        else:
                            path.unlink()
                            if mutation == 'symlink': path.symlink_to(backup)
                            else: os.link(backup, path)
                        with self.assertRaises(AssertionError): checkout_source_family(self.root)
                        path.unlink()
                        self.write(name, raw)
                        self.git('update-index', '--no-assume-unchanged', name)


    def test_security_prerequisite_input_output_and_scope_pins_are_required(self):
        for name in self.prerequisites:
            with self.subTest(path=name, pin='input'), \
                 patch.dict(release.CAMERA_LOOKS_PREREQUISITE_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'prerequisite input'):
                    self.verify()
            with self.subTest(path=name, pin='output'), \
                 patch.dict(release.CAMERA_LOOKS_PREREQUISITE_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'snapshot output'):
                    self.verify()
        for name in ('CAMERA_LOOKS_PREREQUISITE_INPUTS', 'CAMERA_LOOKS_PREREQUISITE_BLOBS'):
            for pins in ({}, {'package.json': 'f' * 40},
                         {**getattr(release, name), 'other.lock': 'f' * 40}):
                with self.subTest(pin=name, paths=tuple(pins)), patch.object(release, name, pins):
                    with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                        self.verify()

    def test_security_pair_cannot_be_missing_mixed_or_modified_in_control_or_promotion(self):
        for revision in (self.control, self.candidate):
            for name in self.prerequisites:
                for mutation in ('old-version', 'missing', 'bytes', 'mode'):
                    with self.subTest(revision=revision, path=name, mutation=mutation):
                        self.git('checkout', '-q', revision)
                        if mutation == 'old-version': self.git('checkout', self.live, '--', name)
                        elif mutation == 'missing': self.git('rm', name)
                        elif mutation == 'bytes': self.write(name, 'unreviewed security bytes\n')
                        else: (self.root / name).chmod(0o755)
                        changed = self.commit()
                        if revision == self.control:
                            candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                                 '-p', self.candidate, '-p', changed, '-m', 'include changed control')
                            self.git('checkout', '-q', candidate)
                            self.git('update-ref', 'refs/remotes/origin/main', changed)
                        else:
                            candidate = changed
                        with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed if revision == self.control else self.control):
                            with self.assertRaises(release.ReleaseError): self.verify(candidate)
                        self.git('checkout', '-q', changed)
                        with self.assertRaises(AssertionError): checkout_source_family(self.root)
                        self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_security_lock_graph_metadata_drift_is_rejected(self):
        for revision in (self.control, self.candidate):
            for field in ('version', 'resolved', 'integrity', 'dependencies'):
                with self.subTest(revision=revision, field=field):
                    self.git('checkout', '-q', revision)
                    lock = json.loads((self.root / 'package-lock.json').read_text())
                    lock['packages']['node_modules/fast-uri'][field] = {'unexpected': '1.0.0'} if field == 'dependencies' else 'unreviewed'
                    self.write('package-lock.json', json.dumps(lock))
                    changed = self.commit()
                    with self.assertRaises(AssertionError): checkout_source_family(self.root)
                    if revision == self.control:
                        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                             '-p', self.candidate, '-p', changed, '-m', 'include changed graph')
                        self.git('checkout', '-q', candidate)
                        self.git('update-ref', 'refs/remotes/origin/main', changed)
                    with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed if revision == self.control else self.control):
                        with self.assertRaises(release.ReleaseError): self.verify()
                    self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_security_package_cannot_repin_scripts_dependencies_or_other_overrides(self):
        for section, key, value in (('scripts', 'test:repo', 'skip tests'),
                                    ('dependencies', 'next', '99.0.0'),
                                    ('devDependencies', 'vitest', '99.0.0'),
                                    ('overrides', 'zod', '99.0.0'),
                                    ('overrides', 'fast-uri', '3.1.10'),
                                    ('overrides', 'undici', '7.30.2'),
                                    ('overrides', 'fast-uri', None)):
            with self.subTest(section=section, key=key):
                self.git('checkout', '-q', self.snapshot)
                package = json.loads((self.root / 'package.json').read_text())
                if value is None: package[section].pop(key)
                else: package[section][key] = value
                raw = json.dumps(package)
                self.write('package.json', raw)
                snapshot = self.commit()
                self.git('checkout', '-q', self.control)
                self.write('package.json', raw)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
                     patch.object(release, 'CAMERA_LOOKS_APP_SNAPSHOT', snapshot), \
                     patch.object(release, 'CAMERA_LOOKS_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                     patch.dict(release.CAMERA_LOOKS_PREREQUISITE_BLOBS, {'package.json': self.blob(raw.encode())}):
                    with self.assertRaisesRegex(release.ReleaseError, 'exact fast-uri and undici security patch'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)




class RoomMailFocusSourceAdmissionTests(unittest.TestCase):
    """Real Git binds exact main prerequisites, independent controls and application source."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', '--local', 'maintenance.autoDetach', 'false')
        self.git('config', '--local', 'gc.autoDetach', 'false')
        self.git('config', 'user.name', 'Room mail focus admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.prerequisites = tuple(release.ROOM_MAIL_FOCUS_PREREQUISITE_BLOBS)
        self.files = tuple(release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS)
        self.added = {name for name, blob in release.ROOM_MAIL_FOCUS_APPLICATION_INPUTS.items() if blob is None}
        self.assertEqual(self.added, {'.github/workflows/input-modality-checks.yml',
 'app/input-modality.tsx',
 'lib/input-modality.ts',
 'playwright.input-modality.config.ts',
 'styles/input-modality.css',
 'tests/e2e/input-modality.spec.ts',
 'tests/input-modality.test.mjs'})
        self.assertEqual(len(self.files), 16)
        self.assertEqual(len(self.prerequisites), 4)
        for name in (*self.files, *release.ROOM_MAIL_FOCUS_CONTROL_FILES):
            if name not in self.added:
                self.write(name, 'baseline ' + name + '\n')
        for name in release.ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        package = {'scripts': {'test:ui': 'node --test tests/mobile-ui.test.mjs'},
                   'dependencies': {'next': '16.4.1'}, 'devDependencies': {'vitest': '4.1.12'},
                   'overrides': {'fast-uri': '3.1.9', 'undici': '7.30.1', 'zod': '4.6.6'}}
        self.write('package.json', json.dumps(package))
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/tickets-code-release.yml', 'unchanged release workflow\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.write('worker/handover.ts', 'unchanged handover configuration names\n')
        self.live = self.commit()
        for name in self.prerequisites:
            self.write(name, 'exact reviewed operational prerequisite ' + name + '\n')
        self.prerequisite = self.commit()
        # Source and controls both retain the existing normal-main prerequisite.
        self.git('commit', '--allow-empty', '-qm', 'feature preparation')
        for name in self.files:
            self.write(name, 'exact reviewed room mail focus ' + name + '\n')
        package['scripts']['test:ui'] = package['scripts']['test:ui'].replace(
            'node --test ', 'node --test tests/input-modality.test.mjs ', 1)
        self.write('package.json', json.dumps(package))
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.prerequisite)
        self.operator = b'independent reviewed room_mail_focus operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed room_mail_focus tests\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'ROOM_MAIL_FOCUS_RELEASE_BASELINE': self.live,
            'ROOM_MAIL_FOCUS_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'ROOM_MAIL_FOCUS_PREREQUISITE_SNAPSHOT': self.prerequisite,
            'ROOM_MAIL_FOCUS_PREREQUISITE_TREE': self.git('rev-parse', self.prerequisite + '^{tree}'),
            'ROOM_MAIL_FOCUS_APP_SNAPSHOT': self.snapshot,
            'ROOM_MAIL_FOCUS_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'ROOM_MAIL_FOCUS_PREREQUISITE_INPUTS': {name: None for name in self.prerequisites},
            'ROOM_MAIL_FOCUS_PREREQUISITE_BLOBS': {name: self.git('rev-parse', self.prerequisite + ':' + name)
                                                for name in self.prerequisites},
            'ROOM_MAIL_FOCUS_APPLICATION_INPUTS': self.inputs,
            'ROOM_MAIL_FOCUS_APPLICATION_BLOBS': self.pins,
            'ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                              for name in release.ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'ROOM_MAIL_FOCUS_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.ROOM_MAIL_FOCUS_CONTROL_FILES,
                        *(name for name in self.prerequisites if name.startswith('ops/vps/')),
                        'ops/vps/audit.py', '.github/workflows/tickets-code-release.yml',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.control + ':' + name)) for name in staged_names}
        self.patch_value(sys.modules[__name__], 'ROOM_MAIL_FOCUS_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)


    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)


    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()


    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path


    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Room/mail focus source')
        return self.git('rev-parse', 'HEAD')


    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))


    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)


    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.ROOM_MAIL_FOCUS_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with patch.object(sys.modules[__name__], 'ROOM_MAIL_FOCUS_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             self.assertRaises(AssertionError):
            checkout_source_family(self.root)


    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()


    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)


    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)


    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)


    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.ROOM_MAIL_FOCUS_CONTROL_FILES | set(self.prerequisites))
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))


    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)


    def test_revision_preserves_published_control_candidate_and_snapshot_ancestry(self):
        self.git('checkout', '-q', self.snapshot)
        name = 'tests/room-host-first-post.test.ts'
        self.write(name, 'reviewed source revision\n')
        snapshot = self.commit()
        blob = self.git('rev-parse', snapshot + ':' + name)
        self.git('checkout', '-q', self.control)
        operator = b'independent reviewed revised room_mail_focus operator\n'
        self.write('ops/vps/code-release.py', operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed revision tests\n')
        control = self.commit()
        self.git('checkout', '-q', self.candidate)
        self.git('merge', '--no-ff', '--no-commit', control, snapshot)
        candidate = self.commit()
        self.assertEqual(self.git('show', '-s', '--format=%P', candidate).split(),
                         [self.candidate, control, snapshot])
        self.assertEqual(self.git('show', '-s', '--format=%P', control), self.control)
        self.assertEqual(self.git('show', '-s', '--format=%P', snapshot), self.snapshot)
        for ancestor in (self.control, self.candidate, self.snapshot, control, snapshot):
            self.git('merge-base', '--is-ancestor', ancestor, candidate)
        # The old merged operator cannot authorize new operator bytes.
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            release.verify_trusted_operator(candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
             patch.object(release, 'ROOM_MAIL_FOCUS_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'ROOM_MAIL_FOCUS_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             patch.dict(release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS, {name: blob}), \
             patch.object(sys.modules[__name__], 'ROOM_MAIL_FOCUS_OPERATOR_BLOB', self.blob(operator)):
            self.assertEqual(len(self.files), 16)
            self.assertEqual(set(self.git('diff', '--name-only', self.live, control).splitlines()),
                             release.ROOM_MAIL_FOCUS_CONTROL_FILES | set(self.prerequisites))
            self.assertEqual(set(self.git('diff', '--name-only', snapshot, candidate).splitlines()),
                             release.ROOM_MAIL_FOCUS_CONTROL_FILES)
            self.assertEqual(set(self.git('diff', '--name-only', control, candidate).splitlines()),
                             set(self.files))
            self.assertEqual(set(self.verify()), set(self.files) | release.ROOM_MAIL_FOCUS_CONTROL_FILES | set(self.prerequisites))
            self.assertEqual(release.migration_plan(self.verify()), [])
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'],
                             self.blob(operator))
            self.git('update-ref', 'refs/remotes/origin/main', self.control)
            with self.assertRaises(subprocess.CalledProcessError): self.verify()


    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *self.prerequisites,
                     *release.ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)


    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *self.prerequisites, *release.ROOM_MAIL_FOCUS_CONTROL_FILES}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)


    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('ROOM_MAIL_FOCUS_RELEASE_BASE_TREE', 'ROOM_MAIL_FOCUS_APP_TREE', 'ROOM_MAIL_FOCUS_PREREQUISITE_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.ROOM_MAIL_FOCUS_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
        for name in release.ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS:
            with patch.dict(release.ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()


    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.prerequisite, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)


    def test_scope_schema_rejects_controls_dependencies_and_forbidden_application_paths(self):
        for controls in ({'ops/vps/code-release.py'},
                         release.ROOM_MAIL_FOCUS_CONTROL_FILES | {'package-lock.json'}):
            with self.subTest(controls=controls), patch.object(release, 'ROOM_MAIL_FOCUS_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for dependencies in ({}, {**release.ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS, 'other.lock': 'f' * 40}):
            with self.subTest(dependencies=dependencies), \
                 patch.object(release, 'ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS', dependencies):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for name in ('package-lock.json', 'mobile/package.json', '.github/workflows/new.yml',
                     'runtime/vps/package.json', 'drizzle/9999_extra.sql', 'ops/vps/code-release.py'):
            with self.subTest(path=name), \
                 patch.dict(release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS, {name: 'f' * 40}), \
                 patch.dict(release.ROOM_MAIL_FOCUS_APPLICATION_INPUTS, {name: None}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        application = {name: blob for name, blob in self.pins.items() if name != self.files[0]}
        inputs = {name: blob for name, blob in self.inputs.items() if name != self.files[0]}
        with patch.object(release, 'ROOM_MAIL_FOCUS_APPLICATION_BLOBS', application), \
             patch.object(release, 'ROOM_MAIL_FOCUS_APPLICATION_INPUTS', inputs):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                self.verify()


    def test_controls_only_baseline_rejects_any_application_dependency_or_workflow_change(self):
        for name in (self.files[0], *release.ROOM_MAIL_FOCUS_DEPENDENCY_BLOBS,
                     '.github/workflows/candidate-checks.yml'):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.write(name, 'unreviewed control-side change\n')
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'retain exact candidate bytes')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)


    def test_both_controls_must_change_and_remain_identical_in_promotion(self):
        for name in release.ROOM_MAIL_FOCUS_CONTROL_FILES:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.git('checkout', self.live, '--', name)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', self.snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)


    def test_every_output_pin_is_required_independently_of_the_snapshot_tree(self):
        for name in self.files:
            with self.subTest(path=name), \
                 patch.dict(release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'snapshot output'):
                    self.verify()


    def test_controls_index_edits_cannot_hide_behind_restored_worktree_bytes(self):
        for revision in (self.control, self.candidate):
            for name in (*release.ROOM_MAIL_FOCUS_CONTROL_FILES, *self.prerequisites):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    original = (self.root / name).read_bytes()
                    self.write(name, 'hidden staged control change\n')
                    self.git('add', name)
                    self.write(name, original)
                    with self.assertRaisesRegex(AssertionError, 'index differs'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_snapshot_with_matching_tree_but_without_baseline_ancestry_is_rejected(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                            '-m', 'unrelated snapshot with matching bytes')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', snapshot, '-m', 'include unrelated source')
        self.git('checkout', '-q', candidate)
        with patch.object(release, 'ROOM_MAIL_FOCUS_APP_SNAPSHOT', snapshot):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()


    def test_family_dispatch_uses_room_mail_focus_before_historical_first_host(self):
        with patch(__name__ + '.first_host_source_family', side_effect=AssertionError('old family selected')):
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'], self.blob(self.operator))
        with patch.object(release, 'reviewed_first_host_application_blobs',
                          side_effect=AssertionError('old admission selected')):
            self.assertEqual(set(self.verify()), set(self.files) | release.ROOM_MAIL_FOCUS_CONTROL_FILES | set(self.prerequisites))


    def test_executing_room_mail_focus_tests_cannot_fall_back_to_an_older_operator_family(self):
        self.git('checkout', '-q', self.control)
        self.write('ops/vps/code-release.py', 'historical operator bytes\n')
        self.git('add', 'ops/vps/code-release.py')
        with patch.object(sys.modules[__name__], 'ROOM_MAIL_FOCUS_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             patch(__name__ + '.first_host_source_family', return_value={'old': 'accepted'}) as old_family:
            with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                checkout_source_family(self.root)
            old_family.assert_not_called()


    def test_staged_deletions_restored_as_untracked_exact_files_are_rejected(self):
        existing_application = next(name for name in self.files if name not in self.added)
        for revision in (self.control, self.candidate):
            for name in (existing_application, *release.ROOM_MAIL_FOCUS_CONTROL_FILES):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    self.git('rm', '--cached', name)
                    with self.assertRaisesRegex(AssertionError, 'full inventory'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_normal_main_merge_accepts_original_control_ancestor(self):
        merged = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                          '-p', self.prerequisite, '-p', self.control, '-m', 'normal merge of reviewed controls')
        self.git('update-ref', 'refs/remotes/origin/main', merged)
        self.assertEqual(self.git('show', '-s', '--format=%P', self.control), self.prerequisite)
        self.assertEqual(self.git('show', '-s', '--format=%P', merged).split(), [self.prerequisite, self.control])
        self.assertEqual(self.git('show', '-s', '--format=%P', self.candidate).split(),
                         [self.control, self.snapshot])
        self.assertEqual(set(self.verify()), set(self.files) | release.ROOM_MAIL_FOCUS_CONTROL_FILES | set(self.prerequisites))
        # The branch commit C is the trust anchor, not a newer same-tree main merge
        # which is deliberately absent from the already-published P ancestry.
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=merged):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()


    def test_missing_invalid_and_unrelated_same_tree_controls_are_rejected(self):
        for trusted in ('', 'HEAD', 'a' * 12, 'A' * 40, 'f' * 40):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises((release.ReleaseError, subprocess.CalledProcessError)):
                    self.verify()
        unrelated = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                             '-m', 'unrelated same-tree controls')
        self.git('update-ref', 'refs/remotes/origin/main', unrelated)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()


    def test_same_tree_wrong_baseline_and_source_commit_identities_are_rejected(self):
        wrong_base = self.git('commit-tree', self.git('rev-parse', self.live + '^{tree}'),
                              '-m', 'same-tree wrong live identity')
        with self.assertRaisesRegex(release.ReleaseError, 'live or snapshot tree'):
            release.reviewed_room_mail_focus_application_blobs(wrong_base, self.candidate)
        wrong_source = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                                '-p', self.live, '-m', 'same-tree unreviewed source identity')
        impostor = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                           '-p', self.control, '-p', wrong_source, '-m', 'wrong source ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(impostor)


    def test_package_cannot_repin_other_scripts_dependencies_or_overrides(self):
        for section, key, value in (('scripts', 'test:ui', 'skip tests'),
                                    ('scripts', 'build', 'skip build'),
                                    ('dependencies', 'next', '99.0.0'),
                                    ('devDependencies', 'vitest', '99.0.0'),
                                    ('overrides', 'undici', '99.0.0')):
            with self.subTest(section=section, key=key):
                self.git('checkout', '-q', self.snapshot)
                package = json.loads((self.root / 'package.json').read_text())
                package[section][key] = value
                raw = json.dumps(package)
                self.write('package.json', raw)
                snapshot = self.commit()
                self.git('checkout', '-q', self.control)
                self.git('merge', '--no-ff', '--no-commit', snapshot)
                candidate = self.commit()
                with patch.object(release, 'ROOM_MAIL_FOCUS_APP_SNAPSHOT', snapshot), \
                     patch.object(release, 'ROOM_MAIL_FOCUS_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                     patch.dict(release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS, {'package.json': self.blob(raw.encode())}):
                    with self.assertRaisesRegex(release.ReleaseError, 'exact input-modality test registration'):
                        self.verify(candidate)


    def test_operational_prerequisite_scope_input_and_output_are_exact(self):
        for field in ('ROOM_MAIL_FOCUS_PREREQUISITE_INPUTS', 'ROOM_MAIL_FOCUS_PREREQUISITE_BLOBS'):
            for values in ({}, {'.github/workflows/other.yml': 'f' * 40}):
                with self.subTest(field=field, values=values), patch.object(release, field, values):
                    with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
            with patch.dict(getattr(release, field), {self.prerequisites[0]: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'prerequisite'): self.verify()



    def test_each_operational_prerequisite_rejects_missing_drift_mode_and_partial_control(self):
        for revision in (self.control, self.candidate):
            for name in self.prerequisites:
                for mutation in ('bytes', 'missing', 'mode'):
                    with self.subTest(revision=revision, path=name, mutation=mutation):
                        self.git('checkout', '-q', revision)
                        if mutation == 'bytes': self.write(name, 'unreviewed operational bytes\n')
                        elif mutation == 'missing': self.git('rm', name)
                        else: (self.root / name).chmod(0o755)
                        changed = self.commit()
                        with self.assertRaises(AssertionError): checkout_source_family(self.root)
                        if revision == self.control:
                            candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                                 '-p', self.candidate, '-p', changed, '-m', 'unreviewed operational controls')
                            self.git('checkout', '-q', candidate)
                            self.git('update-ref', 'refs/remotes/origin/main', changed)
                        with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed if revision == self.control else self.control):
                            with self.assertRaises(release.ReleaseError): self.verify()
                        self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_same_tree_prerequisite_without_reviewed_identity_or_ancestry_is_rejected(self):
        unrelated = self.git('commit-tree', self.git('rev-parse', self.prerequisite + '^{tree}'),
                             '-p', self.live, '-m', 'unreviewed same-tree operational identity')
        with patch.object(release, 'ROOM_MAIL_FOCUS_PREREQUISITE_SNAPSHOT', unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()
        control = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                           '-p', self.live, '-m', 'copied controls without operational ancestry')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', control, '-p', self.snapshot, '-m', 'source ancestry cannot authorize copied controls')
        self.git('checkout', '-q', candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_release_workflow_activation_and_handover_names_remain_frozen(self):
        for name in ('.github/workflows/tickets-code-release.yml', 'worker/handover.ts',
                     'db/schema.ts', 'drizzle/0068_room_host_first_posts.sql',
                     'drizzle/0069_event_host_pass_invitations.sql'):
            self.git('checkout', '-q', self.candidate)
            self.write(name, 'unreviewed activation or schema change\n')
            self.commit()
            with self.assertRaises(release.ReleaseError): self.verify()
            with self.assertRaises(AssertionError): checkout_source_family(self.root)






class RoomMailFocusDeploymentTests(DeploymentFixture):
    def setUp(self):
        super().setUp()
        baseline = patch.object(release, 'ROOM_MAIL_FOCUS_RELEASE_BASELINE', OLD)
        baseline.start()
        self.addCleanup(baseline.stop)
        self.proof['changedFiles'] = sorted(set(release.ROOM_MAIL_FOCUS_APPLICATION_BLOBS)
            | release.ROOM_MAIL_FOCUS_CONTROL_FILES | set(release.ROOM_MAIL_FOCUS_PREREQUISITE_BLOBS))
        self.refresh_digests()
        self.deployment = self.new_deployment()

    def test_code_only_preserves_active_private_configuration_exactly(self):
        raw = self.config_before.rstrip()[:-1] + b', "ROOM_HOST_FIRST_POST_ENABLED" : "1", "ROOM_HOST_FIRST_POST_EVENT_SLUG":"puro-exceso-20261024", "ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID":"11111111-1111-4111-8111-111111111111"}\n'
        release.atomic_write(self.deployment.config, raw)
        # The existing active journal binds the current private runtime bytes.
        journal = json.loads(self.deployment.journal.read_bytes())
        journal['configurationHash'] = release.hashlib.sha256(raw).hexdigest()
        release.write_json(self.deployment.journal, journal)
        with patch.object(release, 'verify_first_host_target', side_effect=AssertionError('activation target read')):
            result = self.deployment.transact()
        self.assertEqual(self.deployment.config.read_bytes(), raw)
        self.assertEqual((self.deployment.snapshot / 'config.before').read_bytes(), raw)
        self.assertNotIn('firstHostEnabledRequested', result)
        self.assertFalse(result['cryptoEnabledRequested'])
        self.assertEqual(self.deployment.migrations, [])

    def test_activation_or_crypto_request_is_rejected_before_mutation(self):
        for flags in ({'enable_crypto': True}, {'enable_first_host': True,
                      'first_host_account_id': '11111111-1111-4111-8111-111111111111'}):
            with self.subTest(flags=tuple(flags)):
                deployment = self.new_deployment(**flags)
                with self.assertRaisesRegex(release.ReleaseError, 'code-only'):
                    deployment.preflight()
                self.assertEqual(deployment.config.read_bytes(), self.config_before)
                self.assertFalse(deployment.snapshot.exists())
                self.assertEqual(self.system.restarts, 0)

    def test_failed_code_only_release_restores_exact_configuration(self):
        self.system.fail = 'public'
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)
        self.assertEqual(self.deployment.migrations, [])


class FirstHostSourceAdmissionTests(unittest.TestCase):
    """Real Git objects bind the new M/S/C/P family without changing older grants."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', '--local', 'maintenance.autoDetach', 'false')
        self.git('config', '--local', 'gc.autoDetach', 'false')
        self.git('config', 'user.name', 'First host admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.prerequisites = tuple(release.FIRST_HOST_PREREQUISITE_BLOBS)
        self.files = tuple(release.FIRST_HOST_APPLICATION_BLOBS)
        self.added = {name for name, blob in release.FIRST_HOST_APPLICATION_INPUTS.items() if blob is None}
        self.assertEqual(self.added, {'tests/event-host-pass.test.ts', 'tests/room-host-first-post.test.ts', 'tests/room-host-email.test.mjs', 'tests/room-host-review.test.ts', 'lib/room-host-email.ts', 'lib/ticket-access-redirect.ts', 'tests/room-host-handover.test.mjs', 'tests/event-host-pass-handover.test.mjs', 'tests/room-host-push-fence.test.ts', 'lib/room-host-first-post.ts', 'app/admin/accounts/event-host-pass.tsx', 'lib/event-host-pass-email.ts', 'scripts/event-host-pass-preview.mjs', 'app/api/customer/host-pass/claim/route.ts', 'drizzle/0068_room_host_first_posts.sql', 'lib/event-host-pass.ts', 'app/api/admin/host-pass/route.ts', 'drizzle/0069_event_host_pass_invitations.sql', 'tests/e2e/event-host-pass-claim.spec.ts'})
        self.assertEqual(len(self.files), 46)
        for name in (*self.files, *release.FIRST_HOST_CONTROL_FILES):
            if name not in self.added:
                self.write(name, 'baseline ' + name + '\n')
        for name in release.FIRST_HOST_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        package = {'scripts': {'test:repo': 'node --test tests/customer-email-rendering.test.mjs'},
                   'dependencies': {'next': '16.4.1'}, 'devDependencies': {'vitest': '4.1.12'},
                   'overrides': {'fast-uri': '3.1.9', 'undici': '7.30.1', 'zod': '4.6.6'}}
        self.write('package.json', json.dumps(package))
        self.write('package-lock.json', json.dumps({'packages': {
            'node_modules/fast-uri': {'version': '3.1.9'},
            'node_modules/undici': {'version': '7.30.1'}}}))
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/tickets-code-release.yml', 'baseline release workflow\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        handover = "export const configurationNames = [\n  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',\n];\n"
        self.write('worker/handover.ts', handover)
        self.live = self.commit()
        # S may contain several reviewed commits; direct-child ancestry is not assumed.
        self.git('commit', '--allow-empty', '-qm', 'feature preparation')
        for name in self.files:
            self.write(name, 'exact reviewed first_host ' + name + '\n')
        package['scripts']['test:repo'] += ' tests/room-host-email.test.mjs tests/room-host-handover.test.mjs tests/event-host-pass-handover.test.mjs'
        self.write('package.json', json.dumps(package))
        self.write('drizzle/0068_room_host_first_posts.sql', FirstHostMigrationTests.SQL)
        self.write('drizzle/0069_event_host_pass_invitations.sql', EventHostPassMigrationTests.SQL)
        self.write('worker/handover.ts', handover.replace("\n];", "\n  'ROOM_HOST_FIRST_POST_ENABLED', 'ROOM_HOST_FIRST_POST_EVENT_SLUG', 'ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID',\n];"))
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.live)
        self.operator = b'independent reviewed first_host operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed first_host tests\n')
        self.write('.github/workflows/tickets-code-release.yml', 'exact reviewed activation input workflow\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'FIRST_HOST_RELEASE_BASELINE': self.live,
            'FIRST_HOST_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'FIRST_HOST_APP_SNAPSHOT': self.snapshot,
            'FIRST_HOST_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'FIRST_HOST_PREREQUISITE_INPUTS': {name: self.git('rev-parse', self.live + ':' + name) for name in self.prerequisites},
            'FIRST_HOST_PREREQUISITE_BLOBS': {name: self.git('rev-parse', self.control + ':' + name) for name in self.prerequisites},
            'FIRST_HOST_APPLICATION_INPUTS': self.inputs,
            'FIRST_HOST_APPLICATION_BLOBS': self.pins,
            'FIRST_HOST_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                          for name in release.FIRST_HOST_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'FIRST_HOST_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.FIRST_HOST_CONTROL_FILES, *self.prerequisites, 'ops/vps/audit.py',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.control + ':' + name)) for name in staged_names}
        self.patch_value(sys.modules[__name__], 'FIRST_HOST_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)

    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()

    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated First host source')
        return self.git('rev-parse', 'HEAD')

    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)

    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.FIRST_HOST_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)

    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()

    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)

    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)

    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)

    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.FIRST_HOST_CONTROL_FILES | set(self.prerequisites))
        self.assertEqual(release.migration_plan(self.verify()), release.migration_plan([FirstHostMigrationTests.PATH, EventHostPassMigrationTests.PATH]))
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))

    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)

    def test_revision_preserves_published_control_candidate_and_snapshot_ancestry(self):
        self.git('checkout', '-q', self.snapshot)
        name = 'tests/room-host-first-post.test.ts'
        self.write(name, 'reviewed source revision\n')
        snapshot = self.commit()
        blob = self.git('rev-parse', snapshot + ':' + name)
        self.git('checkout', '-q', self.control)
        operator = b'independent reviewed revised first_host operator\n'
        self.write('ops/vps/code-release.py', operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed revision tests\n')
        control = self.commit()
        self.git('checkout', '-q', self.candidate)
        self.git('merge', '--no-ff', '--no-commit', control, snapshot)
        candidate = self.commit()
        self.assertEqual(self.git('show', '-s', '--format=%P', candidate).split(),
                         [self.candidate, control, snapshot])
        self.assertEqual(self.git('show', '-s', '--format=%P', control), self.control)
        self.assertEqual(self.git('show', '-s', '--format=%P', snapshot), self.snapshot)
        for ancestor in (self.control, self.candidate, self.snapshot, control, snapshot):
            self.git('merge-base', '--is-ancestor', ancestor, candidate)
        # The old merged operator cannot authorize new operator bytes.
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            release.verify_trusted_operator(candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control), \
             patch.object(release, 'FIRST_HOST_APP_SNAPSHOT', snapshot), \
             patch.object(release, 'FIRST_HOST_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
             patch.dict(release.FIRST_HOST_APPLICATION_BLOBS, {name: blob}), \
             patch.object(sys.modules[__name__], 'FIRST_HOST_OPERATOR_BLOB', self.blob(operator)):
            self.assertEqual(len(self.files), 46)
            self.assertEqual(set(self.git('diff', '--name-only', self.live, control).splitlines()),
                             release.FIRST_HOST_CONTROL_FILES | set(self.prerequisites))
            self.assertEqual(set(self.git('diff', '--name-only', snapshot, candidate).splitlines()),
                             release.FIRST_HOST_CONTROL_FILES | set(self.prerequisites))
            self.assertEqual(set(self.git('diff', '--name-only', control, candidate).splitlines()),
                             set(self.files))
            self.assertEqual(set(self.verify()), set(self.files) | release.FIRST_HOST_CONTROL_FILES | set(self.prerequisites))
            self.assertEqual(release.migration_plan(self.verify()), release.migration_plan([FirstHostMigrationTests.PATH, EventHostPassMigrationTests.PATH]))
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'],
                             self.blob(operator))
            self.git('update-ref', 'refs/remotes/origin/main', self.control)
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *self.prerequisites,
                     *release.FIRST_HOST_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *self.prerequisites, *release.FIRST_HOST_CONTROL_FILES}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)

    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('FIRST_HOST_RELEASE_BASE_TREE', 'FIRST_HOST_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.FIRST_HOST_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.FIRST_HOST_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
        for name in release.FIRST_HOST_DEPENDENCY_BLOBS:
            with patch.dict(release.FIRST_HOST_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()

    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)

    def test_scope_schema_rejects_controls_dependencies_and_forbidden_application_paths(self):
        for controls in ({'ops/vps/code-release.py'},
                         release.FIRST_HOST_CONTROL_FILES | {'package-lock.json'}):
            with self.subTest(controls=controls), patch.object(release, 'FIRST_HOST_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for dependencies in ({}, {**release.FIRST_HOST_DEPENDENCY_BLOBS, 'other.lock': 'f' * 40}):
            with self.subTest(dependencies=dependencies), \
                 patch.object(release, 'FIRST_HOST_DEPENDENCY_BLOBS', dependencies):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for name in ('package-lock.json', 'mobile/package.json', '.github/workflows/new.yml',
                     'runtime/vps/package.json', 'drizzle/9999_extra.sql', 'ops/vps/code-release.py'):
            with self.subTest(path=name), \
                 patch.dict(release.FIRST_HOST_APPLICATION_BLOBS, {name: 'f' * 40}), \
                 patch.dict(release.FIRST_HOST_APPLICATION_INPUTS, {name: None}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        application = {name: blob for name, blob in self.pins.items() if name != self.files[0]}
        inputs = {name: blob for name, blob in self.inputs.items() if name != self.files[0]}
        with patch.object(release, 'FIRST_HOST_APPLICATION_BLOBS', application), \
             patch.object(release, 'FIRST_HOST_APPLICATION_INPUTS', inputs):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                self.verify()

    def test_controls_only_baseline_rejects_any_application_dependency_or_workflow_change(self):
        for name in (self.files[0], *release.FIRST_HOST_DEPENDENCY_BLOBS,
                     '.github/workflows/candidate-checks.yml'):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.write(name, 'unreviewed control-side change\n')
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'retain exact candidate bytes')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_both_controls_must_change_and_remain_identical_in_promotion(self):
        for name in release.FIRST_HOST_CONTROL_FILES:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.git('checkout', self.live, '--', name)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', self.snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)

    def test_every_output_pin_is_required_independently_of_the_snapshot_tree(self):
        for name in self.files:
            with self.subTest(path=name), \
                 patch.dict(release.FIRST_HOST_APPLICATION_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'snapshot output'):
                    self.verify()

    def test_controls_index_edits_cannot_hide_behind_restored_worktree_bytes(self):
        for revision in (self.control, self.candidate):
            for name in (*release.FIRST_HOST_CONTROL_FILES, *self.prerequisites):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    original = (self.root / name).read_bytes()
                    self.write(name, 'hidden staged control change\n')
                    self.git('add', name)
                    self.write(name, original)
                    with self.assertRaisesRegex(AssertionError, 'index differs'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)

    def test_snapshot_with_matching_tree_but_without_baseline_ancestry_is_rejected(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                            '-m', 'unrelated snapshot with matching bytes')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', snapshot, '-m', 'include unrelated source')
        self.git('checkout', '-q', candidate)
        with patch.object(release, 'FIRST_HOST_APP_SNAPSHOT', snapshot):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()

    def test_family_dispatch_uses_first_host_before_historical_camera_looks(self):
        with patch(__name__ + '.camera_looks_source_family', side_effect=AssertionError('old family selected')):
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'], self.blob(self.operator))
        with patch.object(release, 'reviewed_camera_looks_application_blobs',
                          side_effect=AssertionError('old admission selected')):
            self.assertEqual(set(self.verify()), set(self.files) | release.FIRST_HOST_CONTROL_FILES | set(self.prerequisites))


    def test_executing_first_host_tests_cannot_fall_back_to_an_older_operator_family(self):
        self.git('checkout', '-q', self.control)
        self.write('ops/vps/code-release.py', 'historical operator bytes\n')
        self.git('add', 'ops/vps/code-release.py')
        with patch.object(sys.modules[__name__], 'FIRST_HOST_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             patch(__name__ + '.camera_looks_source_family', return_value={'old': 'accepted'}) as old_family:
            with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                checkout_source_family(self.root)
            old_family.assert_not_called()


    def test_staged_deletions_restored_as_untracked_exact_files_are_rejected(self):
        existing_application = next(name for name in self.files if name not in self.added)
        for revision in (self.control, self.candidate):
            for name in (existing_application, *release.FIRST_HOST_CONTROL_FILES):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    self.git('rm', '--cached', name)
                    with self.assertRaisesRegex(AssertionError, 'full inventory'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_normal_main_merge_accepts_original_control_ancestor(self):
        merged = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                          '-p', self.live, '-p', self.control, '-m', 'normal merge of reviewed controls')
        self.git('update-ref', 'refs/remotes/origin/main', merged)
        self.assertEqual(self.git('show', '-s', '--format=%P', self.control), self.live)
        self.assertEqual(self.git('show', '-s', '--format=%P', merged).split(), [self.live, self.control])
        self.assertEqual(self.git('show', '-s', '--format=%P', self.candidate).split(),
                         [self.control, self.snapshot])
        self.assertEqual(set(self.verify()), set(self.files) | release.FIRST_HOST_CONTROL_FILES | set(self.prerequisites))
        # The branch commit C is the trust anchor, not a newer same-tree main merge
        # which is deliberately absent from the already-published P ancestry.
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=merged):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_missing_invalid_and_unrelated_same_tree_controls_are_rejected(self):
        for trusted in ('', 'HEAD', 'a' * 12, 'A' * 40, 'f' * 40):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises((release.ReleaseError, subprocess.CalledProcessError)):
                    self.verify()
        unrelated = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                             '-m', 'unrelated same-tree controls')
        self.git('update-ref', 'refs/remotes/origin/main', unrelated)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_same_tree_wrong_baseline_and_source_commit_identities_are_rejected(self):
        wrong_base = self.git('commit-tree', self.git('rev-parse', self.live + '^{tree}'),
                              '-m', 'same-tree wrong live identity')
        with self.assertRaisesRegex(release.ReleaseError, 'live or snapshot tree'):
            release.reviewed_first_host_application_blobs(wrong_base, self.candidate)
        wrong_source = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                                '-p', self.live, '-m', 'same-tree unreviewed source identity')
        impostor = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                           '-p', self.control, '-p', wrong_source, '-m', 'wrong source ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(impostor)




    def test_package_cannot_repin_other_scripts_dependencies_or_overrides(self):
        for section, key, value in (('scripts', 'test:repo', 'skip tests'),
                                    ('scripts', 'build', 'skip build'),
                                    ('dependencies', 'next', '99.0.0'),
                                    ('devDependencies', 'vitest', '99.0.0'),
                                    ('overrides', 'undici', '99.0.0')):
            with self.subTest(section=section, key=key):
                self.git('checkout', '-q', self.snapshot)
                package = json.loads((self.root / 'package.json').read_text())
                package[section][key] = value
                raw = json.dumps(package)
                self.write('package.json', raw)
                snapshot = self.commit()
                self.git('checkout', '-q', self.control)
                self.git('merge', '--no-ff', '--no-commit', snapshot)
                candidate = self.commit()
                with patch.object(release, 'FIRST_HOST_APP_SNAPSHOT', snapshot), \
                     patch.object(release, 'FIRST_HOST_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                     patch.dict(release.FIRST_HOST_APPLICATION_BLOBS, {'package.json': self.blob(raw.encode())}):
                    with self.assertRaisesRegex(release.ReleaseError, 'exact three test registrations'):
                        self.verify(candidate)

    def test_new_migration_cannot_inherit_a_historical_application_grant(self):
        for name in (FirstHostMigrationTests.PATH, EventHostPassMigrationTests.PATH):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.live)
                self.write(name, FirstHostMigrationTests.SQL if name == FirstHostMigrationTests.PATH else EventHostPassMigrationTests.SQL)
                candidate = self.commit()
                with patch.object(release, 'FIRST_HOST_RELEASE_BASELINE', 'f' * 40), \
                     patch.object(release, 'reviewed_application_blobs', side_effect=AssertionError('historical grant used')):
                    with self.assertRaisesRegex(release.ReleaseError, 'requires its exact release family'):
                        self.verify(candidate)

    def test_migration_plan_cannot_drop_or_repin_either_schema(self):
        for path in (FirstHostMigrationTests.PATH, EventHostPassMigrationTests.PATH):
            for key, value in (('blob', 'f' * 40), ('sha256', 'f' * 64),
                               ('schemaSha256', 'f' * 64), ('tables', ['orders'])):
                forged = dict(release.REVIEWED_MIGRATIONS[path], **{key: value})
                with self.subTest(path=path, key=key), patch.dict(release.REVIEWED_MIGRATIONS, {path: forged}):
                    with self.assertRaisesRegex(release.ReleaseError, 'exact additive receipt and invitation migrations'):
                        self.verify()
            without = {name: spec for name, spec in release.REVIEWED_MIGRATIONS.items() if name != path}
            with patch.object(release, 'REVIEWED_MIGRATIONS', without):
                with self.assertRaisesRegex(release.ReleaseError, 'exact additive receipt and invitation migrations'):
                    self.verify()

    def test_handover_cannot_repin_extra_names_flag_values_or_unrelated_code(self):
        for replacement in ("'ROOM_HOST_FIRST_POST_ENABLED', 'UNREVIEWED_SECRET'",
                            "'ROOM_HOST_FIRST_POST_ENABLED=true'", "'ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID'", None):
            with self.subTest(replacement=replacement):
                self.git('checkout', '-q', self.snapshot)
                raw = (self.root / 'worker/handover.ts').read_text()
                raw = (raw + "export const FIRST_HOST_ACTIVATED = true;\n" if replacement is None
                       else raw.replace("'ROOM_HOST_FIRST_POST_ENABLED'", replacement))
                self.write('worker/handover.ts', raw)
                snapshot = self.commit()
                self.git('checkout', '-q', self.control)
                self.git('merge', '--no-ff', '--no-commit', snapshot)
                candidate = self.commit()
                with patch.object(release, 'FIRST_HOST_APP_SNAPSHOT', snapshot), \
                     patch.object(release, 'FIRST_HOST_APP_TREE', self.git('rev-parse', snapshot + '^{tree}')), \
                     patch.dict(release.FIRST_HOST_APPLICATION_BLOBS, {'worker/handover.ts': self.blob(raw.encode())}):
                    with self.assertRaisesRegex(release.ReleaseError, 'exact three configuration names'):
                        self.verify(candidate)


    def test_workflow_prerequisite_scope_input_and_output_are_exact(self):
        for field in ('FIRST_HOST_PREREQUISITE_INPUTS', 'FIRST_HOST_PREREQUISITE_BLOBS'):
            for values in ({}, {'.github/workflows/other.yml': 'f' * 40}):
                with self.subTest(field=field, values=values), patch.object(release, field, values):
                    with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
            with patch.dict(getattr(release, field), {self.prerequisites[0]: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'workflow prerequisite'): self.verify()

    def test_workflow_prerequisite_cannot_change_or_disappear_in_control_or_promotion(self):
        for revision in (self.control, self.candidate):
            for mutation in ('bytes', 'missing', 'old-version', 'mode'):
                with self.subTest(revision=revision, mutation=mutation):
                    self.git('checkout', '-q', revision)
                    name = self.prerequisites[0]
                    if mutation == 'bytes': self.write(name, 'unreviewed workflow permissions or steps\n')
                    elif mutation == 'missing': self.git('rm', name)
                    elif mutation == 'old-version': self.git('checkout', self.live, '--', name)
                    else: (self.root / name).chmod(0o755)
                    changed = self.commit()
                    with self.assertRaises(AssertionError): checkout_source_family(self.root)
                    if revision == self.control:
                        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                             '-p', self.candidate, '-p', changed, '-m', 'include changed workflow')
                        self.git('checkout', '-q', candidate)
                        self.git('update-ref', 'refs/remotes/origin/main', changed)
                    with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed if revision == self.control else self.control):
                        with self.assertRaises(release.ReleaseError): self.verify()
                    self.git('update-ref', 'refs/remotes/origin/main', self.control)


class FirstHostMigrationTests(unittest.TestCase):
    SQL = b'-- No backfill and no access grants. Activation requires an explicit feature flag.\n-- Receipts are never retention-pruned: deletion/reposting must not re-arm a host.\nCREATE TABLE room_host_first_posts (\n event_slug TEXT NOT NULL,\n host_account_id TEXT NOT NULL,\n message_id TEXT NOT NULL UNIQUE,\n sender_attendee_id TEXT NOT NULL,\n created_at TEXT NOT NULL,\n fanout_at TEXT,\n cancelled_at TEXT,\n PRIMARY KEY (event_slug, host_account_id)\n);\nCREATE INDEX room_host_first_posts_message_idx ON room_host_first_posts(message_id);\n'
    PATH = 'drizzle/0068_room_host_first_posts.sql'

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.database = self.root / 'tickets.sqlite'
        self.staging = self.root / 'backup'
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute('CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL)')
            db.execute("INSERT INTO orders VALUES ('preserved-order', 'paid')")
        self.database.chmod(0o600)
        self.spec = release.migration_plan([self.PATH])[0]

    def migrate(self, raw=None):
        return release.migrate_database(self.database, self.staging,
                                        [(self.spec, self.SQL if raw is None else raw)])

    def test_exact_existing_grammar_accepts_only_new_receipt_table_and_index(self):
        self.assertEqual(FirstHostSourceAdmissionTests.blob(self.SQL), self.spec['blob'])
        statements, rows = release.reviewed_migration(self.SQL, self.spec)
        self.assertEqual(len(statements), 2)
        self.assertEqual([(row[0], row[1], row[2]) for row in rows], [
            ('index', 'room_host_first_posts_message_idx', 'room_host_first_posts'),
            ('table', 'room_host_first_posts', 'room_host_first_posts')])
        self.assertNotIn('triggers', self.spec)
        result = self.migrate()
        self.assertTrue(result['created'])
        self.assertTrue(result['tablesPreservedOnRollback'])
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute('SELECT * FROM orders').fetchall(), [('preserved-order', 'paid')])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM room_host_first_posts').fetchone(), (0,))
        self.assertEqual(stat.S_IMODE((self.staging / 'before.sqlite').stat().st_mode), 0o600)
        with release.closing(release.sqlite3.connect(self.staging / 'before.sqlite')) as db:
            self.assertEqual([row[1] for row in release.schema_rows(db)], ['orders'])

    def test_changed_bytes_target_backfill_or_trigger_fail_before_backup(self):
        for raw in (self.SQL + b'\n', self.SQL.replace(b'ON room_host_first_posts', b'ON orders'),
                    self.SQL + b'DELETE FROM orders;', self.SQL + b'UPDATE orders SET status = "free";',
                    self.SQL + b'CREATE TRIGGER extra AFTER INSERT ON orders BEGIN SELECT 1; END;'):
            with self.subTest(digest=release.hashlib.sha256(raw).hexdigest()):
                with self.assertRaises(release.ReleaseError): self.migrate(raw)
                self.assertFalse(self.staging.exists())

    def test_replay_preserves_completed_and_cancelled_receipts(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute("INSERT INTO room_host_first_posts VALUES ('event', 'host', 'message', 'sender', 'created', 'fanout', 'cancelled')")
            before = db.execute('SELECT * FROM room_host_first_posts').fetchall()
        self.staging = self.root / 'second-backup'
        self.assertFalse(self.migrate()['created'])
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute('SELECT * FROM room_host_first_posts').fetchall(), before)

    def test_partial_receipt_schema_is_rejected_without_rewriting_existing_rows(self):
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute('CREATE TABLE room_host_first_posts (id TEXT)')
        with self.assertRaisesRegex(release.ReleaseError, 'partial or differs'): self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute('SELECT * FROM orders').fetchall(), [('preserved-order', 'paid')])

    def test_generic_sql_grammar_and_schema_digest_remain_restrictive(self):
        for raw in (b'ALTER TABLE orders ADD COLUMN extra TEXT;', b'DELETE FROM orders;',
                    b'CREATE INDEX extra ON orders (id);'):
            forged = dict(self.spec, sha256=release.hashlib.sha256(raw).hexdigest())
            with self.assertRaises(release.ReleaseError): release.additive_statements(raw, forged)
        raw = b'CREATE TRIGGER extra BEFORE INSERT ON orders BEGIN SELECT 1; END;'
        forged = dict(self.spec, sha256=release.hashlib.sha256(raw).hexdigest(), triggers={'extra': 'orders'})
        with self.assertRaisesRegex(release.ReleaseError, 'Only the reviewed refund rollback guard'):
            release.additive_statements(raw, forged)
        with self.assertRaisesRegex(release.ReleaseError, 'reviewed additive schema'):
            release.additive_statements(self.SQL, dict(self.spec, schemaSha256='f' * 64))


class EventHostPassMigrationTests(unittest.TestCase):
    SQL = b"-- No backfill, pass, token or email. Owner provision and send are separate actions.\nCREATE TABLE event_host_pass_invitations (\n id TEXT PRIMARY KEY,\n event_slug TEXT NOT NULL,\n host_account_id TEXT NOT NULL,\n recipient_email TEXT NOT NULL,\n ticket_id TEXT NOT NULL,\n provision_nonce TEXT NOT NULL,\n created_by TEXT NOT NULL,\n created_at TEXT NOT NULL,\n reused INTEGER NOT NULL,\n state TEXT NOT NULL DEFAULT 'provisioned',\n token_hash TEXT,\n expires_at TEXT,\n used_at TEXT,\n claimed_session_id TEXT,\n delivery_id TEXT\n);\nCREATE UNIQUE INDEX event_host_pass_scope_unique ON event_host_pass_invitations(event_slug,host_account_id);\nCREATE UNIQUE INDEX event_host_pass_invitations_token_hash_unique ON event_host_pass_invitations(token_hash);\n"
    PATH = 'drizzle/0069_event_host_pass_invitations.sql'

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.database = self.root / 'tickets.sqlite'
        self.staging = self.root / 'backup'
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute('CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL)')
            db.execute("INSERT INTO orders VALUES ('preserved-order', 'paid')")
        self.database.chmod(0o600)
        self.spec = release.migration_plan([self.PATH])[0]

    def migrate(self, raw=None):
        return release.migrate_database(self.database, self.staging,
                                        [(self.spec, self.SQL if raw is None else raw)])

    def test_exact_table_two_unique_indexes_and_empty_initial_data(self):
        self.assertEqual(FirstHostSourceAdmissionTests.blob(self.SQL), self.spec['blob'])
        statements, rows = release.reviewed_migration(self.SQL, self.spec)
        self.assertEqual(len(statements), 3)
        self.assertEqual([(row[0], row[1], row[2]) for row in rows], [
            ('index', 'event_host_pass_invitations_token_hash_unique', 'event_host_pass_invitations'),
            ('index', 'event_host_pass_scope_unique', 'event_host_pass_invitations'),
            ('table', 'event_host_pass_invitations', 'event_host_pass_invitations')])
        self.assertNotIn('triggers', self.spec)
        result = self.migrate()
        self.assertTrue(result['created'])
        self.assertTrue(result['tablesPreservedOnRollback'])
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute('SELECT * FROM orders').fetchall(), [('preserved-order', 'paid')])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM event_host_pass_invitations').fetchone(), (0,))
        self.assertEqual(stat.S_IMODE((self.staging / 'before.sqlite').stat().st_mode), 0o600)

    def test_bytes_column_scope_uniqueness_and_backfill_drift_fail_before_backup(self):
        for raw in (self.SQL + b'\n', self.SQL.replace(b'CREATE UNIQUE INDEX', b'CREATE INDEX'),
                    self.SQL.replace(b'(event_slug,host_account_id)', b'(host_account_id)'),
                    self.SQL.replace(b'token_hash TEXT', b'plaintext_token TEXT'),
                    self.SQL + b'INSERT INTO orders VALUES ("unreviewed", "paid");'):
            with self.subTest(digest=release.hashlib.sha256(raw).hexdigest()):
                with self.assertRaises(release.ReleaseError): self.migrate(raw)
                self.assertFalse(self.staging.exists())

    def test_replay_preserves_used_invitation_and_exact_claim_state(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute("INSERT INTO event_host_pass_invitations VALUES ('invite', 'event', 'host', 'host@example.invalid', 'pass', 'nonce', 'owner', 'created', 0, 'used', 'token-hash', 'expires', 'used', 'session', 'delivery')")
            before = db.execute('SELECT * FROM event_host_pass_invitations').fetchall()
        self.staging = self.root / 'second-backup'
        self.assertFalse(self.migrate()['created'])
        with release.closing(release.sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute('SELECT * FROM event_host_pass_invitations').fetchall(), before)

    def test_scope_and_token_hash_uniqueness_are_enforced(self):
        self.migrate()
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            columns = 'id,event_slug,host_account_id,recipient_email,ticket_id,provision_nonce,created_by,created_at,reused,token_hash'
            statement = 'INSERT INTO event_host_pass_invitations (' + columns + ') VALUES (?,?,?,?,?,?,?,?,?,?)'
            db.execute(statement, ('one', 'event', 'host', 'host@example.invalid', 'pass', 'nonce', 'owner', 'created', 0, 'hash'))
            for row in (('two', 'event', 'host', 'other@example.invalid', 'pass2', 'nonce2', 'owner', 'created', 0, None),
                        ('three', 'event2', 'host2', 'other@example.invalid', 'pass3', 'nonce3', 'owner', 'created', 0, 'hash')):
                with self.subTest(row=row[:3]), self.assertRaises(release.sqlite3.IntegrityError): db.execute(statement, row)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM event_host_pass_invitations').fetchone(), (1,))

    def test_partial_schema_or_forged_index_digest_is_rejected(self):
        statements, _ = release.reviewed_migration(self.SQL, self.spec)
        with release.closing(release.sqlite3.connect(self.database)) as db, db:
            db.execute(statements[0])
        with self.assertRaisesRegex(release.ReleaseError, 'partial or differs'): self.migrate()
        with self.assertRaisesRegex(release.ReleaseError, 'reviewed additive schema'):
            release.additive_statements(self.SQL, dict(self.spec, schemaSha256='f' * 64))


class FirstHostDeploymentTests(DeploymentFixture):
    def prepare_receipts(self, tampered=False):
        state = self.root / 'var/lib/becore-tickets'
        state.chmod(0o700)
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
            db.execute('CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL)')
            db.execute("INSERT INTO orders VALUES ('preserved-order', 'paid')")
        (state / 'tickets.sqlite').chmod(0o600)
        member = tarfile.TarInfo('migrations/0068_room_host_first_posts.sql')
        member.mode = 0o644
        invitation = tarfile.TarInfo('migrations/0069_event_host_pass_invitations.sql')
        invitation.mode = 0o644
        self.make_archive(extra=[(member, FirstHostMigrationTests.SQL + (b'\n' if tampered is True else b'')),
                                 (invitation, EventHostPassMigrationTests.SQL + (b'\n' if tampered == 'invitation' else b''))])
        self.proof['changedFiles'] = [FirstHostMigrationTests.PATH, EventHostPassMigrationTests.PATH]
        self.proof['migrations'] = release.migration_plan(self.proof['changedFiles'])
        self.refresh_digests()
        return state

    def test_exact_receipt_schema_and_private_backup_are_recorded(self):
        self.prepare_receipts()
        self.assertTrue(self.deployment.transact()['dataMigration'])
        journal = release.strict_json(self.deployment.journal.read_bytes())
        self.assertEqual(journal['lastCodeRelease']['additiveMigrations'], self.proof['migrations'])
        self.assertEqual(len(journal['lastCodeRelease']['databaseBackupSha256']), 64)

    def test_tampered_receipt_migration_prevents_any_restart(self):
        self.prepare_receipts(tampered=True)
        with self.assertRaises(release.ReleaseError): self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assert_restored()

    def test_tampered_invitation_migration_prevents_any_restart(self):
        self.prepare_receipts(tampered='invitation')
        with self.assertRaises(release.ReleaseError): self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assert_restored()

    def test_failed_candidate_preserves_receipts_and_customer_writes_on_code_rollback(self):
        state = self.prepare_receipts()
        self.system.fail = 'local'
        restart = self.system.restart
        def activated():
            restart()
            if self.system.revision == NEW:
                with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
                    db.execute("INSERT INTO orders VALUES ('new-paid-order', 'paid')")
                    db.execute("INSERT INTO room_host_first_posts VALUES ('event', 'host', 'message', 'sender', 'created', 'fanout', 'cancelled')")
                    db.execute("INSERT INTO event_host_pass_invitations VALUES ('invite', 'event', 'host', 'host@example.invalid', 'pass', 'nonce', 'owner', 'created', 0, 'used', 'token-hash', 'expires', 'used', 'session', 'delivery')")
        self.system.restart = activated
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assert_restored()
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM orders').fetchone(), (2,))
            self.assertEqual(db.execute('SELECT * FROM room_host_first_posts').fetchall(),
                             [('event', 'host', 'message', 'sender', 'created', 'fanout', 'cancelled')])
            self.assertEqual(db.execute('SELECT * FROM event_host_pass_invitations').fetchall(),
                             [('invite', 'event', 'host', 'host@example.invalid', 'pass', 'nonce', 'owner', 'created', 0, 'used', 'token-hash', 'expires', 'used', 'session', 'delivery')])
        with release.closing(release.sqlite3.connect(self.deployment.snapshot / 'database/before.sqlite')) as db:
            self.assertEqual(db.execute('SELECT * FROM orders').fetchall(), [('preserved-order', 'paid')])
            self.assertEqual([row[1] for row in release.schema_rows(db)], ['orders'])

    def test_partial_combined_schema_fails_closed_without_rewriting_receipts(self):
        state = self.prepare_receipts()
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
            db.executescript(FirstHostMigrationTests.SQL.decode())
            db.execute("INSERT INTO room_host_first_posts VALUES ('event', 'host', 'message', 'sender', 'created', 'fanout', 'cancelled')")
        with self.assertRaisesRegex(release.ReleaseError, 'Additive migration failed'):
            self.deployment.transact()
        self.assertEqual(self.system.restarts, 0)
        self.assert_restored()
        failure = release.strict_json((self.deployment.snapshot / 'database/failure.json').read_bytes())
        self.assertEqual(failure['reason'], 'Existing additive schema is partial or differs from reviewed source.')
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db:
            self.assertEqual(db.execute('SELECT * FROM room_host_first_posts').fetchall(),
                             [('event', 'host', 'message', 'sender', 'created', 'fanout', 'cancelled')])
            self.assertFalse(any(row[1] == 'event_host_pass_invitations' for row in release.schema_rows(db)))


class FirstHostTargetTests(unittest.TestCase):
    ACCOUNT = '11111111-1111-4111-8111-111111111111'
    OTHER = '22222222-2222-4222-8222-222222222222'

    @classmethod
    def seed(cls, db):
        db.executescript("""CREATE TABLE staff_accounts(id TEXT,role TEXT,status TEXT,must_change_password INTEGER,locked_until TEXT);
            CREATE TABLE staff_event_assignments(account_id TEXT,event_slug TEXT);
            CREATE TABLE curated_event_records(slug TEXT,status TEXT,schedule_status TEXT,removed_at TEXT,archived_at TEXT,event_state TEXT,starts_at TEXT,ends_at TEXT);
            CREATE TABLE event_hosts(event_slug TEXT,host_id TEXT);
            CREATE TABLE hosts(id TEXT,slug TEXT,verification_status TEXT);""")
        db.execute("INSERT INTO staff_accounts VALUES (?,'organizer','active',0,NULL)", (cls.ACCOUNT,))
        db.execute("INSERT INTO staff_event_assignments VALUES (?,'puro-exceso-20261024')", (cls.ACCOUNT,))
        db.execute("INSERT INTO curated_event_records VALUES ('puro-exceso-20261024','published','confirmed',NULL,NULL,'on_sale','2026-10-24T00:00:00Z','2999-10-25T00:00:00Z')")
        db.execute("INSERT INTO event_hosts VALUES ('puro-exceso-20261024','host:kofi-bills')")
        db.execute("INSERT INTO hosts VALUES ('host:kofi-bills','kofi-bills','verified')")

    def test_explicit_private_target_does_not_require_an_application_mapping_or_write_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tickets.sqlite'
            with release.closing(release.sqlite3.connect(path)) as db, db: self.seed(db)
            path.chmod(0o600)
            before = path.read_bytes()
            release.verify_first_host_target(path, self.ACCOUNT, os.geteuid(), os.getegid())
            self.assertEqual(path.read_bytes(), before)

    def test_missing_ambiguous_revoked_locked_or_invalid_event_targets_fail_closed(self):
        for sql in ("DELETE FROM staff_accounts", "UPDATE staff_accounts SET role='owner'",
                    "UPDATE staff_accounts SET status='disabled'", "UPDATE staff_accounts SET must_change_password=1",
                    "UPDATE staff_accounts SET locked_until='2999-01-01'", "UPDATE staff_accounts SET locked_until='invalid'",
                    "DELETE FROM staff_event_assignments", "UPDATE staff_event_assignments SET event_slug='another-event'",
                    "UPDATE curated_event_records SET status='draft'", "UPDATE curated_event_records SET schedule_status='tentative'",
                    "UPDATE curated_event_records SET removed_at='removed'", "UPDATE curated_event_records SET archived_at='archived'",
                    "UPDATE curated_event_records SET event_state='cancelled'", "UPDATE curated_event_records SET ends_at='2000-01-01'",
                    "UPDATE curated_event_records SET ends_at='invalid'", "UPDATE curated_event_records SET starts_at='3000-01-01'",
                    "UPDATE hosts SET verification_status='unverified'", "UPDATE hosts SET slug='another-host'",
                    "UPDATE hosts SET id='another-profile'", "DELETE FROM event_hosts",
                    "INSERT INTO staff_event_assignments SELECT * FROM staff_event_assignments",
                    "INSERT INTO event_hosts SELECT * FROM event_hosts"):
            with self.subTest(sql=sql), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'tickets.sqlite'
                with release.closing(release.sqlite3.connect(path)) as db, db:
                    self.seed(db)
                    db.execute(sql)
                path.chmod(0o600)
                before = path.read_bytes()
                with self.assertRaisesRegex(release.ReleaseError, 'missing, ambiguous, revoked'):
                    release.verify_first_host_target(path, self.ACCOUNT, os.geteuid(), os.getegid())
                self.assertEqual(path.read_bytes(), before)

    def test_wrong_explicit_account_and_unsafe_database_cannot_be_substituted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tickets.sqlite'
            with release.closing(release.sqlite3.connect(path)) as db, db: self.seed(db)
            path.chmod(0o600)
            with self.assertRaises(release.ReleaseError) as rejected:
                release.verify_first_host_target(path, self.OTHER, os.geteuid(), os.getegid())
            self.assertNotIn(self.OTHER, str(rejected.exception))
            path.chmod(0o644)
            with self.assertRaisesRegex(release.ReleaseError, 'private canonical database'):
                release.verify_first_host_target(path, self.ACCOUNT, os.geteuid(), os.getegid())
            path.chmod(0o600)
            sidecar = Path(str(path) + '-shm')
            sidecar.write_bytes(b'unsafe sidecar')
            sidecar.chmod(0o644)
            with self.assertRaisesRegex(release.ReleaseError, 'unsafe database sidecar'):
                release.verify_first_host_target(path, self.ACCOUNT, os.geteuid(), os.getegid())


class FirstHostConfigurationTests(unittest.TestCase):
    def test_bounded_stdin_accepts_only_one_canonical_private_uuid(self):
        account = FirstHostTargetTests.ACCOUNT
        for raw in (account.encode(), account.encode() + b'\n'):
            self.assertEqual(release.first_host_account_from_stdin(io.BytesIO(raw)), account)
        for raw in (b'', b' ', account.upper().encode().replace(b'1', b'A', 1),
                    b' ' + account.encode(), account.encode() + b'\nsecond', b'x' * 1000,
                    account.encode() + b'\n\n', b'not-a-uuid', b'\xff'):
            with self.subTest(length=len(raw)), self.assertRaises(release.ReleaseError):
                release.first_host_account_from_stdin(io.BytesIO(raw))
        stream = unittest.mock.Mock()
        stream.read.return_value = b'x' * 128
        with self.assertRaises(release.ReleaseError): release.first_host_account_from_stdin(stream)
        stream.read.assert_called_once_with(128)

    def test_exact_three_keys_preserve_every_other_value_and_byte(self):
        account = FirstHostTargetTests.ACCOUNT
        raw = ('{\n "ROOM_HOST_FIRST_POST_EVENT_SLUG" : "puro-exceso-20261024",\n'
               ' "ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID" : "' + account + '",\n'
               ' "ROOM_HOST_FIRST_POST_ENABLED" : "0", "unrelated": "keep\\u0031", "SEEV_CRYPTO_ENABLED":"false"\n}\n').encode()
        expected = raw.replace(b'"ROOM_HOST_FIRST_POST_ENABLED" : "0"', b'"ROOM_HOST_FIRST_POST_ENABLED" : "1"')
        self.assertEqual(release.enable_first_host_bytes(raw, account), expected)
        self.assertEqual(release.enable_first_host_bytes(expected, account), expected)
        empty = release.configuration(release.enable_first_host_bytes(b'{}', account))
        self.assertEqual(empty, {'ROOM_HOST_FIRST_POST_ENABLED': '1',
            'ROOM_HOST_FIRST_POST_EVENT_SLUG': 'puro-exceso-20261024', 'ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID': account})
        raw = b'{ "untouched" : "first", "last":"unchanged" }\n'
        result = release.enable_first_host_bytes(raw, account)
        self.assertTrue(result.startswith(raw[:-2]))
        self.assertTrue(result.endswith(b'}\n'))

    def test_conflicting_scope_malformed_or_duplicate_configuration_is_rejected(self):
        for raw in (b'{"ROOM_HOST_FIRST_POST_EVENT_SLUG":"other"}',
                    json.dumps({'ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID': FirstHostTargetTests.OTHER}).encode(),
                    b'{"ROOM_HOST_FIRST_POST_ENABLED":"unexpected"}', b'{"ROOM_HOST_FIRST_POST_ENABLED":"1"}',
                    b'{"x":"one","x":"two"}', b'{"x":true}', b'[]', b'{'):
            with self.subTest(raw=raw), self.assertRaises(release.ReleaseError):
                release.enable_first_host_bytes(raw, FirstHostTargetTests.ACCOUNT)

    def test_cli_keeps_uuid_out_of_arguments_and_output_and_false_never_reads_stdin(self):
        args = ['code-release.py', 'apply', '--source', NEW, '--expected', OLD, '--run-id', '123', '--attempt', '1',
                '--archive', 'archive', '--provenance', 'proof', '--archive-digest', 'a' * 64,
                '--provenance-digest', 'b' * 64, '--audit-report', 'audit']
        for enabled in (False, True):
            stdin = types.SimpleNamespace(buffer=io.BytesIO(FirstHostTargetTests.ACCOUNT.encode()))
            output = io.StringIO()
            with patch.object(sys, 'argv', args + ['--enable-first-host', str(enabled).lower()]), \
                 patch.object(sys, 'stdin', stdin), patch.object(sys, 'stdout', output), \
                 patch.object(release.signal, 'signal'), patch.object(release, 'Deployment') as deployment:
                deployment.return_value.apply.return_value = {'active': True}
                self.assertEqual(release.main(), 0)
                values = deployment.call_args.kwargs
                self.assertEqual(values['enable_first_host'], enabled)
                self.assertEqual(values.get('first_host_account_id'), FirstHostTargetTests.ACCOUNT if enabled else None)
                self.assertEqual(stdin.buffer.tell(), len(FirstHostTargetTests.ACCOUNT) if enabled else 0)
                self.assertNotIn(FirstHostTargetTests.ACCOUNT, output.getvalue())
                self.assertNotIn(FirstHostTargetTests.ACCOUNT, ' '.join(sys.argv))
        output = io.StringIO()
        with patch.object(sys, 'argv', args + ['--enable-first-host', 'true']), \
             patch.object(sys, 'stdin', types.SimpleNamespace(buffer=io.BytesIO(b'invalid-private-value'))), \
             patch.object(sys, 'stderr', output), patch.object(release, 'Deployment') as deployment:
            self.assertEqual(release.main(), 1)
            deployment.assert_not_called()
            self.assertNotIn('invalid-private-value', output.getvalue())
        with patch.object(sys, 'argv', args + ['--enable-first-host', 'true', '--enable-crypto', 'true']), \
             patch.object(sys, 'stderr', io.StringIO()), patch.object(release, 'first_host_account_from_stdin') as private_input, \
             patch.object(release, 'Deployment') as deployment:
            self.assertEqual(release.main(), 1)
            private_input.assert_not_called()
            deployment.assert_not_called()

    def test_workflow_guards_reject_crypto_combination_and_read_only_activation(self):
        raw = (Path(__file__).resolve().parents[2] / '.github/workflows/tickets-code-release.yml').read_text()
        def guard(name):
            return textwrap.dedent(raw.split('      - name: ' + name + '\n', 1)[1]
                .split('        run: |\n', 1)[1].split('\n      - ', 1)[0])
        release_guard = guard('Require main and exact bounded release inputs')
        inspect_guard = guard('Require exact read-only diagnostic context and failed release pins')
        values = {'PATH': os.defpath, 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
            'VERIFY_ONLY': 'false', 'INSPECT_MODE': 'false', 'ENABLE_FIRST_HOST': 'true', 'ENABLE_CRYPTO': 'false',
            'SOURCE_SHA': NEW, 'EXPECTED_ACTIVE': OLD, 'BECORE_TRUSTED_BASE': '9' * 40,
            'RUNTIME_RUN': '123', 'CANDIDATE_RUN': '456', 'CANDIDATE_MODE': 'parallel-v1',
            'RECOVER_PREPARED': '', 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}
        def check(script, environment, expected):
            result = subprocess.run(['bash', '-c', script], env=environment, capture_output=True, timeout=10)
            self.assertEqual(result.returncode == 0, expected)
            self.assertEqual(result.stdout, b'')
            self.assertEqual(result.stderr, b'')
        check(release_guard, values, True)
        check(release_guard, dict(values, ENABLE_CRYPTO='true'), False)
        values.update(SOURCE_SHA='ee95b9b43fb99dd0ca9431cf9be4d000cd65abbe',
            EXPECTED_ACTIVE='45ec44e35f8b0e5099a328ce219df2529374f9ee',
            RUNTIME_RUN='36804016094', CANDIDATE_RUN='36801064451', ENABLE_FIRST_HOST='false')
        check(inspect_guard, values, True)
        check(inspect_guard, dict(values, ENABLE_FIRST_HOST='true'), False)
        check(inspect_guard, dict(values, ENABLE_CRYPTO='true'), False)

    def test_workflow_activation_is_default_off_step_local_stdin_only(self):
        family = checkout_source_family(Path(__file__).resolve().parents[2])
        if family.get('ops/vps/code-release.py') in (ROOM_MAIL_VPS_OPERATOR_BLOB, YORKEWAY_OPERATOR_BLOB, OWNER_PUSH_OPERATOR_BLOB, SECURITY_OPERATOR_BLOB, PARALLEL_GATE_OUTPUTS['ops/vps/code-release.py'][1]):
            # Only the exact new family may add this public archive dependency.
            # Reconstruct the original bytes before keeping its historical pin.
            name = '.github/workflows/tickets-code-release.yml'
            data = (Path(__file__).resolve().parents[2] / name).read_bytes()
            digest = lambda raw: release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
            self.assertEqual(family[name], digest(data))
            data = historical_node_workflow(name, data)
            self.assertEqual(digest(data), release.ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS[name])
            archive = b'git archive "$OPERATOR_SHA" ops/vps ops/email/mailer.py '
            self.assertEqual(data.count(archive), 1)
            historical = data.replace(archive, b'git archive "$OPERATOR_SHA" ops/vps ', 1)
            family = {**family, name: digest(historical)}
        self.assertEqual(family['.github/workflows/tickets-code-release.yml'],
                         release.FIRST_HOST_PREREQUISITE_BLOBS['.github/workflows/tickets-code-release.yml'])
        raw = (Path(__file__).resolve().parents[2] / '.github/workflows/tickets-code-release.yml').read_text()
        self.assertIn("enable_first_host:\n        description:", raw)
        self.assertRegex(raw, r'enable_first_host:[\s\S]+?default: false\n        type: boolean')
        self.assertEqual(raw.count('secrets.TICKETS_FIRST_HOST_ACCOUNT_ID'), 1)
        self.assertIn("FIRST_HOST_ACCOUNT_ID: ${{ inputs.enable_first_host && secrets.TICKETS_FIRST_HOST_ACCOUNT_ID || '' }}", raw)
        self.assertIn("printf '%s' \"$FIRST_HOST_ACCOUNT_ID\" | tailscale ssh", raw)
        self.assertNotIn('--first-host-account', raw)
        self.assertIn('test "$ENABLE_FIRST_HOST" = false', raw)
        self.assertIn('if [[ "$ENABLE_FIRST_HOST" == true ]]; then test "$ENABLE_CRYPTO" = false; fi', raw)


class FirstHostActivationTests(DeploymentFixture):
    def setUp(self):
        super().setUp()
        FirstHostDeploymentTests.prepare_receipts(self)
        state = self.root / 'var/lib/becore-tickets'
        with release.closing(release.sqlite3.connect(state / 'tickets.sqlite')) as db, db:
            FirstHostTargetTests.seed(db)
        self.proof['changedFiles'] = sorted(set(release.FIRST_HOST_APPLICATION_BLOBS) | release.FIRST_HOST_CONTROL_FILES
                                            | set(release.FIRST_HOST_PREREQUISITE_BLOBS))
        self.refresh_digests()
        baseline = patch.object(release, 'FIRST_HOST_RELEASE_BASELINE', OLD)
        baseline.start()
        self.addCleanup(baseline.stop)
        self.deployment = self.new_deployment(enable_first_host=True, first_host_account_id=FirstHostTargetTests.ACCOUNT)

    def test_success_sets_only_first_host_scope_and_retains_private_rollback_bytes(self):
        result = self.deployment.transact()
        expected = release.enable_first_host_bytes(self.config_before, FirstHostTargetTests.ACCOUNT)
        self.assertEqual(self.deployment.config.read_bytes(), expected)
        self.assertEqual((self.deployment.snapshot / 'config.before').read_bytes(), self.config_before)
        self.assertTrue(result['firstHostEnabledRequested'])
        self.assertFalse(result['cryptoEnabledRequested'])
        self.assertNotIn(FirstHostTargetTests.ACCOUNT, json.dumps(result))
        self.assertNotIn(FirstHostTargetTests.ACCOUNT, (self.deployment.snapshot / 'result.json').read_text())
        self.assertNotIn(FirstHostTargetTests.ACCOUNT, self.deployment.journal.read_text())
        self.assertNotIn('firstHostScopeSha256', json.dumps(result))
        self.assertNotIn('firstHostScopeSha256', self.deployment.journal.read_text())
        self.assertIn('firstHostScopeSha256', (self.deployment.snapshot / 'result.json').read_text())
        self.assertEqual(stat.S_IMODE(self.deployment.config.stat().st_mode), 0o600)

    def test_default_false_leaves_configuration_exact_and_never_checks_a_target(self):
        self.deployment = self.new_deployment()
        with patch.object(release, 'verify_first_host_target', side_effect=AssertionError('target checked while disabled')):
            result = self.deployment.transact()
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)
        self.assertNotIn('firstHostEnabledRequested', result)

    def test_absent_malformed_extra_account_or_crypto_combination_is_rejected(self):
        for values in ({'enable_first_host': True}, {'enable_first_host': 'true'},
                       {'enable_first_host': True, 'first_host_account_id': 'invalid'},
                       {'first_host_account_id': FirstHostTargetTests.ACCOUNT},
                       {'enable_first_host': True, 'first_host_account_id': FirstHostTargetTests.ACCOUNT, 'enable_crypto': True}):
            with self.subTest(keys=tuple(values)), self.assertRaises(release.ReleaseError): self.new_deployment(**values)

    def test_wrong_release_family_or_changed_inventory_cannot_activate(self):
        with patch.object(release, 'FIRST_HOST_RELEASE_BASELINE', 'f' * 40):
            with self.assertRaisesRegex(release.ReleaseError, 'exact reviewed first-host release family'):
                self.deployment.preflight()
        self.proof['changedFiles'].append('tests/unreviewed-file.ts')
        self.refresh_digests()
        self.deployment = self.new_deployment(enable_first_host=True, first_host_account_id=FirstHostTargetTests.ACCOUNT)
        with self.assertRaisesRegex(release.ReleaseError, 'exact reviewed first-host release family'):
            self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)

    def test_conflicting_existing_scope_or_revoked_preflight_target_never_writes_configuration(self):
        altered = b'{"ENVIRONMENT":"production","ROOM_HOST_FIRST_POST_EVENT_SLUG":"other"}'
        release.atomic_write(self.deployment.config, altered)
        with self.assertRaisesRegex(release.ReleaseError, 'conflicts'): self.deployment.preflight()
        self.assertEqual(self.deployment.config.read_bytes(), altered)
        release.atomic_write(self.deployment.config, self.config_before)
        with release.closing(release.sqlite3.connect(self.root / 'var/lib/becore-tickets/tickets.sqlite')) as db, db:
            db.execute("UPDATE staff_accounts SET status='disabled'")
        with self.assertRaisesRegex(release.ReleaseError, 'missing, ambiguous, revoked'): self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)
        self.assertEqual(self.system.restarts, 0)

    def test_target_is_rechecked_after_migration_before_atomic_activation(self):
        migrate = self.deployment.migrate
        def revoked_after_migration():
            migrate()
            with release.closing(release.sqlite3.connect(self.root / 'var/lib/becore-tickets/tickets.sqlite')) as db, db:
                db.execute("DELETE FROM staff_event_assignments")
        self.deployment.migrate = revoked_after_migration
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'): self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.system.revision, OLD)
        self.assertEqual(self.system.restarts, 1)  # Only the preserved old runtime restarts during verified rollback.

    def test_failed_candidate_restores_exact_configuration_and_keeps_new_rows(self):
        self.system.fail = 'local'
        restart = self.system.restart
        def activated():
            restart()
            if self.system.revision == NEW:
                with release.closing(release.sqlite3.connect(self.root / 'var/lib/becore-tickets/tickets.sqlite')) as db, db:
                    db.execute("INSERT INTO room_host_first_posts VALUES ('event','host','message','sender','created','fanout','cancelled')")
                    db.execute("INSERT INTO event_host_pass_invitations VALUES ('invite','event','host','synthetic@example.invalid','pass','nonce','owner','created',0,'used','hash','expiry','used','session','delivery')")
        self.system.restart = activated
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'): self.deployment.transact()
        self.assert_restored()
        with release.closing(release.sqlite3.connect(self.root / 'var/lib/becore-tickets/tickets.sqlite')) as db:
            self.assertEqual(db.execute('SELECT message_id,cancelled_at FROM room_host_first_posts').fetchall(), [('message','cancelled')])
            self.assertEqual(db.execute('SELECT state,used_at,claimed_session_id FROM event_host_pass_invitations').fetchall(), [('used','used','session')])

    def test_prepared_recovery_cannot_change_the_private_target(self):
        failed = self.prepared_failure()
        with release.closing(release.sqlite3.connect(self.root / 'var/lib/becore-tickets/tickets.sqlite')) as db, db:
            db.execute("INSERT INTO staff_accounts VALUES (?,'organizer','active',0,NULL)", (FirstHostTargetTests.OTHER,))
            db.execute("INSERT INTO staff_event_assignments VALUES (?,'puro-exceso-20261024')", (FirstHostTargetTests.OTHER,))
        self.deployment = self.new_deployment(run_id='456', recover_prepared=failed.identity,
            enable_first_host=True, first_host_account_id=FirstHostTargetTests.OTHER)
        with self.assertRaisesRegex(release.ReleaseError, 'does not match this exact failed transaction'):
            self.deployment.preflight()
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)


class RoomMailVpsSourceAdmissionTests(unittest.TestCase):
    """Bind original reviewed application ancestry and exact independent operational controls."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q')
        self.git('config', '--local', 'maintenance.autoDetach', 'false')
        self.git('config', '--local', 'gc.autoDetach', 'false')
        self.git('config', 'user.name', 'Room VPS mail admission tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.prerequisites = tuple(release.ROOM_MAIL_VPS_PREREQUISITE_BLOBS)
        self.files = tuple(release.ROOM_MAIL_VPS_APPLICATION_BLOBS)
        self.control_prerequisites = tuple(release.ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS)
        self.added = set()
        self.assertTrue(all(release.ROOM_MAIL_VPS_APPLICATION_INPUTS.values()))
        self.assertEqual(len(self.files), 5)
        self.assertEqual(len(self.prerequisites), 15)
        for name in (*self.files, *release.ROOM_MAIL_VPS_CONTROL_FILES):
            if name not in self.added:
                self.write(name, 'baseline ' + name + '\n')
        for name in release.ROOM_MAIL_VPS_DEPENDENCY_BLOBS:
            self.write(name, 'unchanged locked dependency input ' + name + '\n')
        package = {'scripts': {'test:ui': 'node --test tests/mobile-ui.test.mjs'},
                   'dependencies': {'next': '16.4.1'}, 'devDependencies': {'vitest': '4.1.12'},
                   'overrides': {'fast-uri': '3.1.9', 'undici': '7.30.1', 'zod': '4.6.6'}}
        self.write('package.json', json.dumps(package))
        self.write('ops/vps/audit.py', 'unchanged staged utility\n')
        self.write('.github/workflows/tickets-code-release.yml', 'unchanged release workflow\n')
        self.write('.github/workflows/candidate-checks.yml', 'unchanged gates\n')
        self.write('worker/handover.ts', 'unchanged handover configuration names\n')
        for name in self.control_prerequisites:
            self.write(name, 'baseline exact archive workflow\n')
        self.live = self.commit()
        for name in release.ROOM_MAIL_VPS_APP_ORIGIN_PREREQUISITES:
            self.write(name, 'exact reviewed operational prerequisite ' + name + '\n')
        operational = self.commit()
        for name in self.files:
            self.write(name, 'exact reviewed room VPS mail ' + name + '\n')
        self.origin = self.commit()
        self.git('checkout', '-q', operational)
        for name in self.prerequisites:
            self.write(name, 'exact reviewed operational prerequisite ' + name + '\n')
        self.prerequisite = self.commit()
        self.git('merge', '--no-ff', '--no-commit', self.origin)
        self.snapshot = self.commit()
        self.pins = {name: self.git('rev-parse', self.snapshot + ':' + name) for name in self.files}
        self.inputs = {name: None if name in self.added else self.git('rev-parse', self.live + ':' + name)
                       for name in self.files}
        self.git('checkout', '-q', self.prerequisite)
        self.operator = b'independent reviewed room_mail_vps operator\n'
        self.write('ops/vps/code-release.py', self.operator)
        self.write('ops/vps/test_code_release.py', 'independent reviewed room_mail_vps tests\n')
        for name in self.control_prerequisites:
            self.write(name, 'exact archive plus pinned mailer source\n')
        self.control = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {
            'ROOM_MAIL_VPS_RELEASE_BASELINE': self.live,
            'ROOM_MAIL_VPS_RELEASE_BASE_TREE': self.git('rev-parse', self.live + '^{tree}'),
            'ROOM_MAIL_VPS_PREREQUISITE_SNAPSHOT': self.prerequisite,
            'ROOM_MAIL_VPS_PREREQUISITE_TREE': self.git('rev-parse', self.prerequisite + '^{tree}'),
            'ROOM_MAIL_VPS_APP_ORIGIN': self.origin,
            'ROOM_MAIL_VPS_APP_ORIGIN_TREE': self.git('rev-parse', self.origin + '^{tree}'),
            'ROOM_MAIL_VPS_APP_SNAPSHOT': self.snapshot,
            'ROOM_MAIL_VPS_APP_TREE': self.git('rev-parse', self.snapshot + '^{tree}'),
            'ROOM_MAIL_VPS_PREREQUISITE_INPUTS': {name: None for name in self.prerequisites},
            'ROOM_MAIL_VPS_PREREQUISITE_BLOBS': {name: self.git('rev-parse', self.prerequisite + ':' + name)
                                                for name in self.prerequisites},
            'ROOM_MAIL_VPS_CONTROL_PREREQUISITE_INPUTS': {name: self.git('rev-parse', self.live + ':' + name) for name in self.control_prerequisites},
            'ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS': {name: self.git('rev-parse', self.control + ':' + name) for name in self.control_prerequisites},
            'ROOM_MAIL_VPS_APPLICATION_INPUTS': self.inputs,
            'ROOM_MAIL_VPS_APPLICATION_BLOBS': self.pins,
            'ROOM_MAIL_VPS_DEPENDENCY_BLOBS': {name: self.git('rev-parse', self.live + ':' + name)
                                              for name in release.ROOM_MAIL_VPS_DEPENDENCY_BLOBS},
            '__file__': str(self.root / 'ops/vps/code-release.py'),
        }
        for name, value in values.items():
            self.patch_value(release, name, value)
        self.patch_value(sys.modules[__name__], 'ROOM_MAIL_VPS_OPERATOR_BLOB', self.blob(self.operator))
        staged_names = (*release.ROOM_MAIL_VPS_CONTROL_FILES,
                        *(name for name in self.prerequisites if name.startswith('ops/vps/') or name == 'ops/email/mailer.py'),
                        *self.control_prerequisites,
                        'ops/vps/audit.py', '.github/workflows/tickets-code-release.yml',
                        '.github/workflows/candidate-checks.yml')
        self.staged = {name: ('100644', self.git('rev-parse', self.control + ':' + name)) for name in staged_names}
        self.patch_value(sys.modules[__name__], 'ROOM_MAIL_VPS_STAGED_BASE', self.staged)
        patcher = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)
        patcher.start()
        self.addCleanup(patcher.stop)


    def patch_value(self, target, name, value):
        patcher = patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)


    def git(self, *args):
        return checkout_git(self.root, *args).decode().strip()


    @staticmethod
    def blob(raw):
        return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


    def write(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw.encode() if isinstance(raw, str) else raw)
        path.chmod(0o644)
        return path


    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'isolated Room VPS mail source')
        return self.git('rev-parse', 'HEAD')


    def verify(self, source=None):
        return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))


    def test_each_application_output_rejects_mutation_and_partial_patch(self):
        for name in self.files:
            for mutation in ('bytes', 'missing-change'):
                with self.subTest(name=name, mutation=mutation):
                    self.git('checkout', '-q', self.candidate)
                    if mutation == 'bytes':
                        self.write(name, 'unreviewed bytes\n')
                    elif name in self.added:
                        self.git('rm', name)
                    else:
                        self.git('checkout', self.control, '--', name)
                    self.commit()
                    with self.assertRaises(release.ReleaseError):
                        self.verify()
                    with self.assertRaises(AssertionError):
                        checkout_source_family(self.root)


    def test_changed_controls_and_executing_operator_are_rejected(self):
        for name in release.ROOM_MAIL_VPS_CONTROL_FILES:
            with self.subTest(name=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'untrusted control\n')
                self.commit()
                with self.assertRaises(release.ReleaseError):
                    self.verify()
        self.git('checkout', '-q', self.candidate)
        self.write('ops/vps/code-release.py', 'untrusted executing bytes\n')
        with self.assertRaisesRegex(release.ReleaseError, 'Operator bytes'):
            self.verify()
        with patch.object(sys.modules[__name__], 'ROOM_MAIL_VPS_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             self.assertRaises(AssertionError):
            checkout_source_family(self.root)


    def test_trusted_control_cannot_include_application_changes(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.candidate):
            self.git('commit', '--allow-empty', '-qm', 'candidate after bad trust anchor')
            self.git('update-ref', 'refs/remotes/origin/main', self.candidate)
            with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                self.verify()


    def test_application_worktree_and_staged_mutations_cannot_hide(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        self.git('update-index', '--assume-unchanged', name)
        path.write_bytes(b'hidden worktree edit\n')
        with self.assertRaises(AssertionError):
            checkout_source_family(self.root)
        path.write_bytes(original)
        self.git('update-index', '--no-assume-unchanged', name)
        path.write_bytes(b'hidden index edit\n')
        self.git('add', name)
        path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'index differs'):
            checkout_source_family(self.root)


    def test_full_family_rejects_symlink_hardlink_and_untracked_addition(self):
        name = self.files[0]
        path = self.root / name
        original = path.read_bytes()
        for mutation in ('symlink', 'hardlink'):
            with self.subTest(mutation=mutation):
                path.unlink()
                if mutation == 'symlink':
                    path.symlink_to(self.root / 'package.json')
                else:
                    os.link(self.root / 'package.json', path)
                with self.assertRaises(AssertionError):
                    checkout_source_family(self.root)
                path.unlink()
                self.write(name, original)
        self.write('unknown.txt', 'untracked file\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'):
            checkout_source_family(self.root)


    def test_complete_staged_family_rejects_every_mutation_and_extra_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_files = {name: checkout_git(self.root, 'show', self.control + ':' + name)
                         for name in self.staged}
            for name, raw in raw_files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
            self.assertEqual(checkout_source_family(root)['ops/vps/code-release.py'], self.blob(self.operator))
            for name in raw_files:
                for mutation in ('bytes', 'missing', 'mode'):
                    # Only the test file is necessarily unable to authenticate itself.
                    if name == 'ops/vps/test_code_release.py' and mutation == 'bytes':
                        continue
                    with self.subTest(name=name, mutation=mutation):
                        path = root / name
                        if mutation == 'bytes': path.write_bytes(b'unreviewed staged file\n')
                        elif mutation == 'missing': path.unlink()
                        else: path.chmod(0o755)
                        with self.assertRaises(AssertionError):
                            family = checkout_source_family(root)
                            if family is None:
                                staged_family_pins(root)
                        path.write_bytes(raw_files[name])
                        path.chmod(0o644)
            (root / 'unknown.txt').write_text('unexpected staged addition\n')
            with self.assertRaisesRegex(AssertionError, 'Unexpected staged'):
                checkout_source_family(root)


    def test_complete_control_and_promotion_families_are_recognized(self):
        self.assertEqual(set(self.verify()), set(self.files) | release.ROOM_MAIL_VPS_CONTROL_FILES | set(self.prerequisites) | set(self.control_prerequisites))
        self.assertEqual(release.migration_plan(self.verify()), [])
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            family = checkout_source_family(self.root)
            self.assertEqual(family['ops/vps/code-release.py'], self.blob(self.operator))
            for name in set(self.files):
                if revision == self.control and name in self.added:
                    self.assertNotIn(name, family)
                else:
                    self.assertEqual(family[name], self.git('rev-parse', revision + ':' + name))


    def test_promotion_keeps_reviewed_snapshot_reachable_without_side_refs(self):
        self.git('merge-base', '--is-ancestor', self.snapshot, self.candidate)
        self.git('merge-base', '--is-ancestor', self.control, self.candidate)
        copy_only = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-m', 'same bytes without snapshot ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy_only)


    def test_unlisted_files_dependencies_workflows_and_schema_are_rejected(self):
        for name in ('tests/unreviewed.test.ts', 'runtime/vps/worker.mjs', 'drizzle/9999_extra.sql',
                     '.github/workflows/candidate-checks.yml', *self.prerequisites, *self.control_prerequisites,
                     *release.ROOM_MAIL_VPS_DEPENDENCY_BLOBS):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                self.write(name, 'unreviewed bytes\n')
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)


    def test_every_application_and_control_mode_change_is_rejected(self):
        for name in {*self.files, *self.prerequisites, *self.control_prerequisites, *release.ROOM_MAIL_VPS_CONTROL_FILES}:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.candidate)
                (self.root / name).chmod(0o755)
                self.commit()
                with self.assertRaises(release.ReleaseError): self.verify()
                with self.assertRaises(AssertionError): checkout_source_family(self.root)


    def test_wrong_baseline_snapshot_or_input_inventory_is_rejected(self):
        for name in ('ROOM_MAIL_VPS_RELEASE_BASE_TREE', 'ROOM_MAIL_VPS_APP_TREE', 'ROOM_MAIL_VPS_PREREQUISITE_TREE', 'ROOM_MAIL_VPS_APP_ORIGIN_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in self.inputs:
            with self.subTest(path=name), patch.dict(release.ROOM_MAIL_VPS_APPLICATION_INPUTS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'application input'): self.verify()
        with patch.dict(release.ROOM_MAIL_VPS_APPLICATION_BLOBS, {'tests/extra.mjs': 'f' * 40}):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
        for name in release.ROOM_MAIL_VPS_DEPENDENCY_BLOBS:
            with patch.dict(release.ROOM_MAIL_VPS_DEPENDENCY_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'remain unchanged'): self.verify()


    def test_self_unmerged_and_same_tree_snapshot_controls_are_rejected(self):
        for trusted in (self.live, self.prerequisite, self.origin, self.snapshot, self.candidate):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises(release.ReleaseError): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.live)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', 'origin/main', self.control)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()
        self.git('tag', '-d', 'origin/main')
        self.git('update-ref', 'refs/remotes/origin/main', self.control)
        snapshot = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                            '-p', self.live, '-m', 'same tree without control ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(snapshot)


    def test_scope_schema_rejects_controls_dependencies_and_forbidden_application_paths(self):
        for controls in ({'ops/vps/code-release.py'},
                         release.ROOM_MAIL_VPS_CONTROL_FILES | {'package-lock.json'}):
            with self.subTest(controls=controls), patch.object(release, 'ROOM_MAIL_VPS_CONTROL_FILES', controls):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for dependencies in ({}, {**release.ROOM_MAIL_VPS_DEPENDENCY_BLOBS, 'other.lock': 'f' * 40}):
            with self.subTest(dependencies=dependencies), \
                 patch.object(release, 'ROOM_MAIL_VPS_DEPENDENCY_BLOBS', dependencies):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        for name in ('package-lock.json', 'mobile/package.json', '.github/workflows/new.yml',
                     'runtime/vps/package.json', 'drizzle/9999_extra.sql', 'ops/vps/code-release.py'):
            with self.subTest(path=name), \
                 patch.dict(release.ROOM_MAIL_VPS_APPLICATION_BLOBS, {name: 'f' * 40}), \
                 patch.dict(release.ROOM_MAIL_VPS_APPLICATION_INPUTS, {name: None}):
                with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
        application = {name: blob for name, blob in self.pins.items() if name != self.files[0]}
        inputs = {name: blob for name, blob in self.inputs.items() if name != self.files[0]}
        with patch.object(release, 'ROOM_MAIL_VPS_APPLICATION_BLOBS', application), \
             patch.object(release, 'ROOM_MAIL_VPS_APPLICATION_INPUTS', inputs):
            with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                self.verify()


    def test_controls_only_baseline_rejects_any_application_dependency_or_workflow_change(self):
        for name in (self.files[0], *release.ROOM_MAIL_VPS_DEPENDENCY_BLOBS,
                     '.github/workflows/candidate-checks.yml'):
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.write(name, 'unreviewed control-side change\n')
                control = self.commit()
                candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                     '-p', self.candidate, '-p', control, '-m', 'retain exact candidate bytes')
                self.git('checkout', '-q', candidate)
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify()
                self.git('update-ref', 'refs/remotes/origin/main', self.control)


    def test_both_controls_must_change_and_remain_identical_in_promotion(self):
        for name in release.ROOM_MAIL_VPS_CONTROL_FILES:
            with self.subTest(path=name):
                self.git('checkout', '-q', self.control)
                self.git('checkout', self.live, '--', name)
                control = self.commit()
                self.git('merge', '--no-ff', '--no-commit', self.snapshot)
                candidate = self.commit()
                self.git('update-ref', 'refs/remotes/origin/main', control)
                with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
                    with self.assertRaisesRegex(release.ReleaseError, 'trusted controls'):
                        self.verify(candidate)
                self.git('update-ref', 'refs/remotes/origin/main', self.control)


    def test_every_output_pin_is_required_independently_of_the_snapshot_tree(self):
        for name in self.files:
            with self.subTest(path=name), \
                 patch.dict(release.ROOM_MAIL_VPS_APPLICATION_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'original reviewed source'):
                    self.verify()


    def test_controls_index_edits_cannot_hide_behind_restored_worktree_bytes(self):
        for revision in (self.control, self.candidate):
            for name in (*release.ROOM_MAIL_VPS_CONTROL_FILES, *self.prerequisites, *self.control_prerequisites):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    original = (self.root / name).read_bytes()
                    self.write(name, 'hidden staged control change\n')
                    self.git('add', name)
                    self.write(name, original)
                    with self.assertRaisesRegex(AssertionError, 'index differs'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_snapshot_with_matching_tree_but_without_baseline_ancestry_is_rejected(self):
        snapshot = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                            '-m', 'unrelated snapshot with matching bytes')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', snapshot, '-m', 'include unrelated source')
        self.git('checkout', '-q', candidate)
        with patch.object(release, 'ROOM_MAIL_VPS_APP_SNAPSHOT', snapshot):
            with self.assertRaises(subprocess.CalledProcessError):
                self.verify()


    def test_family_dispatch_uses_room_mail_vps_before_historical_room_mail_focus(self):
        with patch(__name__ + '.room_mail_focus_source_family', side_effect=AssertionError('old family selected')):
            self.assertEqual(checkout_source_family(self.root)['ops/vps/code-release.py'], self.blob(self.operator))
        with patch.object(release, 'reviewed_room_mail_focus_application_blobs',
                          side_effect=AssertionError('old admission selected')):
            self.assertEqual(set(self.verify()), set(self.files) | release.ROOM_MAIL_VPS_CONTROL_FILES | set(self.prerequisites) | set(self.control_prerequisites))


    def test_executing_room_mail_vps_tests_cannot_fall_back_to_an_older_operator_family(self):
        self.git('checkout', '-q', self.control)
        self.write('ops/vps/code-release.py', 'historical operator bytes\n')
        self.git('add', 'ops/vps/code-release.py')
        with patch.object(sys.modules[__name__], 'ROOM_MAIL_VPS_TEST_FILE',
                          (self.root / 'ops/vps/test_code_release.py').resolve()), \
             patch(__name__ + '.room_mail_focus_source_family', return_value={'old': 'accepted'}) as old_family:
            with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                checkout_source_family(self.root)
            old_family.assert_not_called()


    def test_staged_deletions_restored_as_untracked_exact_files_are_rejected(self):
        existing_application = next(name for name in self.files if name not in self.added)
        for revision in (self.control, self.candidate):
            for name in (existing_application, *release.ROOM_MAIL_VPS_CONTROL_FILES):
                with self.subTest(revision=revision, path=name):
                    self.git('checkout', '-q', revision)
                    self.git('rm', '--cached', name)
                    with self.assertRaisesRegex(AssertionError, 'full inventory'):
                        checkout_source_family(self.root)
                    self.git('reset', '--hard', revision)


    def test_normal_main_merge_accepts_original_control_ancestor(self):
        merged = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                          '-p', self.prerequisite, '-p', self.control, '-m', 'normal merge of reviewed controls')
        self.git('update-ref', 'refs/remotes/origin/main', merged)
        self.assertEqual(self.git('show', '-s', '--format=%P', self.control), self.prerequisite)
        self.assertEqual(self.git('show', '-s', '--format=%P', merged).split(), [self.prerequisite, self.control])
        self.assertEqual(self.git('show', '-s', '--format=%P', self.candidate).split(),
                         [self.control, self.snapshot])
        self.assertEqual(set(self.verify()), set(self.files) | release.ROOM_MAIL_VPS_CONTROL_FILES | set(self.prerequisites) | set(self.control_prerequisites))
        # The branch commit C is the trust anchor, not a newer same-tree main merge
        # which is deliberately absent from the already-published P ancestry.
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=merged):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()


    def test_missing_invalid_and_unrelated_same_tree_controls_are_rejected(self):
        for trusted in ('', 'HEAD', 'a' * 12, 'A' * 40, 'f' * 40):
            with self.subTest(trusted=trusted), patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted):
                with self.assertRaises((release.ReleaseError, subprocess.CalledProcessError)):
                    self.verify()
        unrelated = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                             '-m', 'unrelated same-tree controls')
        self.git('update-ref', 'refs/remotes/origin/main', unrelated)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()


    def test_same_tree_wrong_baseline_and_source_commit_identities_are_rejected(self):
        wrong_base = self.git('commit-tree', self.git('rev-parse', self.live + '^{tree}'),
                              '-m', 'same-tree wrong live identity')
        with self.assertRaisesRegex(release.ReleaseError, 'live or snapshot tree'):
            release.reviewed_room_mail_vps_application_blobs(wrong_base, self.candidate)
        wrong_source = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                                '-p', self.live, '-m', 'same-tree unreviewed source identity')
        impostor = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                           '-p', self.control, '-p', wrong_source, '-m', 'wrong source ancestry')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(impostor)


    def test_operational_prerequisite_scope_input_and_output_are_exact(self):
        for field in ('ROOM_MAIL_VPS_PREREQUISITE_INPUTS', 'ROOM_MAIL_VPS_PREREQUISITE_BLOBS'):
            for values in ({}, {'.github/workflows/other.yml': 'f' * 40}):
                with self.subTest(field=field, values=values), patch.object(release, field, values):
                    with self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'): self.verify()
            with patch.dict(getattr(release, field), {self.prerequisites[0]: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'prerequisite'): self.verify()


    def test_each_operational_prerequisite_rejects_missing_drift_mode_and_partial_control(self):
        for revision in (self.control, self.candidate):
            for name in self.prerequisites:
                for mutation in ('bytes', 'missing', 'mode'):
                    with self.subTest(revision=revision, path=name, mutation=mutation):
                        self.git('checkout', '-q', revision)
                        if mutation == 'bytes': self.write(name, 'unreviewed operational bytes\n')
                        elif mutation == 'missing': self.git('rm', name)
                        else: (self.root / name).chmod(0o755)
                        changed = self.commit()
                        with self.assertRaises(AssertionError): checkout_source_family(self.root)
                        if revision == self.control:
                            candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                                 '-p', self.candidate, '-p', changed, '-m', 'unreviewed operational controls')
                            self.git('checkout', '-q', candidate)
                            self.git('update-ref', 'refs/remotes/origin/main', changed)
                        with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed if revision == self.control else self.control):
                            with self.assertRaises(release.ReleaseError): self.verify()
                        self.git('update-ref', 'refs/remotes/origin/main', self.control)


    def test_same_tree_prerequisite_without_reviewed_identity_or_ancestry_is_rejected(self):
        unrelated = self.git('commit-tree', self.git('rev-parse', self.prerequisite + '^{tree}'),
                             '-p', self.live, '-m', 'unreviewed same-tree operational identity')
        with patch.object(release, 'ROOM_MAIL_VPS_PREREQUISITE_SNAPSHOT', unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()
        control = self.git('commit-tree', self.git('rev-parse', self.control + '^{tree}'),
                           '-p', self.live, '-m', 'copied controls without operational ancestry')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', control, '-p', self.snapshot, '-m', 'source ancestry cannot authorize copied controls')
        self.git('checkout', '-q', candidate)
        self.git('update-ref', 'refs/remotes/origin/main', control)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=control):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()


    def test_release_workflow_activation_and_handover_names_remain_frozen(self):
        for name in ('.github/workflows/tickets-code-release.yml', 'worker/handover.ts',
                     'db/schema.ts', 'drizzle/0068_room_host_first_posts.sql',
                     'drizzle/0069_event_host_pass_invitations.sql'):
            self.git('checkout', '-q', self.candidate)
            self.write(name, 'unreviewed activation or schema change\n')
            self.commit()
            with self.assertRaises(release.ReleaseError): self.verify()
            with self.assertRaises(AssertionError): checkout_source_family(self.root)


    def test_original_reviewed_application_ancestry_cannot_be_replaced_by_matching_bytes(self):
        copy_only = self.git('commit-tree', self.git('rev-parse', self.snapshot + '^{tree}'),
                             '-p', self.prerequisite, '-m', 'source without original reviewed app ancestry')
        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                             '-p', self.control, '-p', copy_only, '-m', 'copy-only application promotion')
        with patch.object(release, 'ROOM_MAIL_VPS_APP_SNAPSHOT', copy_only):
            with self.assertRaises(subprocess.CalledProcessError): self.verify(candidate)
        unrelated = self.git('commit-tree', self.git('rev-parse', self.origin + '^{tree}'),
                             '-p', self.live, '-m', 'wrong original application identity')
        with patch.object(release, 'ROOM_MAIL_VPS_APP_ORIGIN', unrelated):
            with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_archive_workflow_input_output_and_scope_are_exact(self):
        for field in ('ROOM_MAIL_VPS_CONTROL_PREREQUISITE_INPUTS', 'ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS'):
            for values in ({}, {'.github/workflows/unreviewed.yml': 'f' * 40}):
                with patch.object(release, field, values), self.assertRaisesRegex(release.ReleaseError, 'inventory or scope'):
                    self.verify()
            for name in self.control_prerequisites:
                with patch.dict(getattr(release, field), {name: 'f' * 40}), self.assertRaisesRegex(release.ReleaseError, 'archive workflow'):
                    self.verify()

    def test_archive_workflow_is_required_unchanged_in_both_controls_and_promotion(self):
        for revision, name in ((revision, name) for revision in (self.control, self.candidate)
                               for name in self.control_prerequisites):
            for mutation in ('missing', 'bytes', 'mode', 'old-version'):
                with self.subTest(revision=revision, mutation=mutation):
                    self.git('checkout', '-q', revision)
                    if mutation == 'missing': self.git('rm', name)
                    elif mutation == 'bytes': self.write(name, 'unreviewed workflow permissions\n')
                    elif mutation == 'mode': (self.root / name).chmod(0o755)
                    else: self.git('checkout', self.live, '--', name)
                    changed = self.commit()
                    with self.assertRaises(AssertionError): checkout_source_family(self.root)
                    if revision == self.control:
                        candidate = self.git('commit-tree', self.git('rev-parse', self.candidate + '^{tree}'),
                                             '-p', self.candidate, '-p', changed, '-m', 'unreviewed workflow controls')
                        self.git('checkout', '-q', candidate)
                        self.git('update-ref', 'refs/remotes/origin/main', changed)
                    with patch.dict(os.environ, BECORE_TRUSTED_BASE=changed if revision == self.control else self.control):
                        with self.assertRaises(release.ReleaseError): self.verify()
                    self.git('update-ref', 'refs/remotes/origin/main', self.control)


class RoomMailVpsDeploymentTests(DeploymentFixture):
    def setUp(self):
        super().setUp()
        baseline = patch.object(release, 'ROOM_MAIL_VPS_RELEASE_BASELINE', OLD)
        baseline.start()
        self.addCleanup(baseline.stop)
        self.proof['changedFiles'] = sorted(set(release.ROOM_MAIL_VPS_APPLICATION_BLOBS)
            | release.ROOM_MAIL_VPS_CONTROL_FILES | set(release.ROOM_MAIL_VPS_PREREQUISITE_BLOBS)
            | set(release.ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS))
        self.refresh_digests()
        self.deployment = self.new_deployment()
        mail = patch.object(release, 'verify_room_mail_vps_service')
        self.mail = mail.start()
        self.addCleanup(mail.stop)

    def test_code_only_preserves_active_private_configuration_exactly(self):
        raw = self.config_before.rstrip()[:-1] + b', "ROOM_HOST_FIRST_POST_ENABLED" : "1", "ROOM_HOST_FIRST_POST_EVENT_SLUG":"puro-exceso-20261024", "ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID":"11111111-1111-4111-8111-111111111111"}\n'
        release.atomic_write(self.deployment.config, raw)
        # The existing active journal binds the current private runtime bytes.
        journal = json.loads(self.deployment.journal.read_bytes())
        journal['configurationHash'] = release.hashlib.sha256(raw).hexdigest()
        release.write_json(self.deployment.journal, journal)
        with patch.object(release, 'verify_first_host_target', side_effect=AssertionError('activation target read')):
            result = self.deployment.transact()
        self.assertEqual(self.deployment.config.read_bytes(), raw)
        self.assertEqual((self.deployment.snapshot / 'config.before').read_bytes(), raw)
        self.assertNotIn('firstHostEnabledRequested', result)
        self.assertFalse(result['cryptoEnabledRequested'])
        self.assertEqual(self.deployment.migrations, [])
        self.assertEqual(self.mail.call_count, 2)

    def test_activation_or_crypto_request_is_rejected_before_mutation(self):
        for flags in ({'enable_crypto': True}, {'enable_first_host': True,
                      'first_host_account_id': '11111111-1111-4111-8111-111111111111'}):
            with self.subTest(flags=tuple(flags)):
                deployment = self.new_deployment(**flags)
                with self.assertRaisesRegex(release.ReleaseError, 'code-only'):
                    deployment.preflight()
                self.assertEqual(deployment.config.read_bytes(), self.config_before)
                self.assertFalse(deployment.snapshot.exists())
                self.assertEqual(self.system.restarts, 0)

    def test_failed_code_only_release_restores_exact_configuration(self):
        self.system.fail = 'public'
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)
        self.assertEqual(self.deployment.migrations, [])
        self.assertEqual(self.mail.call_count, 2)


    def test_mail_prerequisite_failure_refuses_before_snapshot_or_service_mutation(self):
        self.mail.side_effect = release.ReleaseError('Exact mail prerequisite unavailable')
        with self.assertRaisesRegex(release.ReleaseError, 'mail prerequisite'): self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists())
        self.assertFalse(self.deployment.release.exists())
        self.assertEqual(self.system.restarts, 0)
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)

    def test_mail_is_rechecked_immediately_before_application_activation(self):
        self.mail.side_effect = [None, release.ReleaseError('Exact mail prerequisite unavailable')]
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assert_restored()
        self.assertEqual(self.mail.call_count, 2)
        self.assertEqual(self.system.restarts, 1)
        self.assertEqual(self.system.revision, OLD)
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)


class RoomMailVpsPrerequisiteTests(unittest.TestCase):
    def test_exact_helper_load_ignores_import_cache_and_never_runs_its_main(self):
        with patch.dict(sys.modules, {'room_mail_vps_metadata': object()}):
            metadata = release.load_room_mail_vps_inspector()
        self.assertEqual(metadata.CONTAINER, 'becore-tickets-mail')
        self.assertEqual(metadata.STAGE, 'preconditions')
        self.assertTrue(callable(metadata.health))

    def test_helper_bytes_mode_links_missing_and_import_error_fail_closed_without_private_errors(self):
        source = Path(release.__file__).with_name('inspect-mail-service-readonly.py').read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);helper = root / 'inspect-mail-service-readonly.py'
            for mutation in ('bytes', 'mode', 'symlink', 'hardlink', 'missing'):
                with self.subTest(mutation=mutation):
                    if helper.exists() or helper.is_symlink(): helper.unlink()
                    helper.write_bytes(source);helper.chmod(0o644)
                    if mutation == 'bytes': helper.write_bytes(b'raise ValueError("PRIVATE_SENTINEL")')
                    elif mutation == 'mode': helper.chmod(0o755)
                    elif mutation == 'symlink':
                        helper.unlink();helper.symlink_to(root / 'absent-private-file')
                    elif mutation == 'hardlink':
                        other = root / 'linked-copy';other.write_bytes(source);helper.unlink();os.link(other, helper)
                    else: helper.unlink()
                    with patch.object(release, '__file__', str(root / 'code-release.py')):
                        with self.assertRaises(release.ReleaseError) as failure: release.load_room_mail_vps_inspector()
                    self.assertNotIn('PRIVATE_SENTINEL', str(failure.exception))
                    self.assertNotIn(directory, str(failure.exception))

    def inspect(self, *, health=None, marker=None, identity=None, evidence=None, failure=None):
        expected = {'service': 'becore-tickets-mail', 'revision': release.ROOM_MAIL_VPS_MAIL_REVISION,
                    'sendingEnabled': True}
        ident = ['a' * 64, 'sha256:' + 'b' * 64, True, '2026-10-24T17:01:12Z']
        source = {'source_sha256': release.ROOM_MAIL_VPS_MAIL_SOURCE_SHA256,
                  'room_host_post_supported': True, 'event_host_pass_supported': False, 'unknown_kind_count': 0}
        module = types.SimpleNamespace(CONTAINER='becore-tickets-mail', SOURCE_READ='fixed reviewed source read')
        calls = []
        def sequence(name, values):
            iterator = iter(values)
            def call_once(*args):
                calls.append(name)
                if failure == name: raise ValueError('PRIVATE_SENTINEL address@example.invalid')
                return next(iterator)
            return call_once
        module.health = sequence('health', health if health is not None else [expected, expected])
        module.marker = sequence('marker', marker if marker is not None else [release.ROOM_MAIL_VPS_MAIL_REVISION] * 2)
        module.identity = sequence('identity', identity if identity is not None else [ident, ident])
        def command(args):
            calls.append('source')
            self.assertEqual(args, ['docker', 'exec', 'becore-tickets-mail', 'python3', '-B', '-c', module.SOURCE_READ])
            if failure == 'source': raise subprocess.TimeoutExpired(['private command'], 15, output=b'PRIVATE_SENTINEL')
            return 'reviewed public source'
        module.command = command
        module.source_evidence = lambda raw: source if evidence is None else evidence
        with patch.object(release, 'load_room_mail_vps_inspector', return_value=module), \
             patch.object(release.subprocess, 'run', side_effect=AssertionError('unexpected process')), \
             patch.object(release.urllib.request, 'urlopen', side_effect=AssertionError('unexpected network')):
            release.verify_room_mail_vps_service()
        return calls

    def test_exact_service_is_checked_twice_with_fixed_read_only_source_command(self):
        self.assertEqual(self.inspect(), ['identity', 'marker', 'health', 'source', 'health', 'marker', 'identity'])

    def test_wrong_health_revision_or_paused_sending_is_rejected_at_either_boundary(self):
        good = {'service': 'becore-tickets-mail', 'revision': release.ROOM_MAIL_VPS_MAIL_REVISION, 'sendingEnabled': True}
        for value in ({**good, 'sendingEnabled': False}, {**good, 'revision': 'f' * 40},
                      {**good, 'service': 'other'}, {}, None):
            for index in (0, 1):
                health = [good, good];health[index] = value
                with self.subTest(value=value, index=index), self.assertRaises(release.ReleaseError):
                    self.inspect(health=health)

    def test_exact_source_room_only_allowlist_and_unknown_kind_count_are_required(self):
        good = {'source_sha256': release.ROOM_MAIL_VPS_MAIL_SOURCE_SHA256,
                'room_host_post_supported': True, 'event_host_pass_supported': False, 'unknown_kind_count': 0}
        for value in ({**good, 'source_sha256': 'f' * 64}, {**good, 'room_host_post_supported': False},
                      {**good, 'event_host_pass_supported': True}, {**good, 'unknown_kind_count': 1}, {}):
            with self.subTest(value=value), self.assertRaises(release.ReleaseError): self.inspect(evidence=value)

    def test_revision_marker_and_container_replacement_are_rejected(self):
        for marker in (['f' * 40, 'f' * 40], [release.ROOM_MAIL_VPS_MAIL_REVISION, 'f' * 40]):
            with self.assertRaises(release.ReleaseError): self.inspect(marker=marker)
        good = ['a' * 64, 'sha256:' + 'b' * 64, True, '2026-10-24T17:01:12Z']
        for index, value in ((0, 'c' * 64), (1, 'sha256:' + 'd' * 64), (2, False), (3, '2026-10-24T17:02:00Z')):
            changed = list(good);changed[index] = value
            with self.assertRaises(release.ReleaseError): self.inspect(identity=[good, changed])

    def test_errors_have_no_source_identity_private_output_or_command_details(self):
        for stage in ('identity', 'marker', 'health', 'source'):
            with self.subTest(stage=stage), self.assertRaises(release.ReleaseError) as failure:
                self.inspect(failure=stage)
            for private in ('PRIVATE_SENTINEL', 'address@', 'private command'):
                self.assertNotIn(private, str(failure.exception))
            self.assertTrue(failure.exception.__suppress_context__)

    def test_historical_activation_compatibility_rejects_permission_command_and_family_drift(self):
        name = '.github/workflows/tickets-code-release.yml'
        original = historical_node_workflow(name, (Path(__file__).resolve().parents[2] / name).read_bytes())
        family = {'ops/vps/code-release.py': ROOM_MAIL_VPS_OPERATOR_BLOB,
                  name: release.ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS[name]}
        mutations = (original.replace(b'contents: read', b'contents: write', 1),
                     original.replace(b'tar -x', b'tar --wildcards -x', 1),
                     original.replace(b'ops/vps ops/email/mailer.py ', b'ops/vps ', 1),
                     original.replace(b'ops/vps ops/email/mailer.py ', b'ops/vps ops/email/mailer.py extra ', 1))
        self.assertEqual(len(set(mutations)), 4)
        self.assertNotIn(original, mutations)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);path = root / name;path.parent.mkdir(parents=True)
            for raw in (original, *mutations):
                path.write_bytes(raw)
                with patch(__name__ + '.checkout_source_family', return_value=family), \
                     patch.object(sys.modules[__name__], '__file__', str(root / 'ops/vps/test_code_release.py')):
                    case = FirstHostConfigurationTests('test_workflow_activation_is_default_off_step_local_stdin_only')
                    if raw == original:
                        case.test_workflow_activation_is_default_off_step_local_stdin_only()
                    else:
                        with self.assertRaises(AssertionError):
                            case.test_workflow_activation_is_default_off_step_local_stdin_only()
            path.write_bytes(original)
            with patch(__name__ + '.checkout_source_family', return_value={**family, 'ops/vps/code-release.py': 'f' * 40}), \
                 patch.object(sys.modules[__name__], '__file__', str(root / 'ops/vps/test_code_release.py')):
                with self.assertRaises(AssertionError):
                    FirstHostConfigurationTests().test_workflow_activation_is_default_off_step_local_stdin_only()

    def test_workflow_only_adds_required_mailer_archive_and_bounded_test_budget(self):
        root = Path(__file__).resolve().parents[2]
        for name, revision in (('.github/workflows/tickets-release-operator-checks.yml', 'HEAD'),
                               ('.github/workflows/tickets-code-release.yml', '"$OPERATOR_SHA"')):
            raw = historical_node_workflow(name, (root / name).read_bytes())
            anchor = ('git archive ' + revision + ' ops/vps ops/email/mailer.py ').encode()
            self.assertEqual(raw.count(anchor), 1)
            before = raw.replace(anchor, ('git archive ' + revision + ' ops/vps ').encode(), 1)
            if name == '.github/workflows/tickets-release-operator-checks.yml':
                self.assertEqual(before.count(b'    timeout-minutes: 20\n'), 1)
                before = before.replace(b'    timeout-minutes: 20\n', b'    timeout-minutes: 10\n', 1)
            digest = lambda data: release.hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            self.assertEqual(digest(raw), release.ROOM_MAIL_VPS_CONTROL_PREREQUISITE_BLOBS[name])
            self.assertEqual(digest(before), release.ROOM_MAIL_VPS_CONTROL_PREREQUISITE_INPUTS[name])



if __name__ == "__main__":
    unittest.main()
