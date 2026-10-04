"""Real-Git adversarial tests of the independently anchored caption source gate."""
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


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verify-caption-source.py"
spec = importlib.util.spec_from_file_location("caption_source", SCRIPT)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class CaptionSourceFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.run_git("init", "-q")
        self.run_git("config", "user.name", "Caption Gate Test")
        self.run_git("config", "user.email", "caption-test@example.invalid")
        self.write("app/caption.ts", "original caption\n")
        self.write("package-lock.json", "reviewed lock bytes\n")
        self.write("scripts/checkbox-hotfix-audit-policy.json", '{"schema":1,"projectionDigest":"frozen inert record"}\n')
        self.base = self.commit("base")
        self.write("app/caption.ts", "approved caption removal\n")
        self.snapshot = self.commit("reviewed snapshot")
        self.run_git("checkout", "-q", "--detach", self.base)
        self.write(source.SCRIPT_PATH, SCRIPT.read_bytes())
        self.write("ops/trusted-release.py", "trusted release control\n")
        self.controls = sorted([source.SCRIPT_PATH, source.MANIFEST_PATH, "ops/trusted-release.py"])
        self.manifest = {"schema": 1, "snapshotCommit": self.snapshot,
                         "approvedAt": "2026-10-03T08:42:19Z", "expiresAt": "2026-10-04T08:42:19Z",
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


class CaptionSourceTests(CaptionSourceFixture):
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
        self.write("app/caption.ts", "unreviewed application change\n")
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
        sibling = self.sibling({"app/caption.ts": "unexpected resolution\n"})
        changed_tree = self.run_git("rev-parse", sibling + "^{tree}")
        merge = self.commit_tree(changed_tree, [self.trusted, self.candidate])
        self.rejects(merge, reason="exact direct-child candidate tree")

    def test_original_snapshot_and_trusted_baseline_are_not_release_candidates(self):
        self.rejects(self.snapshot)
        self.rejects(self.trusted)

    def test_mode_change_symlink_and_gitlink_fail(self):
        target = self.root / "app/caption.ts"
        target.chmod(0o755)
        self.run_git("add", "app/caption.ts")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))
        self.checkout(self.candidate)
        target.unlink()
        target.symlink_to("../package-lock.json")
        self.run_git("add", "app/caption.ts")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))
        self.checkout(self.candidate)
        self.run_git("update-index", "--add", "--cacheinfo", "160000," + self.base + ",unknown-submodule")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))

    def test_removed_file_fails(self):
        self.run_git("rm", "-q", "app/caption.ts")
        self.rejects(self.commit_tree(self.run_git("write-tree"), [self.trusted]))

    def test_expiration_start_boundary_and_naive_clock(self):
        self.verify(now=source.APPROVED_AT)
        self.rejects(now=source.APPROVED_AT - dt.timedelta(microseconds=1))
        self.rejects(now=source.EXPIRES_AT)
        self.rejects(now=source.EXPIRES_AT + dt.timedelta(days=1))
        self.rejects(now=self.now.replace(tzinfo=None))
        self.assertEqual(source.EXPIRES_AT - source.APPROVED_AT, dt.timedelta(hours=24))

    def test_missing_commit_object_fails(self):
        self.rejects(candidate="f" * 40)
        self.rejects(trusted="f" * 40)

    def test_missing_snapshot_blob_fails(self):
        blob = self.run_git("rev-parse", self.snapshot + ":app/caption.ts")
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
        sibling = self.sibling({"app/caption.ts": "unreviewed\n"})
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


class WorkflowTrustBoundaryTests(unittest.TestCase):
    """The approved audit release retains trust checks without reusing the caption exception."""
    ROOT = Path(__file__).resolve().parents[1]

    def workflow(self, name):
        return (self.ROOT / ".github/workflows" / name).read_text()

    def test_preflights_bind_clean_exact_source_and_independent_ancestry(self):
        for filename, count in (("candidate-checks.yml", 1), ("deploy.yml", 1), ("vps-runtime.yml", 2)):
            with self.subTest(workflow=filename):
                text = self.workflow(filename)
                blocks = text.split("- name: Verify exact source ancestry before executing checkout code")[1:]
                self.assertEqual(len(blocks), count)
                for block in blocks:
                    block = block.split("\n      - ", 1)[0]
                    for command in ('unset "${!GIT_@}"', 'GIT_NO_REPLACE_OBJECTS=1',
                                    'GIT_CONFIG_GLOBAL=/dev/null', 'GIT_NO_LAZY_FETCH=1',
                                    '[[ "$BECORE_TRUSTED_BASE" =~ ^[a-f0-9]{40}$',
                                    'test "$BECORE_TRUSTED_BASE" != "$BECORE_RELEASE_SHA"',
                                    'test "$(git rev-parse HEAD)" = "$BECORE_RELEASE_SHA"',
                                    'git merge-base --is-ancestor "$BECORE_TRUSTED_BASE" origin/main',
                                    'git merge-base --is-ancestor "$BECORE_TRUSTED_BASE" "$BECORE_RELEASE_SHA"',
                                    'git diff --exit-code HEAD --',
                                    'git diff --cached --exit-code HEAD --',
                                    'test -z "$(git ls-files --others --exclude-standard)"'):
                        self.assertIn(command, block)
                    self.assertNotIn("verify-caption-source.py", block)
                    self.assertNotIn("npm ", block)
                    if filename != "candidate-checks.yml":
                        self.assertIn('test "$GITHUB_REF" = refs/heads/main', block)
                        self.assertIn('git merge-base --is-ancestor "$BECORE_RELEASE_SHA" origin/main', block)

    def test_trust_anchors_remain_independent_of_candidate_parents_and_manifests(self):
        self.assertIn('BECORE_TRUSTED_BASE: ${{ github.event.pull_request.base.sha || inputs.trusted_base }}',
                      self.workflow("candidate-checks.yml"))
        self.assertIn('BECORE_TRUSTED_BASE: ${{ github.event.before || inputs.trusted_base }}', self.workflow("deploy.yml"))
        self.assertEqual(self.workflow("vps-runtime.yml").count('BECORE_TRUSTED_BASE: ${{ github.event.before }}'), 2)

    def test_audit_release_does_not_reuse_caption_exception_or_suppress_errors(self):
        for filename in ("candidate-checks.yml", "vps-runtime.yml", "deploy.yml"):
            text = self.workflow(filename)
            self.assertIn('run: python3 -I "$RUNNER_TEMP/tickets-approved-audit.py" --phase preinstall\n', text)
            self.assertIn('Stage trusted audit verifier', text)
            self.assertNotIn('audit-checkbox-hotfix.py', text)
            self.assertNotIn('Verify bounded audit exception', text)
            self.assertNotIn('continue-on-error', text)
            self.assertNotIn('npm audit --audit-level=moderate ||', text)

    def test_audit_precedes_install_and_privileged_candidate_scripts(self):
        for filename in ("candidate-checks.yml", "vps-runtime.yml", "deploy.yml"):
            text = self.workflow(filename)
            self.assertLess(text.index('--phase preinstall'), text.index('run: npm ci --no-audit'))
            self.assertLess(text.index('run: npm ci --no-audit'), text.index('--phase postinstall'))
            self.assertIn('BECORE_PREINSTALL_RECEIPT_SHA256: ${{ steps.dependency_audit.outputs.audit_receipt_sha256 }}', text)
        deploy = self.workflow("deploy.yml")
        self.assertLess(deploy.index('--phase preinstall'), deploy.index('name: Ensure Workers subdomain exists'))
        self.assertLess(deploy.index('--phase preinstall'), deploy.index('run: node scripts/resolve-active-deployment.mjs'))
        self.assertLess(deploy.index('--phase postinstall'), deploy.index('run: node scripts/resolve-active-deployment.mjs'))
        handoff = self.workflow("vps-runtime.yml").split('  handoff:', 1)[1]
        self.assertIn('    needs: verify', handoff)

    def test_manual_activation_binds_trusted_operator_before_host_access(self):
        text = self.workflow("tickets-code-release.yml")
        self.assertIn('OPERATOR_SHA: ${{ inputs.trusted_base }}', text)
        self.assertIn('BECORE_TRUSTED_BASE: ${{ inputs.trusted_base }}', text)
        ancestry = text.index('git merge-base --is-ancestor "$BECORE_TRUSTED_BASE" origin/main')
        stage = text.index('git archive "$OPERATOR_SHA"')
        guard = text.index('python3 -I "$RUNNER_TEMP/tickets-operator/ops/vps/code-release.py" verify-operator')
        regression = text.index('- name: Verify updater regression suite')
        verify_ci = text.index('code-release.py" verify-ci')
        host = text.index('- name: Connect existing dedicated Tickets identity')
        self.assertIn('test "$BECORE_TRUSTED_BASE" != "$SOURCE_SHA"', text[:stage])
        self.assertLess(ancestry, stage)
        self.assertLess(stage, guard)
        self.assertLess(guard, regression)
        self.assertLess(regression, verify_ci)
        self.assertLess(verify_ci, host)
        for name in ("Reject unmerged source before executing checkout code", "Stage reviewed trusted operator without changing the verified application tree"):
            block = text.split("- name: " + name, 1)[1].split("\n      - ", 1)[0]
            self.assertLess(block.index('unset "${!GIT_@}"'), block.index('git '))
            self.assertLess(block.index('GIT_NO_REPLACE_OBJECTS=1'), block.index('git '))
            self.assertIn('GIT_CONFIG_GLOBAL=/dev/null', block)
            self.assertIn('GIT_NO_LAZY_FETCH=1', block)

    def test_operator_checks_materialize_only_the_approved_audit_source(self):
        text = self.workflow("tickets-release-operator-checks.yml")
        self.assertNotIn('caption-expected-source', text)
        self.assertNotIn('python3 -I .github/scripts/verify-caption-control.py', text)
        self.assertIn("python3 -m unittest discover -s ops/vps -p 'test_*.py'", text)
        self.assertIn(".github/scripts/verify-audit-control.py", text)
        selector = "github.event.pull_request.head.ref == 'release/scanner-session-selector-controls-20261004' && github.event.pull_request.base.sha == '45c09a471c44f34a48c1aafbde58298d75843fc8'"
        self.assertEqual(text.count(selector), 3)
        self.assertNotIn("release/audit-controls-fixture-20261004", text)
        self.assertIn("|| github.workspace", text)
        self.assertIn('git -C "$GITHUB_WORKSPACE" diff --check', text)


if __name__ == "__main__":
    unittest.main()
