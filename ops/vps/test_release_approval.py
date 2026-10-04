"""One-success approval checks use temporary files and a fake service only."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release_fixture", Path(__file__).with_name("test_code_release.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
release = fixture.release
Approval = release.AuditReleaseApproval
NOW = "2026-10-04T15:00:00Z"


def approved_proof(source="2" * 40, tree="4" * 40):
    approval = {"id": Approval.ID, "approvedAt": Approval.APPROVED_AT,
                "expiresAt": Approval.EXPIRES_AT, "source": source, "sourceTree": tree,
                "expectedActive": Approval.EXPECTED_ACTIVE}
    return {"source": source, "sourceTree": tree, "expectedActive": Approval.EXPECTED_ACTIVE,
            "dependencyAudit": {"status": "known-advisory-exception"}, "auditRelease": approval}


class ApprovalStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        clock = patch.object(Approval, "now", return_value=NOW)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.proof = approved_proof()
        self.approval = self.new_approval()

    def new_approval(self, proof=None, run="123", attempt="1"):
        return Approval(self.root, proof or self.proof, run, attempt)

    def test_exact_approval_and_current_source_tree_are_required(self):
        for field in ("id", "approvedAt", "expiresAt", "source", "sourceTree", "expectedActive"):
            proof = copy.deepcopy(self.proof)
            proof["auditRelease"][field] = "unapproved"
            with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                self.new_approval(proof)
        for key, value in (("auditRelease", None), ("source", "3" * 40),
                           ("sourceTree", "5" * 40), ("expectedActive", "1" * 40)):
            proof = {**self.proof, key: value}
            with self.subTest(key=key), self.assertRaises(release.ReleaseError):
                self.new_approval(proof)
        proof = copy.deepcopy(self.proof)
        proof["auditRelease"]["extraPermission"] = True
        with self.assertRaises(release.ReleaseError):
            self.new_approval(proof)

    def test_utc_window_start_is_inclusive_and_expiry_exclusive(self):
        for now, accepted in (("2026-10-04T14:50:07Z", False),
                              (Approval.APPROVED_AT, True),
                              ("2026-10-05T14:50:07Z", True),
                              (Approval.EXPIRES_AT, False)):
            self.clock.return_value = now
            with self.subTest(now=now):
                if accepted:
                    self.approval.check_available()
                else:
                    with self.assertRaisesRegex(release.ReleaseError, "UTC window"):
                        self.approval.check_available()
        self.assertFalse(self.approval.path.exists())

    def test_success_persists_private_identity_and_consumption(self):
        self.approval.reserve()
        reserved = self.approval.read()
        self.assertEqual(reserved, {"version": 1, **self.proof["auditRelease"], "runId": "123",
                                    "attempt": "1", "phase": "reserved", "reservedAt": NOW})
        self.assertEqual(self.approval.path.name, "scanner-session-release-20261004.json")
        self.assertEqual(stat.S_IMODE(self.approval.path.stat().st_mode), 0o600)
        self.assertEqual(self.approval.path.stat().st_uid, os.geteuid())
        self.approval.consume()
        self.assertEqual(self.approval.read(), {**reserved, "phase": "consumed", "completedAt": NOW})

    def test_success_cannot_be_repeated_or_rebound_to_sibling_source(self):
        self.approval.reserve()
        self.approval.consume()
        with self.assertRaises(release.ReleaseError):
            self.approval.consume()
        consumed = self.approval.path.read_bytes()
        for proof, run, attempt in ((self.proof, "123", "1"), (self.proof, "123", "2"),
                                     (approved_proof("3" * 40), "456", "1"),
                                     (approved_proof(tree="5" * 40), "456", "1")):
            with self.subTest(source=proof["source"], run=run, attempt=attempt):
                with self.assertRaisesRegex(release.ReleaseError, "already has state"):
                    self.new_approval(proof, run, attempt).reserve()
                self.assertEqual(self.approval.path.read_bytes(), consumed)

    def test_scanner_grant_never_alters_or_clears_the_consumed_full_audit_state(self):
        previous = self.root / "full-audit-release-20261004.json"
        consumed = b'{"id":"tickets-full-audit-20261004","phase":"consumed"}\n'
        release.atomic_write(previous, consumed)
        self.assertNotEqual(self.approval.path, previous)
        self.approval.reserve()
        self.approval.consume()
        self.approval.failed()
        self.assertEqual(self.approval.read()["phase"], "consumed")
        self.assertEqual(previous.read_bytes(), consumed)

    def test_full_audit_grant_cannot_authorize_the_scanner_source(self):
        proof = copy.deepcopy(self.proof)
        proof["auditRelease"].update(id="tickets-full-audit-20261004",
            approvedAt="2026-10-04T01:12:40Z", expiresAt="2026-10-05T01:12:40Z",
            expectedActive="42bbaa419f796ca9e2382a6e71c9831343363267")
        with self.assertRaisesRegex(release.ReleaseError, "exact one-success audit approval"):
            self.new_approval(proof)
        self.assertFalse(self.approval.path.exists())

    def test_interrupted_failed_unknown_and_corrupt_state_block_new_invocations(self):
        for raw in (b"", b"{", b"null", b'{"phase":"reserved"}', b'{"phase":"pending"}',
                    b'{"phase":"unknown"}', b'{"phase":"failed"}', b'{"phase":"consumed"}'):
            with self.subTest(raw=raw):
                release.atomic_write(self.approval.path, raw)
                with self.assertRaisesRegex(release.ReleaseError, "already has state"):
                    self.new_approval().reserve()
                self.assertEqual(self.approval.path.read_bytes(), raw)

    def test_interrupted_reservation_cannot_resume_even_same_invocation(self):
        self.approval.reserve()
        with self.assertRaises(release.ReleaseError):
            self.new_approval().consume()
        with self.assertRaisesRegex(release.ReleaseError, "already has state"):
            self.new_approval().reserve()
        self.assertEqual(self.approval.read()["phase"], "reserved")

    def test_reservation_never_overwrites_state_created_after_availability_check(self):
        check = self.approval.check_available
        external = b'{"phase":"pending","runId":"456"}'

        def compete():
            check()
            release.atomic_write(self.approval.path, external)

        with patch.object(self.approval, "check_available", side_effect=compete):
            with self.assertRaises(FileExistsError):
                self.approval.reserve()
        self.assertEqual(self.approval.path.read_bytes(), external)

    def test_state_modes_links_owner_and_parent_permissions_fail_closed(self):
        self.approval.reserve()
        self.approval.path.chmod(0o640)
        with self.assertRaisesRegex(release.ReleaseError, "Unsafe private"):
            self.approval.consume()
        self.approval.path.chmod(0o600)
        original_fstat = os.fstat

        def wrong_owner(fd):
            values = list(original_fstat(fd))
            values[4] += 1
            return os.stat_result(values)

        with patch.object(release.os, "fstat", side_effect=wrong_owner):
            with self.assertRaisesRegex(release.ReleaseError, "Unsafe private"):
                self.approval.consume()
        target = self.root / "other-state.json"
        self.approval.path.rename(target)
        self.approval.path.symlink_to(target)
        before = target.read_bytes()
        with self.assertRaisesRegex(release.ReleaseError, "already has state"):
            self.new_approval().reserve()
        with self.assertRaises(OSError):
            self.approval.consume()
        self.assertEqual(target.read_bytes(), before)
        self.approval.path.unlink()
        os.link(target, self.approval.path)
        with self.assertRaisesRegex(release.ReleaseError, "Unsafe private"):
            self.approval.consume()
        self.root.chmod(0o777)
        with self.assertRaisesRegex(release.ReleaseError, "protected directory"):
            self.new_approval().reserve()

    def test_reservation_binding_or_bytes_cannot_change_before_consumption(self):
        self.approval.reserve()
        record = self.approval.read()
        for field, value in (("id", "other-approval"), ("source", "3" * 40), ("sourceTree", "5" * 40),
                             ("expectedActive", "1" * 40), ("runId", "456"), ("attempt", "2"),
                             ("phase", "consumed")):
            with self.subTest(field=field):
                altered = {**record, field: value}
                release.write_json(self.approval.path, altered)
                with self.assertRaisesRegex(release.ReleaseError, "reservation drifted"):
                    self.approval.consume()
                self.assertEqual(self.approval.read(), altered)
        for raw in (b"{", b'{"phase":"reserved","phase":"consumed"}'):
            release.atomic_write(self.approval.path, raw)
            with self.assertRaises(release.ReleaseError):
                self.approval.consume()
            self.assertEqual(self.approval.path.read_bytes(), raw)

    def test_expiry_after_reservation_prevents_success_and_failed_state_never_retries(self):
        self.approval.reserve()
        self.clock.return_value = Approval.EXPIRES_AT
        with self.assertRaisesRegex(release.ReleaseError, "UTC window"):
            self.approval.consume()
        self.assertEqual(self.approval.read()["phase"], "reserved")
        self.approval.failed()
        self.assertEqual(self.approval.read()["phase"], "failed")
        self.clock.return_value = NOW
        with self.assertRaisesRegex(release.ReleaseError, "already has state"):
            self.new_approval(run="456").reserve()

    def test_expiry_during_reservation_read_is_rechecked_before_success_write(self):
        self.approval.reserve()
        read = self.approval.read

        def expire():
            value = read()
            self.clock.return_value = Approval.EXPIRES_AT
            return value

        with patch.object(self.approval, "read", side_effect=expire):
            with self.assertRaisesRegex(release.ReleaseError, "UTC window"):
                self.approval.consume()
        self.assertEqual(read()["phase"], "reserved")

    def test_reservation_file_or_directory_fsync_failure_leaves_blocking_state(self):
        for fail_at in (1, 2):
            with self.subTest(fsync=fail_at), tempfile.TemporaryDirectory() as directory:
                approval = Approval(Path(directory), self.proof, "123", "1")
                calls = 0
                real_fsync = os.fsync

                def fail(fd):
                    nonlocal calls
                    calls += 1
                    if calls == fail_at:
                        raise OSError("simulated durability failure")
                    real_fsync(fd)

                with patch.object(release.os, "fsync", side_effect=fail):
                    with self.assertRaises(OSError):
                        approval.reserve()
                self.assertTrue(approval.persistence_uncertain)
                self.assertTrue(approval.path.exists())
                approval.failed()
                with self.assertRaisesRegex(release.ReleaseError, "already has state"):
                    Approval(Path(directory), self.proof, "456", "1").reserve()

    def test_uncertain_success_write_is_never_reset_even_after_verified_rollback(self):
        for replace_first in (False, True):
            with self.subTest(replace_first=replace_first), tempfile.TemporaryDirectory() as directory:
                approval = Approval(Path(directory), self.proof, "123", "1")
                approval.reserve()
                write = release.write_json

                def uncertain(path, value):
                    if replace_first:
                        write(path, value)
                    raise OSError("simulated completion failure")

                with patch.object(release, "write_json", side_effect=uncertain):
                    with self.assertRaises(OSError):
                        approval.consume()
                before = approval.path.read_bytes()
                approval.failed()
                self.assertTrue(approval.persistence_uncertain)
                self.assertEqual(approval.path.read_bytes(), before)
                self.assertEqual(approval.read()["phase"], "consumed" if replace_first else "reserved")
                with self.assertRaisesRegex(release.ReleaseError, "already has state"):
                    Approval(Path(directory), self.proof, "456", "1").reserve()

    def test_consumption_directory_fsync_failure_preserves_uncertain_consumed_record(self):
        self.approval.reserve()
        fsync = os.fsync

        def fail_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError("directory durability uncertain")
            fsync(fd)

        with patch.object(release.os, "fsync", side_effect=fail_directory):
            with self.assertRaises(OSError):
                self.approval.consume()
        self.approval.failed()
        self.assertTrue(self.approval.persistence_uncertain)
        self.assertEqual(self.approval.read()["phase"], "consumed")


class DeploymentApprovalTests(unittest.TestCase):
    def setUp(self):
        old = patch.object(fixture, "OLD", Approval.EXPECTED_ACTIVE)
        old.start()
        self.addCleanup(old.stop)
        self.fixture = fixture.DeploymentFixture()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        # Legacy transaction tests may isolate this helper. These tests restore
        # its real implementation and supply the exact production approval.
        real_approval = patch.object(release, "AuditReleaseApproval", Approval)
        real_approval.start()
        self.addCleanup(real_approval.stop)
        clock = patch.object(Approval, "now", return_value=NOW)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.fixture.proof.update(approved_proof())
        self.fixture.refresh_digests()
        self.deployment = self.fixture.deployment
        self.path = self.deployment.journal.parent / Approval.STATE_NAME

    def phase(self):
        return json.loads(self.path.read_bytes())["phase"]

    def clean_release(self, *, grant=False, report=True):
        self.fixture.audit_evidence_patch.stop()
        raw = b'{"auditReportVersion":2,"vulnerabilities":{},"metadata":{"vulnerabilities":{"total":0}}}'
        audit_report = self.fixture.root / "npm-audit.json"
        release.atomic_write(audit_report, raw)
        self.fixture.proof["dependencyAudit"] = {"status": "clean", "npmExitCode": 0,
            "reportSha256": release.hashlib.sha256(raw).hexdigest(), "size": len(raw)}
        if not grant:
            self.fixture.proof.pop("auditRelease")
        self.fixture.refresh_digests()
        self.deployment = self.fixture.new_deployment(audit_report=audit_report if report else None)
        return self.deployment

    def test_verified_clean_release_uses_normal_path_after_exception_expiry_and_consumption(self):
        deployment = self.clean_release()
        self.clock.return_value = Approval.EXPIRES_AT
        previous_state = b'{"phase":"consumed"}'
        release.atomic_write(self.path, previous_state)
        result = deployment.transact()
        self.assertTrue(result["active"])
        self.assertIsNone(deployment.approval)
        self.assertEqual(self.path.read_bytes(), previous_state)
        self.assertEqual((deployment.snapshot / "npm-audit.json").read_bytes(), deployment.audit_raw)

    def test_clean_release_requires_raw_report_and_rejects_any_exception_grant(self):
        deployment = self.clean_release(report=False)
        with self.assertRaisesRegex(release.ReleaseError, "private dependency audit is required"):
            deployment.transact()
        self.assertEqual(self.fixture.system.restarts, 0)
        self.fixture.proof["auditRelease"] = approved_proof()["auditRelease"]
        self.fixture.refresh_digests()
        deployment = self.fixture.new_deployment(audit_report=self.fixture.root / "npm-audit.json")
        with self.assertRaisesRegex(release.ReleaseError, "clean release cannot carry"):
            deployment.transact()
        self.assertEqual(self.fixture.system.restarts, 0)
        self.assertFalse(self.path.exists())

    def test_clean_release_rejects_raw_report_receipt_mismatch(self):
        deployment = self.clean_release()
        release.atomic_write(deployment.audit_report, b'{"unverified":"replacement"}')
        with self.assertRaisesRegex(release.ReleaseError, "differs from verified provenance"):
            deployment.transact()
        self.assertEqual(self.fixture.system.restarts, 0)
        self.assertFalse(self.path.exists())

    def test_unknown_or_missing_audit_status_never_bypasses_exception_guard(self):
        for receipt in (None, {}, {"status": "unknown"}, {"status": ""}):
            self.fixture.proof["dependencyAudit"] = receipt
            self.fixture.refresh_digests()
            with self.subTest(receipt=receipt), self.assertRaisesRegex(release.ReleaseError, "missing or unrecognized"):
                self.fixture.deployment.transact()
            self.assertEqual(self.fixture.system.restarts, 0)
            self.assertFalse(self.path.exists())

    def test_success_is_consumed_after_health_pointer_and_journal_commit(self):
        transition = Approval.transition

        def inspect(approval, phase):
            if phase == "consumed":
                self.assertEqual((self.deployment.home / "current").resolve(), self.deployment.release)
                self.assertEqual(json.loads(self.deployment.journal.read_bytes())["activeRevision"], fixture.NEW)
                self.assertEqual(json.loads((self.deployment.snapshot / "result.json").read_bytes())["phase"], "verified")
                self.assertIn((fixture.NEW, "/healthz", True), self.fixture.system.requests)
            return transition(approval, phase)

        with patch.object(Approval, "transition", autospec=True, side_effect=inspect):
            result = self.deployment.transact()
        self.assertTrue(result["publicVerified"])
        self.assertEqual(self.phase(), "consumed")
        self.assertNotIn(self.path, self.deployment.snapshot.iterdir())

    def test_missing_approval_and_existing_state_never_restart_service(self):
        self.fixture.proof.pop("auditRelease")
        self.fixture.refresh_digests()
        with self.assertRaisesRegex(release.ReleaseError, "exact one-success"):
            self.fixture.deployment.transact()
        self.assertFalse(self.path.exists())
        self.fixture.proof.update(approved_proof())
        self.fixture.refresh_digests()
        release.atomic_write(self.path, b'{"phase":"reserved"}')
        with self.assertRaisesRegex(release.ReleaseError, "already has state"):
            self.fixture.deployment.transact()
        self.assertEqual(self.fixture.system.restarts, 0)

    def test_reservation_failure_prevents_any_candidate_activation(self):
        reserve = Approval.reserve

        def fail(approval):
            with patch.object(release.os, "fsync", side_effect=OSError("disk failure")):
                reserve(approval)

        with patch.object(Approval, "reserve", autospec=True, side_effect=fail):
            with self.assertRaises(OSError):
                self.deployment.transact()
        self.assertEqual(self.fixture.system.restarts, 0)
        self.fixture.assert_restored()
        self.assertTrue(self.path.exists())

    def test_verified_rollback_records_failed_and_preserves_approval_outside_snapshot(self):
        self.fixture.system.fail = "public"
        with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
            self.deployment.transact()
        self.fixture.assert_restored()
        self.assertEqual(self.phase(), "failed")
        self.assertEqual(self.path.parent, self.deployment.snapshot.parent)
        with self.assertRaisesRegex(release.ReleaseError, "already has state"):
            Approval(self.path.parent, self.fixture.proof, "456", "1").reserve()

    def test_unverified_rollback_preserves_reserved_state(self):
        with patch.object(self.fixture.system, "restart", side_effect=RuntimeError("restart failed")):
            with self.assertRaisesRegex(release.ReleaseError, "Rollback verification failed"):
                self.deployment.transact()
        self.assertEqual(self.phase(), "reserved")

    def test_expiry_after_health_or_commit_restores_previous_release(self):
        verify = self.fixture.system.verify_effective_config

        def expire(config):
            verify(config)
            if self.fixture.system.revision == fixture.NEW:
                self.clock.return_value = Approval.EXPIRES_AT

        with patch.object(self.fixture.system, "verify_effective_config", side_effect=expire):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                self.deployment.transact()
        self.fixture.assert_restored()
        self.assertEqual(self.phase(), "failed")

    def test_expiry_immediately_before_activation_never_starts_candidate(self):
        evidence = self.deployment.evidence

        def expire(phase):
            evidence(phase)
            if phase == "activating":
                self.clock.return_value = Approval.EXPIRES_AT

        with patch.object(self.deployment, "evidence", side_effect=expire):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                self.deployment.transact()
        self.fixture.assert_restored()
        self.assertTrue(all(revision == Approval.EXPECTED_ACTIVE
                            for revision, _, _ in self.fixture.system.requests))
        self.assertEqual(self.phase(), "failed")

    def test_external_approval_drift_is_preserved_during_rollback(self):
        evidence = self.deployment.evidence
        external = b'{"phase":"unknown","runId":"456"}'

        def drift(phase):
            evidence(phase)
            if phase == "verified":
                release.atomic_write(self.path, external)

        with patch.object(self.deployment, "evidence", side_effect=drift):
            with self.assertRaisesRegex(release.ReleaseError, "Rollback verification failed"):
                self.deployment.transact()
        self.fixture.assert_restored()
        self.assertEqual(self.path.read_bytes(), external)

    def test_expiry_after_journal_commit_is_rechecked_before_consumption(self):
        evidence = self.deployment.evidence

        def expire(phase):
            evidence(phase)
            if phase == "verified":
                self.clock.return_value = Approval.EXPIRES_AT

        with patch.object(self.deployment, "evidence", side_effect=expire):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                self.deployment.transact()
        self.fixture.assert_restored()
        self.assertEqual(self.phase(), "failed")

    def test_uncertain_consumption_rolls_back_without_resetting_approval(self):
        write = release.write_json

        def fail(path, value):
            write(path, value)
            if path == self.path and value["phase"] == "consumed":
                raise OSError("directory durability uncertain")

        with patch.object(release, "write_json", side_effect=fail):
            with self.assertRaisesRegex(release.ReleaseError, "previous release restored"):
                self.deployment.transact()
        self.fixture.assert_restored()
        self.assertEqual(self.phase(), "consumed")


if __name__ == "__main__":
    unittest.main()
