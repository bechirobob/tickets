"""Fail-closed unit and real-Git integration tests for the one-release audit gate."""
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

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/audit-checkbox-hotfix.py"
spec = importlib.util.spec_from_file_location("checkbox_audit", SCRIPT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def report():
    vulnerabilities = {}
    for name, (via, effects, direct, nodes) in audit.KNOWN_GRAPH.items():
        vulnerabilities[name] = {
            "name": name, "severity": "high", "isDirect": direct,
            "via": copy.deepcopy(via), "effects": effects[:], "range": "",
            "nodes": nodes[:], "fixAvailable": False,
        }
    return {
        "auditReportVersion": 2,
        "vulnerabilities": vulnerabilities,
        "metadata": {
            "vulnerabilities": {"info": 0, "low": 0, "moderate": 0, "high": 8, "critical": 0, "total": 8},
            "dependencies": {"prod": 185, "dev": 476, "optional": 197, "peer": 45, "peerOptional": 0, "total": 766},
        },
    }


def captured_ci_report():
    """Exact resolution metadata from Candidate run 37105400109, Node 22/npm 10.

    Advisory, graph, nodes, and counts were identical to report().
    Keep this captured fixture independent of the wrapper's metadata constants.
    """
    value = report()
    captured = {
        "@next/eslint-plugin-next": (">=14.3.0-canary.0", "eslint-config-next", "14.2.35"),
        "braces": ("*", "eslint-config-next", "14.2.35"),
        "eslint-config-next": (">=14.3.0-canary.0", "eslint-config-next", "14.2.35"),
        "fast-glob": ("*", "eslint-config-next", "14.2.35"),
        "micromatch": (">=0.2.0", "eslint-config-next", "14.2.35"),
        "vinext": (">=0.0.16", "vinext", "0.0.15"),
        "vite-plugin-commonjs": ("0.5.0 - 0.5.2 || >=0.7.0", "vinext", "0.0.15"),
        "vite-plugin-dynamic-import": (">=0.2.0", "vinext", "0.0.15"),
    }
    for package, (affected_range, name, version) in captured.items():
        value["vulnerabilities"][package]["range"] = affected_range
        value["vulnerabilities"][package]["fixAvailable"] = {
            "name": name, "version": version, "isSemVerMajor": True,
        }
    return value


def encode(value):
    return json.dumps(value).encode()


class ReportTests(unittest.TestCase):
    def rejects(self, value, code=1):
        with self.assertRaises(audit.AuditRejected):
            audit.validate_report(encode(value), code)

    def test_exact_known_advisory_chain_is_only_exception(self):
        self.assertTrue(audit.validate_report(encode(report()), 1))

    def test_exact_captured_node22_ci_report_is_accepted(self):
        self.assertTrue(audit.validate_report(encode(captured_ci_report()), 1))

    def test_unknown_ci_ranges_or_fix_suggestions_fail(self):
        for package in audit.KNOWN_GRAPH:
            for field, changed in (("name", "braces"), ("version", "999.0.0"),
                                   ("isSemVerMajor", False), ("isSemVerMajor", 1)):
                value = captured_ci_report()
                value["vulnerabilities"][package]["fixAvailable"][field] = changed
                with self.subTest(package=package, field=field, changed=changed):
                    self.rejects(value)
            value = captured_ci_report()
            value["vulnerabilities"][package]["range"] = "<=999.0.0"
            self.rejects(value)
            value = captured_ci_report()
            value["vulnerabilities"][package]["fixAvailable"]["extra"] = "unreviewed"
            self.rejects(value)

    def test_known_range_and_fix_metadata_cannot_be_mixed(self):
        for package in audit.KNOWN_GRAPH:
            value = captured_ci_report()
            value["vulnerabilities"][package]["fixAvailable"] = False
            self.rejects(value)
            value = captured_ci_report()
            value["vulnerabilities"][package]["range"] = ""
            self.rejects(value)
        value = captured_ci_report()
        value["vulnerabilities"]["braces"]["fixAvailable"] = value["vulnerabilities"]["vinext"]["fixAvailable"]
        self.rejects(value)

    def test_ci_metadata_does_not_allow_new_underlying_advisory(self):
        value = captured_ci_report()
        value["vulnerabilities"]["braces"]["via"][0]["url"] = "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz"
        self.rejects(value)

    def test_clean_audit_is_normal_success(self):
        value = report()
        value["vulnerabilities"] = {}
        value["metadata"]["vulnerabilities"] = dict.fromkeys((*audit.SEVERITIES, "total"), 0)
        self.assertFalse(audit.validate_report(encode(value), 0))
        self.rejects(value, 1)

    def test_incorrect_audit_exit_codes_fail(self):
        for code in (0, 2, 127, -9):
            with self.subTest(code=code):
                self.rejects(report(), code)

    def test_empty_truncated_duplicate_and_nonfinite_json_fail(self):
        for raw in (b"", b"{", b'{"auditReportVersion":2,"auditReportVersion":2}', b'{"x":NaN}', b"null", b"[]", b"\xff"):
            with self.subTest(raw=raw), self.assertRaises(audit.AuditRejected):
                audit.validate_report(raw, 1)

    def test_network_or_registry_error_fails(self):
        self.rejects({"error": {"code": "ENOAUDIT", "message": "network failure"}})
        value = report()
        value["error"] = {"code": "ETIMEDOUT"}
        self.rejects(value)

    def test_unknown_low_advisory_fails(self):
        value = report()
        value["vulnerabilities"]["new-low"] = {"name": "new-low", "severity": "low"}
        value["metadata"]["vulnerabilities"].update(low=1, total=9)
        self.rejects(value)

    def test_unknown_advisory_on_known_package_fails(self):
        value = report()
        extra = copy.deepcopy(audit.KNOWN_ADVISORY)
        extra["url"] = "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz"
        value["vulnerabilities"]["braces"]["via"].append(extra)
        self.rejects(value)

    def test_known_advisory_fields_cannot_change(self):
        for field, changed in (("source", 1), ("url", "https://example.com/GHSA-vfj7-8cjw-p6xm"),
                               ("severity", "critical"), ("range", "<=3.0.4"), ("dependency", "other")):
            value = report()
            value["vulnerabilities"]["braces"]["via"][0][field] = changed
            with self.subTest(field=field):
                self.rejects(value)

    def test_unresolved_cycles_missing_edges_or_packages_fail(self):
        for changed in (["missing"], ["vinext"], [], ["braces", "new"]):
            value = report()
            value["vulnerabilities"]["micromatch"]["via"] = changed
            self.rejects(value)
        value = report()
        del value["vulnerabilities"]["vinext"]
        value["metadata"]["vulnerabilities"].update(high=7, total=7)
        self.rejects(value)

    def test_changed_nodes_fix_availability_and_duplicate_effects_fail(self):
        for field, changed in (("nodes", ["node_modules/braces", "node_modules/other/braces"]),
                               ("fixAvailable", True), ("isDirect", 0), ("effects", ["micromatch", "micromatch"]),
                               ("range", "*"), ("via", "braces")):
            value = report()
            value["vulnerabilities"]["braces"][field] = changed
            with self.subTest(field=field):
                self.rejects(value)

    def test_unexpected_or_missing_schema_fields_fail(self):
        for field in ("name", "via", "nodes", "fixAvailable"):
            value = report()
            del value["vulnerabilities"]["braces"][field]
            self.rejects(value)
        for changed in (1, True, "2"):
            value = report()
            value["auditReportVersion"] = changed
            self.rejects(value)

    def test_invalid_metadata_fails(self):
        for field, changed in (("total", 7), ("high", True), ("low", -1), ("high", 8.0)):
            value = report()
            value["metadata"]["vulnerabilities"][field] = changed
            self.rejects(value)
        value = report()
        value["metadata"]["dependencies"]["total"] = 0
        self.rejects(value)


class GitScopeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.run_git("init", "-q")
        self.run_git("config", "user.name", "Audit Test")
        self.run_git("config", "user.email", "audit-test@example.invalid")
        for path in audit.DEPENDENCY_FILES:
            self.write(path, "{}\n")
        self.write("app/example.ts", "baseline\n")
        self.commit("baseline")
        self.base = self.rev()
        self.base_patch = mock.patch.object(audit, "BASE_SHA", self.base)
        self.base_patch.start()
        self.addCleanup(self.base_patch.stop)
        self.env_patch = mock.patch.dict(os.environ, {}, clear=True)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.write("app/example.ts", "checkbox removal\n")
        self.seal()
        self.commit("checkbox-only candidate")
        self.candidate = self.rev()
        self.now = audit.APPROVED_AT + dt.timedelta(minutes=1)

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def run_git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.PIPE).decode().strip()

    def rev(self):
        return self.run_git("rev-parse", "HEAD")

    def commit(self, message):
        self.run_git("add", ".")
        self.run_git("commit", "-qm", message)

    def seal(self, extra=None):
        self.write(audit.POLICY_PATH, '{}\n')
        self.run_git("add", ".")
        tree = self.run_git("write-tree")
        policy = {"schema": 1, "projectionDigest": audit.projection_digest(self.root, tree)}
        policy.update(extra or {})
        self.write(audit.POLICY_PATH, json.dumps(policy))

    def assert_rejected(self, now=None):
        with self.assertRaises(audit.AuditRejected):
            audit.verify_source_scope(self.root, now or self.now)

    def test_direct_child_candidate_allowed(self):
        self.assertEqual(audit.verify_source_scope(self.root, self.now), self.candidate)

    def test_initial_main_or_synthetic_merge_allowed(self):
        tree = self.run_git("rev-parse", "HEAD^{tree}")
        for message in ("Merge pull request", "Synthetic PR test merge"):
            merge = self.run_git("commit-tree", tree, "-p", self.base, "-p", self.candidate, "-m", message)
            self.run_git("checkout", "--detach", "-q", merge)
            self.assertEqual(audit.verify_source_scope(self.root, self.now), merge)

    def test_later_same_tree_commit_rejected(self):
        self.run_git("commit", "--allow-empty", "-qm", "later release")
        self.assert_rejected()

    def test_later_merge_after_candidate_rejected(self):
        tree = self.run_git("rev-parse", "HEAD^{tree}")
        later = self.run_git("commit-tree", tree, "-p", self.candidate, "-m", "later candidate")
        merge = self.run_git("commit-tree", tree, "-p", self.base, "-p", later, "-m", "later merge")
        self.run_git("checkout", "--detach", "-q", merge)
        self.assert_rejected()

    def test_merge_changed_tree_and_reversed_parents_rejected(self):
        self.write("app/example.ts", "unexpected merge resolution\n")
        self.run_git("add", ".")
        changed = self.run_git("write-tree")
        for tree, parents in ((changed, [self.base, self.candidate]),
                              (self.run_git("rev-parse", "HEAD^{tree}"), [self.candidate, self.base])):
            merge = self.run_git("commit-tree", tree, "-p", parents[0], "-p", parents[1], "-m", "invalid merge")
            self.run_git("reset", "--hard", "-q", merge)
            self.assert_rejected()

    def test_wrong_or_missing_baseline_rejected(self):
        with mock.patch.object(audit, "BASE_SHA", "a" * 40):
            self.assert_rejected()

    def test_expired_and_future_exception_rejected(self):
        self.assert_rejected(audit.EXPIRES_AT)
        self.assert_rejected(audit.APPROVED_AT - dt.timedelta(seconds=1))
        self.assertLessEqual(audit.EXPIRES_AT - audit.APPROVED_AT, dt.timedelta(hours=24))

    def test_unstaged_and_staged_dirty_source_rejected(self):
        self.write("app/example.ts", "dirty\n")
        self.assert_rejected()
        self.run_git("add", ".")
        self.assert_rejected()

    def test_changed_tree_with_old_policy_rejected(self):
        self.write("unreviewed.txt", "new scope\n")
        self.run_git("add", ".")
        self.run_git("commit", "--amend", "--no-edit", "-q")
        self.assert_rejected()

    def test_changed_file_mode_rejected(self):
        (self.root / "app/example.ts").chmod(0o755)
        self.run_git("add", ".")
        self.run_git("commit", "--amend", "--no-edit", "-q")
        self.assert_rejected()

    def test_changed_dependency_files_rejected_even_with_matching_projection(self):
        for path in audit.DEPENDENCY_FILES:
            with self.subTest(path=path):
                self.run_git("reset", "--hard", "-q", self.candidate)
                self.write(path, '{"changed":true}\n')
                self.seal()
                self.run_git("add", ".")
                self.run_git("commit", "--amend", "--no-edit", "-q")
                self.assert_rejected()

    def test_policy_cannot_add_authorization_scope(self):
        for extra in ({"expiresAt": "2099-01-01"}, {"schema": True}, {"projectionDigest": "x" * 64}):
            self.run_git("reset", "--hard", "-q", self.candidate)
            self.seal(extra)
            self.run_git("add", ".")
            self.run_git("commit", "--amend", "--no-edit", "-q")
            self.assert_rejected()

    def test_duplicate_policy_keys_rejected(self):
        content = (self.root / audit.POLICY_PATH).read_text().replace('"schema": 1', '"schema": 1, "schema": 1')
        self.write(audit.POLICY_PATH, content)
        self.run_git("add", ".")
        self.run_git("commit", "--amend", "--no-edit", "-q")
        self.assert_rejected()

    def test_release_sha_must_match_checkout(self):
        with mock.patch.dict(os.environ, {"BECORE_RELEASE_SHA": self.base}):
            self.assert_rejected()
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
            self.assert_rejected()
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "BECORE_RELEASE_SHA": self.candidate}):
            self.assertEqual(audit.verify_source_scope(self.root, self.now), self.candidate)

    def test_projection_excludes_only_policy_blob(self):
        before = audit.projection_digest(self.root, "HEAD")
        self.write(audit.POLICY_PATH, '{"changed":true}\n')
        self.run_git("add", ".")
        self.assertEqual(before, audit.projection_digest(self.root, self.run_git("write-tree")))
        self.write("ops/vps/code-release.py", "operator change\n")
        self.run_git("add", ".")
        self.assertNotEqual(before, audit.projection_digest(self.root, self.run_git("write-tree")))


class DependencyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        packages = {}
        for name, (_, _, _, nodes) in audit.KNOWN_GRAPH.items():
            for node in nodes:
                version = "3.0.3" if name == "braces" else "1.2.3"
                target = self.root / node
                target.mkdir(parents=True, exist_ok=True)
                (target / "package.json").write_text(json.dumps({"name": name, "version": version}))
                packages[node] = {"version": version}
        packages["node_modules/braces"]["integrity"] = audit.BRACES_INTEGRITY
        self.lock = self.root / "package-lock.json"
        self.lock.write_text(json.dumps({"lockfileVersion": 3, "packages": packages}))
        self.lock_patch = mock.patch.object(audit, "LOCK_SHA256", hashlib.sha256(self.lock.read_bytes()).hexdigest())
        self.lock_patch.start()
        self.addCleanup(self.lock_patch.stop)
        self.inventory_patch = mock.patch.object(audit, "BRACES_INVENTORY_SHA256", audit.package_inventory(self.root / "node_modules/braces"))
        self.inventory_patch.start()
        self.addCleanup(self.inventory_patch.stop)

    def test_exact_locked_and_installed_packages_allowed(self):
        audit.verify_locked_dependencies(self.root)

    def test_lock_byte_change_rejected(self):
        self.lock.write_text(self.lock.read_text() + "\n")
        with self.assertRaises(audit.AuditRejected):
            audit.verify_locked_dependencies(self.root)

    def test_installed_version_change_rejected(self):
        path = self.root / "node_modules/braces/package.json"
        path.write_text(path.read_text().replace("3.0.3", "3.0.4"))
        with self.assertRaises(audit.AuditRejected):
            audit.verify_locked_dependencies(self.root)

    def test_installed_source_patch_or_extra_file_rejected(self):
        (self.root / "node_modules/braces/index.js").write_text("maintained patch\n")
        with self.assertRaises(audit.AuditRejected):
            audit.verify_locked_dependencies(self.root)

    def test_installed_symlink_rejected(self):
        (self.root / "node_modules/braces/linked").symlink_to("package.json")
        with self.assertRaises(audit.AuditRejected):
            audit.verify_locked_dependencies(self.root)

    def test_transitive_installed_version_change_rejected(self):
        path = self.root / "node_modules/vinext/package.json"
        path.write_text(path.read_text().replace("1.2.3", "9.0.0"))
        with self.assertRaises(audit.AuditRejected):
            audit.verify_locked_dependencies(self.root)


class InvocationTests(unittest.TestCase):
    def test_timeout_rejects_without_exception(self):
        with mock.patch.object(audit.sys, "argv", [str(SCRIPT)]), \
             mock.patch.object(audit.subprocess, "run", side_effect=subprocess.TimeoutExpired("npm audit", 120)):
            self.assertEqual(audit.main(), 1)

    def test_arguments_cannot_override_policy(self):
        with mock.patch.object(audit.sys, "argv", [str(SCRIPT), "--ignore-expiry"]), \
             mock.patch.object(audit.subprocess, "run") as run:
            self.assertEqual(audit.main(), 1)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
