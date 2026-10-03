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

from test_caption_source import CaptionSourceFixture

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


class GitScopeTests(CaptionSourceFixture):
    """Audit plumbing uses the same real-Git trusted snapshot fixture as the gate."""
    def setUp(self):
        super().setUp()
        environment = mock.patch.dict(os.environ, {"BECORE_TRUSTED_BASE": self.trusted,
                                                   "BECORE_RELEASE_SHA": self.candidate}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def assert_rejected(self, now=None, reason=None):
        with self.assertRaisesRegex(audit.AuditRejected, reason or ".+"):
            audit.verify_source_scope(self.root, now if now is not None else self.now)

    def test_trusted_direct_child_source_allowed(self):
        self.assertEqual(audit.verify_source_scope(self.root, self.now), self.candidate)

    def test_original_frozen_policy_is_not_a_self_seal(self):
        # The fixture has deliberately invalid projection metadata. Only its
        # byte-for-byte identity in the trusted snapshot matters now.
        self.assertEqual(audit.verify_source_scope(self.root, self.now), self.candidate)

    def test_missing_or_mutable_trust_anchor_fails(self):
        for value in ("", "HEAD", self.trusted[:12], "a" * 40):
            with self.subTest(value=value), mock.patch.dict(os.environ, {"BECORE_TRUSTED_BASE": value}):
                self.assert_rejected()
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assert_rejected(reason="BECORE_TRUSTED_BASE")

    def test_unstaged_and_staged_dirty_source_rejected(self):
        self.write("app/caption.ts", "dirty\n")
        self.assert_rejected()
        self.run_git("add", ".")
        self.assert_rejected()

    def test_sibling_reseal_rejected_by_trusted_gate(self):
        sibling = self.sibling({"app/caption.ts": "unreviewed\n",
                                "scripts/checkbox-hotfix-audit-policy.json": '{"projectionDigest":"resealed"}'})
        self.checkout(sibling)
        with mock.patch.dict(os.environ, {"BECORE_RELEASE_SHA": sibling}):
            self.assert_rejected(reason="exact reviewed snapshot")

    def test_candidate_cannot_replace_gate(self):
        sibling = self.sibling({audit.TRUSTED_GATE_PATH: 'raise RuntimeError("candidate gate executed")\n'})
        self.checkout(sibling)
        with mock.patch.dict(os.environ, {"BECORE_RELEASE_SHA": sibling}):
            self.assert_rejected(reason="exact reviewed snapshot")

    def test_candidate_cannot_replace_manifest(self):
        sibling = self.sibling({"scripts/caption-source-manifest.json": '{}\n'})
        self.checkout(sibling)
        with mock.patch.dict(os.environ, {"BECORE_RELEASE_SHA": sibling}):
            self.assert_rejected(reason="exact reviewed snapshot")

    def test_expired_or_future_exception_rejected(self):
        self.assert_rejected(audit.EXPIRES_AT)
        self.assert_rejected(audit.APPROVED_AT - dt.timedelta(seconds=1))

    def test_exact_ci_release_sha_is_required(self):
        with mock.patch.dict(os.environ, {"BECORE_RELEASE_SHA": self.base}):
            self.assert_rejected(reason="differs from BECORE_RELEASE_SHA")
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "BECORE_TRUSTED_BASE": self.trusted}, clear=True):
            self.assert_rejected(reason="Missing exact CI release SHA")
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
            self.assertEqual(audit.verify_source_scope(self.root, self.now), self.candidate)

    def test_trusted_gate_is_materialized_outside_candidate(self):
        old_compile = compile
        paths = []
        def capture(source_bytes, filename, mode, *args, **kwargs):
            paths.append(Path(filename))
            return old_compile(source_bytes, filename, mode, *args, **kwargs)
        with mock.patch("builtins.compile", side_effect=capture):
            self.assertEqual(audit.verify_source_scope(self.root, self.now), self.candidate)
        self.assertTrue(paths)
        self.assertTrue(all(self.root not in path.parents for path in paths))
        self.assertTrue(all(not path.exists() for path in paths))


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
