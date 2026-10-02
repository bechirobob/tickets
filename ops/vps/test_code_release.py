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
import textwrap
import unittest
from unittest.mock import call, patch

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


class DeploymentFixture(unittest.TestCase):
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
        return [{"name": "verify", "conclusion": "success", "steps": [
            {"name": name, "conclusion": "success", "status": "completed"} for name in (
                "Prepare verified runtime without development dependencies", "Publish verified private runtime release")]},
            {"name": "handoff", "conclusion": "success"}]

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
                    if blob == specification["blob"]:
                        self.assertEqual(release.vetted_changes(OLD, NEW), [name])
                    else:
                        with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
                            release.vetted_changes(OLD, NEW)

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
            with patch.dict(os.environ, GITHUB_REF="refs/heads/main"), patch.object(release.subprocess, "run"), patch("builtins.print"), patch.object(release, "verify_runtime_transport", return_value={"verified": True}) as transport:
                with patch.object(release, "git", side_effect=[NEW, "", TREE, TREE, "tests/new-test.ts"]):
                    release.verify_ci(args)
                self.assertEqual(json.loads((root / "proof.json").read_text())["archiveSha256"], release.digest_file(archive))
                transport.assert_called_once_with(archive, NEW, TREE, runtime)
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


class RuntimeTransportWorkflowTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[2]

    def test_reviewed_transport_source_pins_match_the_staged_bytes(self):
        for name in (".github/workflows/candidate-checks.yml", ".github/workflows/vps-runtime.yml",
                     ".github/workflows/tickets-release-operator-checks.yml", ".github/workflows/tickets-code-release.yml",
                     "ops/vps/runtime_release.py", "ops/vps/candidate_evidence.py",
                     "ops/vps/test_runtime_release.py", "ops/vps/test_candidate_evidence.py"):
            content = (self.root / name).read_bytes()
            digest = release.hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
            self.assertEqual(release.REVIEWED_APPLICATION_BLOBS[name], digest, name)

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

    def test_private_publisher_is_main_only_and_only_privileged_job(self):
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

    def test_consumer_uses_attempt_bound_private_release_without_write_permission(self):
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
        self.assertIn("if: github.ref == 'refs/heads/main' && !inputs.inspect_failed_release", self.job("release"))
        self.assertIn("if: github.ref == 'refs/heads/main' && inputs.inspect_failed_release", self.job("inspect_failure"))
        self.assertIn("needs: release", self.job("retired_preview"))
        self.assertNotIn("always()", self.job("retired_preview").split("steps:", 1)[0])
        for main in (False, True):
            for inspect in (False, True):
                release_runs, inspect_runs = main and not inspect, main and inspect
                self.assertFalse(release_runs and inspect_runs)
                self.assertEqual(release_runs or inspect_runs, main)

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


if __name__ == "__main__":
    unittest.main()
