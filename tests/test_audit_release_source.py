"""Real-Git adversarial tests of the independently anchored audit_release source gate."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verify-audit-release-source.py"
spec = importlib.util.spec_from_file_location("audit_release_source", SCRIPT)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class AuditReleaseSourceFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.run_git("init", "-q")
        self.run_git("config", "user.name", "AuditRelease Gate Test")
        self.run_git("config", "user.email", "audit_release-test@example.invalid")
        self.write("app/audit_release.ts", "original application\n")
        # This retired grant uses its historical lock, never today's dependencies.
        lock_blob = "759d34af76287e214f03def74be98ddefb33780a"
        self.assertEqual(source.LOCK_BLOB, lock_blob)
        lock = (SCRIPT.parents[1] / "package-lock.json").read_bytes()
        if source.object_id(b"blob", lock) != lock_blob:
            lock = source.git(SCRIPT.parents[1], "cat-file", "blob", lock_blob)
        self.assertEqual(source.object_id(b"blob", lock), lock_blob)
        self.write("package-lock.json", lock)
        self.write("scripts/checkbox-hotfix-audit-policy.json", '{"schema":1,"projectionDigest":"frozen inert record"}\n')
        self.base = self.commit("base")
        self.write("app/audit_release.ts", "approved audit fixes\n")
        self.snapshot = self.commit("reviewed snapshot")
        self.run_git("checkout", "-q", "--detach", self.base)
        self.write(source.SCRIPT_PATH, SCRIPT.read_bytes())
        self.write("ops/trusted-release.py", "trusted release control\n")
        for path in ("scripts/audit-release-dependencies.py", "scripts/audit-checkbox-hotfix.py",
                     ".github/scripts/verify-audit-control.py"):
            self.write(path, (SCRIPT.parents[1] / path).read_bytes())
        self.controls = sorted([source.SCRIPT_PATH, source.MANIFEST_PATH, "ops/trusted-release.py",
                                "scripts/audit-release-dependencies.py", "scripts/audit-checkbox-hotfix.py",
                                ".github/scripts/verify-audit-control.py"])
        self.manifest = {"schema": 1, "snapshotCommit": self.snapshot,
                         "approvedAt": "2026-10-04T14:50:08Z", "expiresAt": "2026-10-05T14:50:08Z",
                         "controlFiles": self.controls}
        self.write(source.MANIFEST_PATH, json.dumps(self.manifest))
        self.trusted = self.commit("trusted controls")
        # Construct the candidate independently with Git's index, not the gate's
        # tree-hash implementation. New controls do not have to exist in S.
        self.run_git("read-tree", self.snapshot)
        for path in self.controls:
            self.run_git("add", "--", path)
        tree = self.run_git("write-tree")
        self.candidate = self.commit_tree(tree, [self.trusted], "exact candidate")
        self.checkout(self.candidate)
        self.tree = tree
        self.now = source.APPROVED_AT + dt.timedelta(minutes=1)

    def write(self, path, content):
        destination = self.root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content.encode() if isinstance(content, str) else content)

    def run_git(self, *args, data=None):
        return subprocess.check_output(["git", "-C", str(self.root), *args],
                                       input=data, stderr=subprocess.PIPE).decode().strip()

    def commit(self, message):
        self.run_git("add", ".")
        self.run_git("commit", "-qm", message)
        return self.run_git("rev-parse", "HEAD")

    def commit_tree(self, tree, parents, message="fixture commit"):
        arguments = ["commit-tree", tree]
        for parent in parents:
            arguments += ["-p", parent]
        return self.run_git(*arguments, "-m", message)

    def checkout(self, commit):
        self.run_git("reset", "--hard", "-q", commit)

    def sibling(self, changes):
        self.checkout(self.candidate)
        for path, content in changes.items():
            self.write(path, content)
        self.run_git("add", ".")
        return self.commit_tree(self.run_git("write-tree"), [self.trusted])

    def verify(self, candidate=None, trusted=None, now=None):
        return source.verify_source(self.root, trusted or self.trusted,
                                    candidate or self.candidate, now if now is not None else self.now)

    def rejects(self, candidate=None, trusted=None, now=None, reason=None):
        with self.assertRaisesRegex(source.SourceRejected, reason or ".+"):
            self.verify(candidate, trusted, now)


class AuditReleaseSourceTests(AuditReleaseSourceFixture):
    def test_exact_candidate_passes_with_new_control_files(self):
        receipt = self.verify()
        self.assertEqual(receipt, {"candidate": self.candidate, "trustedBaseline": self.trusted,
                                  "snapshotCommit": self.snapshot, "tree": self.tree})

    def test_first_main_or_synthetic_merge_passes(self):
        for message in ("Merge pull request", "Synthetic PR merge"):
            merge = self.commit_tree(self.tree, [self.trusted, self.candidate], message)
            self.assertEqual(self.verify(merge)["candidate"], merge)

    def test_modified_sibling_cannot_reseal_itself(self):
        policy_path = "scripts/checkbox-hotfix-audit-policy.json"
        self.write("app/audit_release.ts", "unreviewed application change\n")
        self.run_git("add", ".")
        tree = self.run_git("write-tree")
        records = subprocess.check_output(["git", "-C", str(self.root), "ls-tree", "-r", "-z", "--full-tree", tree])
        projected = b"".join(record + b"\0" for record in records[:-1].split(b"\0")
                             if record.split(b"\t", 1)[1] != policy_path.encode())
        digest = hashlib.sha256(b"tickets-checkbox-source-v1\0" + projected).hexdigest()
        self.write(policy_path, json.dumps({"schema": 1, "projectionDigest": digest}))
        self.run_git("add", ".")
        sibling = self.commit_tree(self.run_git("write-tree"), [self.trusted])
        self.rejects(sibling, reason="exact reviewed snapshot")

    def test_unknown_file_and_dependency_change_fail_even_with_same_parent(self):
        for path in ("unknown.txt", "package-lock.json", ".github/workflows/unreviewed.yml"):
            with self.subTest(path=path):
                sibling = self.sibling({path: "unreviewed\n"})
                self.rejects(sibling, reason="exact reviewed snapshot")

    def test_every_control_file_is_compared_not_excluded(self):
        for path in self.controls:
            with self.subTest(path=path):
                sibling = self.sibling({path: "replaced trusted control\n"})
                self.rejects(sibling, reason="exact reviewed snapshot")

    def test_candidate_manifest_cannot_authorize_a_new_snapshot_or_window(self):
        forged = copy.deepcopy(self.manifest)
        forged.update(snapshotCommit=self.base, expiresAt="2099-01-01T00:00:00Z")
        sibling = self.sibling({source.MANIFEST_PATH: json.dumps(forged)})
        self.rejects(sibling, reason="exact reviewed snapshot")

    def test_candidate_policy_is_frozen_even_without_application_changes(self):
        sibling = self.sibling({"scripts/checkbox-hotfix-audit-policy.json": "{}\n"})
        self.rejects(sibling, reason="exact reviewed snapshot")

    def test_descendant_identical_tree_fails(self):
        descendant = self.commit_tree(self.tree, [self.candidate])
        self.rejects(descendant, reason="direct child")
        merge = self.commit_tree(self.tree, [self.trusted, self.candidate])
        self.rejects(self.commit_tree(self.tree, [merge]), reason="direct child")

    def test_non_direct_candidate_in_merge_fails(self):
        descendant = self.commit_tree(self.tree, [self.candidate])
        merge = self.commit_tree(self.tree, [self.trusted, descendant])
        self.rejects(merge, reason="direct-child candidate")

    def test_wrong_first_parent_reversed_parents_or_octopus_fails(self):
        for parents in ([self.candidate, self.trusted], [self.base],
                        [self.base, self.candidate], [self.trusted, self.candidate, self.base]):
            with self.subTest(parents=parents):
                self.rejects(self.commit_tree(self.tree, parents), reason="direct child")

    def test_merge_resolution_may_not_change_the_tree(self):
        sibling = self.sibling({"app/audit_release.ts": "unexpected resolution\n"})
        changed_tree = self.run_git("rev-parse", sibling + "^{tree}")
        merge = self.commit_tree(changed_tree, [self.trusted, self.candidate])
        self.rejects(merge, reason="exact direct-child candidate tree")

    def test_original_snapshot_and_trusted_baseline_are_not_release_candidates(self):
        self.rejects(self.snapshot)
        self.rejects(self.trusted)

    def test_mode_change_symlink_and_gitlink_fail(self):
        target = self.root / "app/audit_release.ts"
        target.chmod(0o755)
        self.run_git("add", "app/audit_release.ts")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))
        self.checkout(self.candidate)
        target.unlink()
        target.symlink_to("../package-lock.json")
        self.run_git("add", "app/audit_release.ts")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))
        self.checkout(self.candidate)
        self.run_git("update-index", "--add", "--cacheinfo", "160000," + self.base + ",unknown-submodule")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))

    def test_removed_file_fails(self):
        self.run_git("rm", "-q", "app/audit_release.ts")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))

    def test_expiration_start_boundary_and_naive_clock(self):
        self.verify(now=source.APPROVED_AT)
        self.rejects(now=source.APPROVED_AT - dt.timedelta(microseconds=1))
        self.rejects(now=source.EXPIRES_AT)
        self.rejects(now=source.EXPIRES_AT + dt.timedelta(days=1))
        self.rejects(now=self.now.replace(tzinfo=None))
        self.assertEqual(source.EXPIRES_AT - source.APPROVED_AT, dt.timedelta(hours=24))

    def test_full_audit_window_cannot_authorize_the_scanner_source(self):
        self.checkout(self.trusted)
        previous = {**self.manifest, "approvedAt": "2026-10-04T01:12:40Z",
                    "expiresAt": "2026-10-05T01:12:40Z"}
        self.write(source.MANIFEST_PATH, json.dumps(previous))
        trusted = self.commit("previous grant fixture")
        candidate = self.commit_tree(self.tree, [trusted])
        self.rejects(candidate, trusted=trusted, reason="Changed audit release validity window")

    def test_missing_commit_object_fails(self):
        self.rejects(candidate="f" * 40)
        self.rejects(trusted="f" * 40)

    def test_missing_snapshot_blob_fails(self):
        blob = self.run_git("rev-parse", self.snapshot + ":app/audit_release.ts")
        (self.root / ".git/objects" / blob[:2] / blob[2:]).unlink()
        self.rejects(reason="Incomplete source object database")

    def test_missing_nested_tree_fails(self):
        tree = self.run_git("rev-parse", self.snapshot + ":app")
        (self.root / ".git/objects" / tree[:2] / tree[2:]).unlink()
        self.rejects(reason="Git source verification failed")

    def test_branch_short_sha_revision_and_option_inputs_fail(self):
        for revision in ("HEAD", self.trusted[:12], self.trusted.upper(), self.trusted + "^{commit}", "--help", ""):
            with self.subTest(revision=revision), self.assertRaises(source.SourceRejected):
                source.verify_source(self.root, revision, self.candidate, self.now)

    def test_candidate_worktree_manifest_is_not_the_trust_source(self):
        self.write(source.MANIFEST_PATH, "this is an untrusted uncommitted manifest")
        self.assertEqual(self.verify()["tree"], self.tree)

    def test_replacement_objects_cannot_forge_candidate_identity(self):
        sibling = self.sibling({"app/audit_release.ts": "unreviewed\n"})
        self.run_git("replace", sibling, self.candidate)
        self.rejects(sibling, reason="exact reviewed snapshot")

    def test_git_environment_cannot_select_other_repository_or_replacements(self):
        with mock.patch.dict(os.environ, {"GIT_DIR": "/does/not/exist", "GIT_WORK_TREE": "/does/not/exist",
                                          "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.repositoryformatversion",
                                          "GIT_CONFIG_VALUE_0": "bad"}):
            self.assertEqual(self.verify()["tree"], self.tree)

    def test_trusted_gate_byte_identity_is_required(self):
        with mock.patch.object(source, "__file__", self.root / "ops/trusted-release.py"):
            self.rejects(reason="Executing verifier differs")

    def test_manifest_rejects_ambiguous_paths_duplicate_keys_and_scope(self):
        invalid = []
        for changed in ({"schema": True}, {"extra": "unknown"}, {"snapshotCommit": "HEAD"},
                        {"approvedAt": "2026-01-01T00:00:00Z"}, {"expiresAt": "2099-01-01T00:00:00Z"},
                        {"controlFiles": self.controls + self.controls},
                        {"controlFiles": sorted([source.SCRIPT_PATH, source.MANIFEST_PATH, "../bad"])},
                        {"controlFiles": sorted([source.SCRIPT_PATH, source.MANIFEST_PATH, "absent/file"])},
                        {"controlFiles": [source.SCRIPT_PATH]},
                        {"controlFiles": list(reversed(self.controls))}):
            value = copy.deepcopy(self.manifest)
            value.update(changed)
            invalid.append(json.dumps(value))
        invalid += ['{"schema":1,"schema":1}', '{"schema":NaN}', '[]', '{', 'null']
        for raw in invalid:
            with self.subTest(raw=raw):
                self.checkout(self.trusted)
                self.write(source.MANIFEST_PATH, raw)
                new_trusted = self.commit("invalid trusted manifest fixture")
                child = self.commit_tree(self.tree, [new_trusted])
                self.rejects(child, trusted=new_trusted, reason="manifest|Manifest|Snapshot|Control|control|validity")

    def test_empty_directories_are_included_in_exact_tree(self):
        # Git normally omits empty directories in an index. An attacker can still
        # create one with plumbing, and the full-tree equality must reject it.
        empty = self.run_git("mktree", data=b"")
        listing = subprocess.check_output(["git", "-C", str(self.root), "ls-tree", "-z", self.tree])
        changed = self.run_git("mktree", "-z", data=listing + b"040000 tree " + empty.encode() + b"\tempty\0")
        self.rejects(self.commit_tree(changed, [self.trusted]))

    def test_git_directory_sorting_is_preserved(self):
        # Git compares directory names with an implied trailing slash.
        self.checkout(self.snapshot)
        self.write("a.b", "file before a directory\n")
        self.write("a/nested", "nested file\n")
        revision = self.commit("sorting fixture")
        tree, _ = source.commit_info(self.root, revision)
        self.assertEqual(source.tree_hash(source.tree_records(self.root, tree)), tree)


class AuditControlMaterializationTests(AuditReleaseSourceFixture):
    def test_controls_only_tree_is_rejected_even_as_a_direct_child(self):
        control_tree = self.run_git("rev-parse", self.trusted + "^{tree}")
        self.rejects(self.commit_tree(control_tree, [self.trusted]), reason="exact reviewed snapshot")

    def test_control_helper_materializes_only_test_source_without_changing_refs_or_index(self):
        self.checkout(self.trusted)
        helper = self.root / ".github/scripts/verify-audit-control.py"
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / "synthetic-only"
        before_head = self.run_git("rev-parse", "HEAD")
        before_index = self.run_git("ls-files", "--stage")
        # Freeze only this isolated test process; production has no clock override.
        driver = """import datetime, runpy, sys
class TestClock(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 4, 14, 51, tzinfo=datetime.timezone.utc)
datetime.datetime = TestClock
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")
"""
        result = subprocess.run(["python3", "-I", "-c", driver, str(helper), "--repo", str(self.root),
                                 "--control", self.trusted, "--output", str(output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertTrue(receipt["controlSourceRejected"])
        self.assertEqual(receipt["expectedTree"], self.tree)
        self.assertEqual(self.run_git("rev-parse", "HEAD"), before_head)
        self.assertEqual(self.run_git("ls-files", "--stage"), before_index)
        self.assertEqual((output / "app/audit_release.ts").read_text(), "approved audit fixes\n")
        self.assertEqual(self.verify(receipt["testOnlyCandidate"])["tree"], self.tree)


if __name__ == "__main__":
    unittest.main()
