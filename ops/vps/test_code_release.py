"""Filesystem/service mocks only: these tests never contact a VPS or provider."""
import argparse
import copy
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("code_release", Path(__file__).with_name("code-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
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
        return (403 if path.startswith("/api/admin/") else 200), b""

    def application_uid(self):
        return os.geteuid()

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


class DeploymentTests(unittest.TestCase):
    def setUp(self):
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
                      "sourceTree": TREE, "candidateTree": TREE}
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
                archive.addfile(extra)

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

    def test_archive_escaping_symlink_rejected(self):
        member = tarfile.TarInfo("escape")
        member.type = tarfile.SYMTYPE
        member.linkname = "/etc"
        self.make_archive(extra=member)
        self.refresh_digests()
        with self.assertRaises(tarfile.FilterError):
            self.deployment.transact()
        self.assert_restored()

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

    def test_preview_failure_does_not_require_preview_on_old_release(self):
        request = self.system.request
        def unavailable(path, public=False):
            if path == "/checkout-preview":
                return 404, b""
            return request(path, public)
        with patch.object(self.system, "request", side_effect=unavailable):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                self.deployment.transact()
        self.assert_restored()

    def test_smoke_checks_never_request_canceled_paths(self):
        self.deployment.transact()
        self.assertNotIn("/scan", [path for _, path, _ in self.system.requests])
        self.assertNotIn("/my-nights", [path for _, path, _ in self.system.requests])


class VerifierTests(unittest.TestCase):
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
        run = {"status": "completed", "conclusion": "success", "head_sha": NEW,
               "path": ".github/workflows/vps-runtime.yml", "head_branch": "main", "event": "push",
               "repository": {"full_name": "owner/tickets"}, "head_repository": {"full_name": "owner/tickets"}}
        release.verify_run(run, workflow="vps-runtime.yml", source=NEW, repository="owner/tickets")
        for key, value in (("status", "in_progress"), ("conclusion", "failure"), ("head_sha", OLD),
                           ("head_branch", "feature"), ("event", "pull_request"), ("path", "wrong"),
                           ("head_repository", {"full_name": "fork/tickets"})):
            with self.subTest(key=key), self.assertRaises(release.ReleaseError):
                release.verify_run(dict(run, **{key: value}), workflow="vps-runtime.yml", source=NEW, repository="owner/tickets")

    def test_all_browser_jobs_and_actual_crypto_steps_required(self):
        runtime = [{"name": name, "conclusion": "success"} for name in ("verify", "handoff")]
        candidate = [{"name": "verify (" + browser + ")", "conclusion": "success", "steps": [
            {"name": "Verify every browser journey before release", "conclusion": "success"},
            {"name": "Verify opt-in USDC checkout without provider traffic", "conclusion": "success"}]
        } for browser in release.BROWSERS]
        release.verify_jobs(runtime, candidate)
        with self.assertRaises(release.ReleaseError):
            release.verify_jobs(runtime, candidate[:2])
        skipped = copy.deepcopy(candidate)
        skipped[0]["steps"][1]["conclusion"] = "skipped"
        with self.assertRaises(release.ReleaseError):
            release.verify_jobs(runtime, skipped)
        with self.assertRaises(release.ReleaseError):
            release.verify_jobs(runtime[:1], candidate)

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

    def test_package_scripts_and_direct_dependencies_cannot_change(self):
        before = {"scripts": {"test": "real-test"}, "dependencies": {"runtime": "1"}, "overrides": {"fast-uri": "3.1.7"}}
        after = dict(before, overrides={"fast-uri": "3.1.8"})
        with patch.object(release, "git", side_effect=["package.json", json.dumps(before), json.dumps(after)]), patch.object(release.subprocess, "run"):
            release.vetted_changes(OLD, NEW)
        after = dict(after, scripts={"test": "true"})
        with patch.object(release, "git", side_effect=["package.json", json.dumps(before), json.dumps(after)]), patch.object(release.subprocess, "run"):
            with self.assertRaises(release.ReleaseError):
                release.vetted_changes(OLD, NEW)

    def test_full_ci_tree_equivalence_and_artifact_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = {"id": 123, "status": "completed", "conclusion": "success", "head_sha": NEW,
                       "path": ".github/workflows/vps-runtime.yml", "head_branch": "main", "event": "push",
                       "repository": {"full_name": "owner/tickets"}, "head_repository": {"full_name": "owner/tickets"}}
            candidate = dict(runtime, id=456, path=".github/workflows/candidate-checks.yml", event="pull_request", head_sha=OLD)
            runtime_jobs = [{"name": name, "conclusion": "success"} for name in ("verify", "handoff")]
            candidate_jobs = [{"name": "verify (" + browser + ")", "conclusion": "success", "steps": [
                {"name": "Verify every browser journey before release", "conclusion": "success"},
                {"name": "Verify opt-in USDC checkout without provider traffic", "conclusion": "success"}]
            } for browser in release.BROWSERS]
            for name, value in (("runtime", runtime), ("candidate", candidate),
                                ("runtime-jobs", runtime_jobs), ("candidate-jobs", candidate_jobs)):
                release.write_json(root / (name + ".json"), value)
            archive = root / "tickets-vps-runtime.tar.gz"
            archive.write_bytes(b"test archive")
            checksum = root / "tickets-vps-runtime.tar.gz.sha256"
            checksum.write_text(release.digest_file(archive) + "  tickets-vps-runtime.tar.gz\n")
            args = argparse.Namespace(source=NEW, expected=ORIGINAL, repository="owner/tickets", metadata=str(root),
                                      runtime_run="123", candidate_run="456", archive=str(archive), output=str(root / "proof.json"))
            with patch.dict(os.environ, GITHUB_REF="refs/heads/main"), patch.object(release.subprocess, "run"), patch("builtins.print"):
                with patch.object(release, "git", side_effect=[NEW, "", TREE, TREE, "tests/new-test.ts"]):
                    release.verify_ci(args)
                self.assertEqual(json.loads((root / "proof.json").read_text())["archiveSha256"], release.digest_file(archive))
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


if __name__ == "__main__":
    unittest.main()
