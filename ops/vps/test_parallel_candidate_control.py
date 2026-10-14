"""Offline adversarial collector tests: local Git objects and fake authenticated API."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("parallel_candidate_control", Path(__file__).with_name("parallel_candidate_control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
NOW = dt.datetime(2026, 10, 14, 8, 0, tzinfo=dt.timezone.utc)
RUN, ATTEMPT, ARTIFACT = 1234, 2, 9876


class FakeVerifier:
    """Model the pure verifier boundary; its receipt tests live in its own suite."""
    def verify_run_jobs(self, run, jobs, workflow, **expected):
        assert expected["source_sha"] == run["head_sha"]
        assert expected["run_id"] == RUN and expected["run_attempt"] == ATTEMPT
        assert expected["repository"] == control.REPOSITORY
        assert expected["workflow_blob"] == control.git_object_id(b"blob", workflow)
        assert expected["audit_trusted_base"] != expected["source_sha"]
        return {job["name"]: job for job in jobs}

    def producer_artifact_id(self, run, jobs, logs, workflow, **expected):
        self.verify_run_jobs(run, jobs, workflow, **expected)
        if set(logs) != {job["id"] for job in jobs} or any(not value.startswith(b"trusted log ") for value in logs.values()):
            raise ValueError("Unauthenticated producer logs")
        return ARTIFACT

    def verify_evidence(self, run, jobs, artifact, logs, workflow, **expected):
        self.producer_artifact_id(run, jobs, logs, workflow, **expected)
        if artifact.get("id") != ARTIFACT or artifact.get("expired") is not False:
            raise ValueError("Artifact differs")
        expiry = dt.datetime.fromisoformat(artifact["expires_at"].replace("Z", "+00:00"))
        if expiry <= expected["now"]:
            raise ValueError("Artifact expired")
        return {"schema": "tickets-parallel-candidate/v2", "run_id": RUN, "run_attempt": ATTEMPT,
                "source_sha": expected["source_sha"], "source_tree": expected["source_tree"],
                "audit_trusted_base": expected["audit_trusted_base"],
                "jobs_sha256": control.digest(control.canonical(jobs)),
                "artifact_sha256": control.digest(control.canonical(artifact)),
                "logs": {str(key): control.digest(value) for key, value in logs.items()}}


class FakeGitHub:
    def __init__(self, candidate):
        repository = {"id": 55, "full_name": control.REPOSITORY, "private": False,
                      "visibility": "public", "fork": False}
        self.repo = repository
        self.run = {"id": RUN, "run_attempt": ATTEMPT, "head_sha": candidate, "path": control.WORKFLOW,
                    "head_branch": control.BRANCH, "event": "push", "status": "completed", "conclusion": "success",
                    "repository": repository.copy(), "head_repository": repository.copy()}
        self.jobs = [{"id": 700 + index, "name": name, "run_id": RUN, "run_attempt": ATTEMPT,
                      "head_sha": candidate, "status": "completed", "conclusion": "success", "steps": []}
                     for index, name in enumerate(sorted(control.JOBS))]
        self.logs = {job["id"]: f"trusted log {job['name']}\n".encode() for job in self.jobs}
        self.artifact = {"id": ARTIFACT, "name": f"browser-build-{RUN}-{ATTEMPT}", "digest": "sha256:" + "a" * 64,
                         "expired": False, "expires_at": "2026-10-15T08:00:00Z", "size_in_bytes": 100,
                         "url": "https://untrusted.invalid/must-not-follow", "workflow_run": {"id": RUN}}
        self.calls, self.streams = [], []
        self.count = len(self.jobs)
        self.denied = False
        self.stream_callback = None
        self.request_run, self.request_attempt = RUN, ATTEMPT

    def repository(self):
        if self.denied:
            raise ValueError("Existing GitHub access denied")
        self.calls.append("repository")
        return copy.deepcopy(self.repo)

    def api(self, suffix):
        self.calls.append(suffix)
        if suffix == f"actions/runs/{self.request_run}/attempts/{self.request_attempt}":
            return copy.deepcopy(self.run)
        if suffix == f"actions/runs/{self.request_run}/attempts/{self.request_attempt}/jobs?per_page=100":
            return {"total_count": self.count, "jobs": copy.deepcopy(self.jobs)}
        if suffix == f"actions/artifacts/{ARTIFACT}":
            return copy.deepcopy(self.artifact)
        raise AssertionError("Unapproved API route: " + suffix)

    def stream(self, suffix, destination, *, max_size):
        self.streams.append((suffix, destination, max_size))
        assert max_size == control.MAX_LOG
        identifier = int(suffix.split("/")[2])
        assert suffix == f"actions/jobs/{identifier}/logs" and identifier in self.logs
        assert str(destination).startswith("/proc/self/fd/")
        with destination.open("xb") as output:
            output.write(self.logs[identifier])
        if self.stream_callback:
            self.stream_callback(destination)


class CollectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.git_temp = tempfile.TemporaryDirectory()
        cls.repository = Path(cls.git_temp.name) / "repo"
        cls.repository.mkdir(mode=0o700)
        cls.git("init", "-q")
        for path in control.CONTROL_PATHS:
            target = cls.repository / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(("reviewed control " + path + "\n").encode())
            target.chmod(0o644)
        (cls.repository / control.WORKFLOW).write_bytes((Path(__file__).resolve().parents[2] / control.WORKFLOW).read_bytes())
        cls.git("add", ".")
        cls.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "reviewed controls")
        cls.baseline = cls.git("rev-parse", "HEAD")
        (cls.repository / "application.txt").write_text("reviewed application\n")
        cls.git("add", ".")
        cls.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "candidate")
        cls.candidate = cls.git("rev-parse", "HEAD")
        cls.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "same tree main")
        cls.source = cls.git("rev-parse", "HEAD")
        cls.git("update-ref", "refs/remotes/origin/main", cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.git_temp.cleanup()

    @classmethod
    def git(cls, *args):
        return subprocess.check_output(["git", "-C", str(cls.repository), *args], stderr=subprocess.DEVNULL,
                                       env={key: value for key, value in os.environ.items() if not key.startswith("GIT_")}).decode().strip()

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.metadata = Path(temporary.name) / "metadata"
        self.metadata.mkdir(mode=0o700)
        self.selection = self.metadata / "parallel-evidence"
        self.client = FakeGitHub(self.candidate)
        self.verifier = FakeVerifier()

    def collect(self, **changes):
        arguments = dict(root=self.repository, source=self.source, candidate=self.candidate,
                         trusted_baseline=self.baseline, run_id=RUN, attempt=ATTEMPT,
                         verifier=self.verifier, now=NOW)
        arguments.update(changes)
        return control.collect_or_verify(self.client, self.selection, **arguments)

    def assert_rejected(self, **changes):
        with self.assertRaises((control.CollectionError, ValueError, OSError)):
            self.collect(**changes)

    def test_collect_then_recheck_never_redownloads(self):
        proof = self.collect()
        self.assertEqual(len(self.client.streams), 5)
        self.assertEqual(self.collect(expected_proof=proof), proof)
        self.assertEqual(len(self.client.streams), 5)
        self.assertEqual(stat.S_IMODE(self.selection.stat().st_mode), 0o700)
        self.assertEqual(len(list(self.selection.iterdir())), 6)
        for path in self.selection.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_nlink, 1)
        self.assertEqual(self.client.calls.count(f"actions/artifacts/{ARTIFACT}"), 2)
        self.assertNotIn(self.client.artifact["url"], self.client.calls)

    def test_actual_commit_controls_tree_and_ancestry(self):
        identity, workflow = control.authenticate_source(self.repository, source=self.source,
                                                        candidate=self.candidate, trusted_baseline=self.baseline)
        self.assertEqual(identity["source_tree"], self.git("rev-parse", self.source + "^{tree}"))
        self.assertEqual(set(identity["controls"]), set(control.CONTROL_PATHS))
        self.assertEqual(control.git_object_id(b"blob", workflow), identity["controls"][control.WORKFLOW])

    def test_invalid_full_sha_and_self_baseline(self):
        for key, value in (("source", self.source[:12]), ("candidate", "origin/main"),
                           ("trusted_baseline", self.source), ("trusted_baseline", self.candidate),
                           ("run_id", True), ("attempt", 0), ("attempt", "1/../../logs")):
            with self.subTest(key=key, value=value):
                self.assert_rejected(**{key: value})
        self.assertFalse(self.client.streams)

    def test_every_control_must_match_exact_blob_and_mode(self):
        real = control.control_blob
        for path in control.CONTROL_PATHS:
            for bad_revision in (self.source, self.candidate):
                def changed(root, revision, requested, *, chosen=path, bad=bad_revision):
                    result = real(root, revision, requested)
                    return ("0" * 40, b"changed") if revision == bad and requested == chosen else result
                with self.subTest(path=path, revision=bad_revision), patch.object(control, "control_blob", side_effect=changed):
                    self.assert_rejected()
        self.assertFalse(self.client.streams)

    def test_git_entry_modes_duplicates_and_path_confusion_fail(self):
        for mode in (b"100755", b"120000", b"160000", b"040000"):
            raw = mode + b" blob " + b"a" * 40 + b"\tcontrol.py\0"
            with self.subTest(mode=mode), patch.object(control, "git", return_value=raw):
                with self.assertRaises(control.CollectionError):
                    control.control_blob(self.repository, self.baseline, "control.py")
        for raw in (b"", b"100644 blob " + b"a" * 40 + b"\tcontrol.py\0" * 2,
                    b"100644 blob " + b"a" * 40 + b"\tother.py\0"):
            with patch.object(control, "git", return_value=raw), self.assertRaises(control.CollectionError):
                control.control_blob(self.repository, self.baseline, "control.py")

    def test_source_must_be_main_ancestor_and_candidate_tree_exact(self):
        real = control.git
        cases = [("merge-base", "--is-ancestor", self.baseline, self.source),
                 ("merge-base", "--is-ancestor", self.baseline, self.candidate),
                 ("merge-base", "--is-ancestor", self.baseline, self.source),
                 ("merge-base", "--is-ancestor", self.source, self.source)]
        for denied in cases:
            def intercepted(root, *args, denied=denied):
                if args == denied:
                    raise control.CollectionError("nonancestor")
                return real(root, *args)
            with patch.object(control, "git", side_effect=intercepted):
                self.assert_rejected()
        real_tree = control.commit_tree
        with patch.object(control, "commit_tree", side_effect=lambda root, revision:
                          "f" * 40 if revision == self.candidate else real_tree(root, revision)):
            self.assert_rejected()

    def test_git_environment_drops_injected_config_and_replace(self):
        with patch.dict(os.environ, {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.sshCommand",
                                     "GIT_CONFIG_VALUE_0": "evil", "GIT_REPLACE_REF_BASE": "refs/evil/"}):
            self.collect()

    def test_run_mismatch_and_incomplete_inventory_fail_before_download(self):
        cases = [("id", RUN + 1), ("run_attempt", ATTEMPT + 1), ("head_sha", self.source),
                 ("path", ".github/workflows/candidate-checks.yml"), ("head_branch", "main"),
                 ("event", "pull_request"), ("status", "in_progress"), ("conclusion", "failure"),
                 ("repository", {"full_name": "attacker/tickets"})]
        for key, value in cases:
            self.client = FakeGitHub(self.candidate)
            self.client.run[key] = value
            with self.subTest(field=key):
                self.assert_rejected()
                self.assertFalse(self.client.streams)
        for count, jobs in ((6, self.client.jobs), (5, self.client.jobs[:4]), (4, self.client.jobs), (True, self.client.jobs)):
            self.client = FakeGitHub(self.candidate)
            self.client.count, self.client.jobs = count, copy.deepcopy(jobs)
            self.assert_rejected()
            self.assertFalse(self.client.streams)

    def test_job_numeric_identity_duplicate_or_failure_rejected_before_logs(self):
        for key, value in (("id", "700"), ("id", True), ("id", "https://evil.invalid/log"),
                           ("id", 701), ("name", "verify"), ("name", "unknown"),
                           ("run_id", RUN + 1), ("run_attempt", ATTEMPT + 1), ("head_sha", self.source),
                           ("status", "queued"), ("conclusion", "skipped")):
            self.client = FakeGitHub(self.candidate)
            self.client.jobs[0][key] = value
            with self.subTest(field=key, value=value):
                self.assert_rejected()
                self.assertFalse(self.client.streams)

    def test_detailed_offline_job_checks_happen_before_download(self):
        with patch.object(self.verifier, "verify_run_jobs", side_effect=ValueError("wrong step inventory")):
            self.assert_rejected()
        self.assertFalse(self.client.streams)

    def test_denied_api_does_not_fallback(self):
        self.client.denied = True
        self.assert_rejected()
        self.assertFalse(self.client.streams)
        self.assertFalse(self.selection.exists())

    def test_changed_run_or_jobs_never_selects_newer_attempt(self):
        self.collect()
        original = copy.deepcopy(self.client.jobs)
        for field, value in (("id", 900), ("run_attempt", 3), ("steps", [{"name": "extra"}])):
            self.client.jobs = copy.deepcopy(original)
            self.client.jobs[0][field] = value
            self.assert_rejected()
        self.client.jobs = original
        self.client.run["updated_at"] = "2026-10-14T09:00:00Z"
        self.assert_rejected()
        self.assertEqual(len(self.client.streams), 5)
        self.assertFalse(any("attempts/3" in x for x in self.client.calls))

    def test_mutated_artifact_metadata_or_expiry_never_redownloads(self):
        self.collect()
        original = copy.deepcopy(self.client.artifact)
        for field, value in (("id", 9877), ("digest", "sha256:" + "b" * 64), ("size_in_bytes", 101),
                             ("expires_at", "2026-10-16T00:00:00Z"), ("expired", True)):
            self.client.artifact = copy.deepcopy(original)
            self.client.artifact[field] = value
            with self.subTest(field=field):
                self.assert_rejected()
        self.client.artifact = original
        self.assert_rejected(now=NOW + dt.timedelta(days=2))
        self.assertEqual(len(self.client.streams), 5)

    def test_wrong_initial_artifact_and_producer_receipt_fail_no_publication(self):
        self.client.artifact["id"] += 1
        self.assert_rejected()
        self.assertFalse(self.selection.exists())
        self.client.artifact["id"] -= 1
        self.client.logs[700] = b"forged receipt\n"
        self.assert_rejected()
        self.assertFalse(self.selection.exists())

    def test_selection_or_log_modified_rejected(self):
        self.collect()
        log = self.selection / "job-700.log"
        original = log.read_bytes()
        log.write_bytes(original + b"changed")
        self.assert_rejected()
        log.write_bytes(original)
        selected = self.selection / "selection.json"
        raw = selected.read_bytes()
        document = json.loads(raw)
        document["proof"]["source_tree"] = "0" * 40
        selected.write_bytes(control.canonical(document))
        self.assert_rejected()
        selected.write_bytes(raw)
        (self.selection / "extra.log").write_text("extra")
        self.assert_rejected()
        self.assertEqual(len(self.client.streams), 5)

    def test_duplicate_noncanonical_json_and_missing_selection_fail(self):
        self.collect()
        selected = self.selection / "selection.json"
        original = selected.read_bytes()
        for raw in (b'{"schema":1,"schema":2}', b'{"value":NaN}', b"[", original.rstrip(b"\n"), b""):
            selected.write_bytes(raw)
            self.assert_rejected()
        selected.unlink()
        self.assert_rejected()
        self.assertEqual(len(self.client.streams), 5)

    def test_expected_proof_mismatch_and_missing_evidence_fail_closed(self):
        proof = self.collect()
        self.assert_rejected(expected_proof={**proof, "run_attempt": 3})
        self.selection = self.metadata / "missing-selection"
        self.assert_rejected(expected_proof=proof)
        self.assertFalse(self.selection.exists())
        self.assertEqual(len(self.client.streams), 5)

    def test_parent_collection_and_file_modes_not_silently_repaired(self):
        self.metadata.chmod(0o755)
        self.assert_rejected()
        self.assertEqual(stat.S_IMODE(self.metadata.stat().st_mode), 0o755)
        self.metadata.chmod(0o700)
        self.collect()
        for path, good in ((self.selection, 0o700), (self.selection / "job-700.log", 0o600),
                           (self.selection / "selection.json", 0o600)):
            path.chmod(0o777)
            self.assert_rejected()
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o777)
            path.chmod(good)
        self.assertEqual(len(self.client.streams), 5)

    def test_symlink_parent_collection_or_log_rejected(self):
        linked = self.metadata.parent / "metadata-link"
        linked.symlink_to(self.metadata, target_is_directory=True)
        self.selection = linked / "parallel-evidence"
        self.assert_rejected()
        self.selection = self.metadata / "parallel-evidence"
        self.selection.symlink_to(self.metadata, target_is_directory=True)
        self.assert_rejected()
        self.selection.unlink()
        self.collect()
        log = self.selection / "job-700.log"
        saved = self.metadata / "saved-log"
        log.rename(saved)
        log.symlink_to(saved)
        self.assert_rejected()
        self.assertEqual(len(self.client.streams), 5)

    def test_hardlinks_empty_oversize_fifo_and_owner_rejected(self):
        self.collect()
        log = self.selection / "job-700.log"
        raw = log.read_bytes()
        link = self.metadata / "linked"
        os.link(log, link)
        self.assert_rejected()
        link.unlink()
        for size in (0, control.MAX_LOG + 1):
            with log.open("wb") as file:
                file.truncate(size)
            self.assert_rejected()
        log.unlink()
        os.mkfifo(log, 0o600)
        self.assert_rejected()
        log.unlink()
        log.write_bytes(raw)
        log.chmod(0o600)
        info = log.stat()
        wrong_owner = SimpleNamespace(st_mode=info.st_mode, st_uid=os.geteuid() + 1, st_nlink=1, st_size=len(raw))
        with self.assertRaises(control.CollectionError):
            control.validate_file(wrong_owner, control.MAX_LOG)
        with patch.object(control.os, "geteuid", return_value=os.geteuid() + 1):
            self.assert_rejected()

    def test_stream_unsafe_mode_link_and_overflow_rejected_before_commit(self):
        for action in (lambda p: p.chmod(0o644), lambda p: os.link(p, self.metadata / "stream-hardlink"),
                       lambda p: p.write_bytes(b"")):
            self.client = FakeGitHub(self.candidate)
            self.client.stream_callback = action
            self.assert_rejected()
            self.assertFalse(self.selection.exists())

    def test_inode_swapped_between_stat_and_open(self):
        self.collect()
        real_open = control.os.open
        log = self.selection / "job-700.log"
        replacement = self.metadata / "replacement"
        replacement.write_bytes(log.read_bytes())
        replacement.chmod(0o600)
        swapped = False
        def raced(path, flags, *args, **kwargs):
            nonlocal swapped
            if path == "job-700.log" and flags & os.O_NOFOLLOW and not swapped:
                swapped = True
                os.replace(replacement, log)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(control.os, "open", side_effect=raced):
            self.assert_rejected()
        self.assertTrue(swapped)

    def test_content_modified_during_fd_read(self):
        self.collect()
        real_read = control.os.read
        log = self.selection / "job-700.log"
        changed = False
        def raced(fd, count):
            nonlocal changed
            result = real_read(fd, count)
            if result.startswith(b"trusted log ") and not changed:
                changed = True
                with log.open("ab") as output:
                    output.write(b"changed")
            return result
        with patch.object(control.os, "read", side_effect=raced):
            self.assert_rejected()
        self.assertTrue(changed)

    def test_parent_replaced_during_download_detected(self):
        moved = self.metadata.parent / "old-metadata"
        def race(_):
            if not moved.exists():
                self.metadata.rename(moved)
                self.metadata.mkdir(mode=0o700)
        self.client.stream_callback = race
        self.assert_rejected()
        self.assertFalse(self.selection.exists())

    def test_atomic_publish_refuses_concurrent_existing_empty_directory(self):
        original = control.rename_new
        def race(parent, old, new):
            os.mkdir(new, mode=0o700, dir_fd=parent.fd)
            return original(parent, old, new)
        with patch.object(control, "rename_new", side_effect=race):
            self.assert_rejected()
        self.assertTrue(self.selection.is_dir())
        self.assertEqual(list(self.selection.iterdir()), [])

    def test_failed_second_verification_preserves_selection_bytes(self):
        self.collect()
        original = {path.name: path.read_bytes() for path in self.selection.iterdir()}
        self.client.artifact["expired"] = True
        self.assert_rejected()
        self.assertEqual(original, {path.name: path.read_bytes() for path in self.selection.iterdir()})

    def test_full_authenticated_collector_and_real_receipt_verifier(self):
        import parallel_candidate as verifier
        from test_parallel_candidate import fixture
        run, jobs, artifact, logs, workflow, expected = fixture()
        tree = self.git("rev-parse", self.source + "^{tree}")
        run["head_sha"] = self.candidate
        artifact["workflow_run"]["head_sha"] = self.candidate
        for job in jobs:
            job["head_sha"] = self.candidate
            if job["name"] == "verify":
                continue
            lines = logs[job["id"]].splitlines()
            prefix, payload = lines[-1].split(verifier.PREFIX.encode(), 1)
            receipt = json.loads(payload)
            receipt.update(source_sha=self.candidate, workflow_sha=self.candidate,
                           source_tree=tree, audit_trusted_base=self.baseline)
            lines[-1] = prefix + verifier.PREFIX.encode() + verifier.canonical(receipt).rstrip(b"\n")
            logs[job["id"]] = b"\n".join(lines) + b"\n"
        self.client.run, self.client.jobs = run, jobs
        self.client.artifact, self.client.logs = artifact, logs
        self.client.repo["id"] = run["repository"]["id"]
        self.client.request_run = run["id"]
        proof = self.collect(verifier=verifier, run_id=run["id"])
        self.assertEqual(proof["audit_trusted_base"], self.baseline)
        self.assertEqual(proof["source_tree"], tree)
        self.assertEqual(len(proof["receipts"]), 4)
        self.assertEqual(len(proof["jobs"]), 5)
        self.assertEqual(self.collect(verifier=verifier, run_id=run["id"], expected_proof=proof), proof)
        self.assertEqual(len(self.client.streams), 5)
        self.assert_rejected(verifier=verifier, run_id=run["id"], now=NOW + dt.timedelta(days=2))

    def test_atomic_publish_detects_staging_inode_swap(self):
        original = control.rename_new
        def race(parent, old, new):
            os.rename(old, old + "-original", src_dir_fd=parent.fd, dst_dir_fd=parent.fd)
            os.mkdir(old, mode=0o700, dir_fd=parent.fd)
            return original(parent, old, new)
        with patch.object(control, "rename_new", side_effect=race):
            self.assert_rejected()
        self.assertTrue(self.selection.is_dir())
        self.assertEqual(list(self.selection.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
