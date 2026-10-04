"""Trusted policy integration, strict report/dependency checks, and private output."""
import contextlib
import copy
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

import test_audit_release_source as source_tests
import test_checkbox_hotfix_audit as existing

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/audit-release-dependencies.py"
spec = importlib.util.spec_from_file_location("audit_release_dependencies", SCRIPT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def clean_report():
    value = existing.report()
    value["vulnerabilities"] = {}
    value["metadata"]["vulnerabilities"] = dict.fromkeys((*existing.audit.SEVERITIES, "total"), 0)
    return json.dumps(value).encode()


# The new wrapper imports these exact strict functions from authenticated T bytes.
# Reuse their adversarial contract suite instead of duplicating a second policy.
class StrictReportTests(existing.ReportTests):
    pass


class StrictDependencyTests(existing.DependencyTests):
    pass


class TrustedPolicyTests(source_tests.AuditReleaseSourceFixture):
    def evaluate(self, raw=None, code=1, stderr=b"", now=None):
        return audit.evaluate_report(self.root, self.trusted, self.candidate,
                                     existing.encode(existing.report()) if raw is None else raw,
                                     code, stderr, now if now is not None else self.now)

    def validator_loader(self, dependency_check):
        original = audit.execute_trusted
        def load(root, trusted, path, operation):
            if path != audit.VALIDATORS_PATH:
                return original(root, trusted, path, operation)
            def apply(namespace):
                namespace["verify_locked_dependencies"] = dependency_check
                # Neither the old wrapper's main nor its source/window policy may run.
                namespace["main"] = mock.Mock(side_effect=AssertionError("old main invoked"))
                namespace["verify_source_scope"] = mock.Mock(side_effect=AssertionError("old exception invoked"))
                return operation(namespace)
            return original(root, trusted, path, apply)
        return load

    def test_exact_checkout_and_known_report_use_new_gate_and_strict_dependencies(self):
        audit.verify_checkout(self.root, self.trusted, self.candidate)
        dependency_check = mock.Mock()
        with mock.patch.object(audit, "execute_trusted", side_effect=self.validator_loader(dependency_check)):
            self.assertEqual(self.evaluate(), "known-advisory-exception")
        dependency_check.assert_called_once_with(self.root)

    def test_preinstall_known_report_checks_source_before_install_and_defers_inventory(self):
        dependency_check = mock.Mock(side_effect=AssertionError("installed inventory checked before npm ci"))
        with mock.patch.object(audit, "execute_trusted", side_effect=self.validator_loader(dependency_check)):
            self.assertEqual(audit.evaluate(self.root, self.trusted, self.candidate,
                existing.encode(existing.report()), 1, b"", self.now, installed=False), "known-advisory-exception")
            changed = self.sibling({"app/audit_release.ts": "unreviewed source before install\n"})
            with self.assertRaisesRegex(ValueError, "exact reviewed snapshot"):
                audit.evaluate(self.root, self.trusted, changed,
                    existing.encode(existing.report()), 1, b"", self.now, installed=False)
        dependency_check.assert_not_called()

    def test_clean_report_is_ordinary_success_after_expiry_without_source_exception(self):
        with mock.patch.object(audit, "verify_source_scope", side_effect=AssertionError("source exception invoked")):
            self.assertEqual(self.evaluate(clean_report(), 0, now=self.now + dt.timedelta(days=2)), "clean")

    def test_known_report_requires_both_new_window_boundaries(self):
        for now in (source_tests.source.APPROVED_AT - dt.timedelta(microseconds=1),
                    source_tests.source.EXPIRES_AT):
            with self.subTest(now=now), self.assertRaisesRegex(ValueError, "expired"):
                self.evaluate(now=now)

    def test_known_report_rejects_changed_lock_before_installed_dependency_check(self):
        self.write("package-lock.json", (self.root / "package-lock.json").read_bytes() + b"\n")
        with self.assertRaisesRegex(audit.AuditRejected, "Official package-lock blob changed"):
            self.evaluate()

    def test_installed_bytes_failure_rejects_known_exception(self):
        check = mock.Mock(side_effect=existing.audit.AuditRejected("Installed braces bytes changed"))
        with mock.patch.object(audit, "execute_trusted", side_effect=self.validator_loader(check)), \
             self.assertRaisesRegex(ValueError, "Installed braces bytes changed"):
            self.evaluate()
        check.assert_called_once_with(self.root)

    def test_new_finding_never_reaches_source_exception(self):
        value = existing.report()
        value["vulnerabilities"]["braces"]["via"][0]["url"] = "https://example.invalid/new-advisory"
        with mock.patch.object(audit, "verify_source_scope") as gate, self.assertRaises(ValueError):
            self.evaluate(existing.encode(value))
        gate.assert_not_called()

    def test_partial_clean_schema_error_status_and_operational_stderr_reject(self):
        partial = json.loads(clean_report())
        del partial["metadata"]["dependencies"]
        for raw, code, stderr in ((existing.encode(partial), 0, b""), (clean_report(), 1, b""),
                                  (clean_report(), 0, b"npm error EPRIVATE secret-host"),
                                  (b'{"error":{"code":"ENOAUDIT"}}', 1, b"")):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.evaluate(raw, code, stderr)

    def test_candidate_helper_cannot_relax_trusted_validator(self):
        self.write(audit.VALIDATORS_PATH, 'raise AssertionError("candidate helper executed")\n')
        self.assertEqual(self.evaluate(clean_report(), 0), "clean")
        with self.assertRaisesRegex(audit.AuditRejected, "Git trust verification failed"):
            audit.verify_checkout(self.root, self.trusted, self.candidate)

    def test_missing_trust_wrong_head_and_executing_wrapper_identity_reject(self):
        for trusted, candidate in (("", self.candidate), ("HEAD", self.candidate),
                                   (self.trusted, "HEAD"), (self.trusted, self.base),
                                   (self.candidate, self.candidate)):
            with self.subTest(trusted=trusted, candidate=candidate), self.assertRaises(ValueError):
                audit.verify_checkout(self.root, trusted, candidate)
        with mock.patch.object(audit, "__file__", self.root / "ops/trusted-release.py"), \
             self.assertRaisesRegex(audit.AuditRejected, "wrapper differs"):
            audit.verify_checkout(self.root, self.trusted, self.candidate)

    def test_tree_trust_anchor_and_untracked_source_reject(self):
        tree = self.run_git("rev-parse", self.trusted + "^{tree}")
        with self.assertRaisesRegex(audit.AuditRejected, "baseline must be a commit"):
            audit.verify_checkout(self.root, tree, self.candidate)
        self.write("untracked-audit-control.py", "unapproved source\n")
        with self.assertRaisesRegex(audit.AuditRejected, "Untracked source"):
            audit.verify_checkout(self.root, self.trusted, self.candidate)

    def test_candidate_cannot_reseal_source_even_with_matching_audit(self):
        changed = self.sibling({"app/audit_release.ts": "unreviewed app\n",
                                source_tests.source.MANIFEST_PATH: json.dumps(self.manifest)})
        with self.assertRaisesRegex(ValueError, "exact reviewed snapshot"):
            audit.evaluate_report(self.root, self.trusted, changed,
                                  existing.encode(existing.report()), 1, now=self.now)

    def test_imported_trusted_files_are_materialized_outside_candidate(self):
        original = compile
        paths = []
        def compile_and_capture(raw, filename, mode, *args, **kwargs):
            paths.append(Path(filename))
            return original(raw, filename, mode, *args, **kwargs)
        with mock.patch("builtins.compile", side_effect=compile_and_capture):
            self.assertEqual(self.evaluate(clean_report(), 0), "clean")
        self.assertTrue(paths)
        self.assertTrue(all(self.root not in path.parents and not path.exists() for path in paths))


class PrivateOutputTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.directory = self.root / "audit-private"
        for name in ("package.json", "package-lock.json"):
            (self.root / name).write_bytes((SCRIPT.parents[1] / name).read_bytes())
        environment = mock.patch.dict(os.environ, {"RUNNER_TEMP": str(self.root),
                    "BECORE_AUDIT_DIRECTORY": str(self.directory), "PATH": os.defpath,
                    "BECORE_TRUSTED_BASE": "a" * 40, "BECORE_RELEASE_SHA": "b" * 40}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def invoke(self, raw, code, stderr=b"", outcome=None, error=None):
        result = subprocess.CompletedProcess(["npm"], code, raw, stderr)
        output = io.StringIO()
        with mock.patch.object(audit.sys, "argv", [str(SCRIPT), "--phase", "preinstall"]), \
             mock.patch.object(audit.Path, "cwd", return_value=self.root), \
             mock.patch.object(audit, "verify_checkout"), \
             mock.patch.object(audit, "trusted_blob"), \
             mock.patch.object(audit, "evaluate", return_value=outcome, side_effect=error), \
             mock.patch.object(audit.subprocess, "run", return_value=result) as run, \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            status = audit.main()
        self.invocation = run.call_args
        return status, output.getvalue()

    def finish(self, outcome="known-advisory-exception"):
        with mock.patch.object(audit, "evaluate_report", return_value=outcome), \
             mock.patch.object(audit.subprocess, "run") as run:
            result = audit.postinstall(self.directory, self.root, "a" * 40, "b" * 40)
        run.assert_not_called()
        return result

    def capture(self, outcome="known-advisory-exception"):
        status, output = self.invoke(existing.encode(existing.report()), 1, outcome=outcome)
        self.assertEqual(status, 0, output)
        receipt_digest = json.loads(output)["preinstallReceiptSha256"]
        os.environ["BECORE_PREINSTALL_RECEIPT_SHA256"] = receipt_digest
        return receipt_digest

    def test_success_output_is_private_and_postinstall_reuses_same_report(self):
        raw, stderr = b'{"private-package-inventory":"secret"}', b"private-registry.example"
        status, output = self.invoke(raw, 1, stderr, "known-advisory-exception")
        self.assertEqual(status, 0)
        self.assertNotIn("secret", output)
        self.assertNotIn("private-registry", output)
        self.assertEqual((self.directory / "npm-audit.json").read_bytes(), raw)
        self.assertEqual((self.directory / "npm-audit.stderr").read_bytes(), stderr)
        self.assertEqual(stat.S_IMODE(self.directory.stat().st_mode), 0o700)
        os.environ["BECORE_PREINSTALL_RECEIPT_SHA256"] = json.loads(output)["preinstallReceiptSha256"]
        self.finish()
        for path in self.directory.rglob("*"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700 if path.is_dir() else 0o600)
        receipt = json.loads((self.directory / "receipt.json").read_bytes())
        self.assertEqual(receipt["reportSha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(receipt["status"], "known-advisory-exception")
        self.assertEqual(receipt["candidate"], "b" * 40)
        self.assertEqual(receipt["trustedBaseline"], "a" * 40)
        self.assertEqual(receipt["phase"], "complete")
        self.assertEqual(receipt["packageSha256"], hashlib.sha256((self.root / "package.json").read_bytes()).hexdigest())
        self.assertEqual(receipt["lockSha256"], hashlib.sha256((self.root / "package-lock.json").read_bytes()).hexdigest())

    def test_candidate_npm_config_environment_and_omissions_cannot_affect_audit(self):
        (self.root / ".npmrc").write_text("registry=https://evil.invalid/\nomit=dev\nworkspace=hidden\n")
        with mock.patch.dict(os.environ, {"NODE_ENV": "production", "NODE_OPTIONS": "--require evil.js",
                    "npm_config_registry": "https://evil.invalid", "npm_config_omit": "dev",
                    "NPM_CONFIG_WORKSPACE": "hidden", "NPM_CONFIG_USERCONFIG": "/evil/npmrc"}):
            self.capture()
        command, = self.invocation.args
        settings = self.invocation.kwargs
        self.assertEqual(settings["cwd"], self.directory / "manifests")
        self.assertEqual(set(settings["env"]), {"PATH", "TMPDIR", "CI"})
        for argument in ("--package-lock-only", "--ignore-scripts", "--workspaces=false",
                         "--registry=https://registry.npmjs.org/", "--include=prod", "--include=dev",
                         "--include=optional", "--include=peer"):
            self.assertIn(argument, command)
        self.assertFalse((settings["cwd"] / ".npmrc").exists())
        self.assertEqual({path.name for path in settings["cwd"].iterdir()}, {"package.json", "package-lock.json"})
        self.assertEqual((self.directory / "npmrc-user").read_bytes(), b"")
        self.assertEqual((self.directory / "npmrc-global").read_bytes(), b"")

    def test_rejection_retains_raw_report_without_leaking_parser_error(self):
        raw = b'{"secret-partial-inventory"'
        status, output = self.invoke(raw, 1, b"private stderr", error=ValueError("secret parse detail"))
        self.assertEqual(status, 1)
        self.assertNotIn("secret", output)
        self.assertNotIn("private stderr", output)
        self.assertEqual((self.directory / "npm-audit.json").read_bytes(), raw)
        self.assertEqual(json.loads(output)["status"], "rejected")
        self.assertFalse((self.directory / "receipt.json").exists())

    def test_timeout_retains_partial_output_and_rejects(self):
        output = io.StringIO()
        with mock.patch.object(audit.sys, "argv", [str(SCRIPT), "--phase", "preinstall"]), \
             mock.patch.object(audit.Path, "cwd", return_value=self.root), \
             mock.patch.object(audit, "verify_checkout"), \
             mock.patch.object(audit, "trusted_blob"), \
             mock.patch.object(audit.subprocess, "run", side_effect=subprocess.TimeoutExpired(
                 "npm", 120, output=b"private partial inventory", stderr=b"private timeout")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(audit.main(), 1)
        self.assertNotIn("private", output.getvalue())
        self.assertEqual((self.directory / "npm-audit.json").read_bytes(), b"private partial inventory")

    def test_output_outside_runner_existing_or_symlink_directory_rejects(self):
        for destination in (str(self.root.parent / "outside-audit"), str(self.root)):
            with mock.patch.dict(os.environ, {"BECORE_AUDIT_DIRECTORY": destination}), \
                 self.assertRaises(audit.AuditRejected):
                audit.private_directory()
        self.directory.mkdir()
        with self.assertRaises(audit.AuditRejected):
            audit.private_directory()
        linked = self.root / "linked"
        linked.symlink_to(self.directory, target_is_directory=True)
        with mock.patch.dict(os.environ, {"BECORE_AUDIT_DIRECTORY": str(linked / "new")}), \
             self.assertRaises(audit.AuditRejected):
            audit.private_directory()

    def test_only_two_phase_choices_are_accepted_no_policy_override(self):
        for arguments in ([], ["--ignore-expiry"], ["--phase", "skip"], ["--phase", "preinstall", "--registry", "evil"]):
            with self.subTest(arguments=arguments), \
                 mock.patch.object(audit.sys, "argv", [str(SCRIPT), *arguments]), \
                 mock.patch.object(audit.subprocess, "run") as run, \
                 contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                audit.main()
            run.assert_not_called()
        self.assertFalse(self.directory.exists())

    def test_missing_output_or_write_failure_cannot_become_success(self):
        with mock.patch.dict(os.environ, {"BECORE_AUDIT_DIRECTORY": ""}), self.assertRaises(audit.AuditRejected):
            audit.private_directory()
        with mock.patch.object(audit, "write_private", side_effect=OSError("private secret path")):
            status, output = self.invoke(clean_report(), 0, outcome="clean")
        self.assertEqual(status, 1)
        self.assertNotIn("secret", output)

    def test_report_and_receipt_cannot_be_changed_together(self):
        self.capture()
        raw = clean_report()
        (self.directory / "npm-audit.json").write_bytes(raw)
        path = self.directory / "preinstall-receipt.json"
        forged = json.loads(path.read_bytes())
        forged.update(status="clean", npmExitCode=0, reportSha256=hashlib.sha256(raw).hexdigest())
        path.write_text(json.dumps(forged))
        with self.assertRaisesRegex(audit.AuditRejected, "Preinstall receipt changed"):
            self.finish("clean")

    def test_raw_report_tamper_and_wrong_identity_reject(self):
        self.capture()
        path = self.directory / "npm-audit.json"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaisesRegex(audit.AuditRejected, "output changed"):
            self.finish()
        with self.assertRaisesRegex(audit.AuditRejected, "Invalid preinstall receipt"):
            audit.postinstall(self.directory, self.root, "a" * 40, "c" * 40)

    def test_both_manifest_changes_after_install_are_rejected(self):
        self.capture()
        for name in ("package.json", "package-lock.json"):
            path = self.root / name
            original = path.read_bytes()
            path.write_bytes(original + b"\n")
            with self.subTest(name=name), self.assertRaisesRegex(audit.AuditRejected, "manifests changed"):
                self.finish()
            path.write_bytes(original)

    def test_private_copied_manifest_changes_and_modes_reject(self):
        self.capture()
        path = self.directory / "manifests/package.json"
        original = path.read_bytes()
        path.write_bytes(original + b"\n")
        with self.assertRaisesRegex(audit.AuditRejected, "copies changed"):
            self.finish()
        path.write_bytes(original)
        path.chmod(0o644)
        with self.assertRaisesRegex(audit.AuditRejected, "Unsafe private"):
            self.finish()

    def test_private_evidence_symlink_hardlink_and_directory_permissions_reject(self):
        self.capture()
        path = self.directory / "npm-audit.stderr"
        other = self.directory / "linked-stderr"
        os.link(path, other)
        with self.assertRaisesRegex(audit.AuditRejected, "Unsafe private"):
            self.finish()
        other.unlink()
        raw = path.read_bytes()
        path.unlink()
        target = self.root / "outside"
        target.write_bytes(raw)
        path.symlink_to(target)
        with self.assertRaises(OSError):
            self.finish()
        self.directory.chmod(0o755)
        with self.assertRaisesRegex(audit.AuditRejected, "Unsafe private audit directory"):
            audit.private_directory(create=False)

    def test_missing_independent_receipt_digest_rejects(self):
        self.capture()
        os.environ.pop("BECORE_PREINSTALL_RECEIPT_SHA256")
        with self.assertRaisesRegex(audit.AuditRejected, "independently retained"):
            self.finish()

    def test_github_step_output_contains_only_receipt_digest(self):
        output = self.root / "step-output"
        with mock.patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}):
            digest = self.capture()
        self.assertEqual(output.read_text(), "audit_receipt_sha256=" + digest + "\n")

    def test_shrinkwrap_file_or_dangling_symlink_rejects_before_network(self):
        path = self.root / "npm-shrinkwrap.json"
        for symlink in (False, True):
            if symlink:
                path.symlink_to("missing-shrinkwrap.json")
            else:
                path.write_text("{}")
            with self.subTest(symlink=symlink), \
                 mock.patch.object(audit.subprocess, "run") as run, \
                 self.assertRaisesRegex(audit.AuditRejected, "override the audited package lock"):
                audit.manifests(self.root)
            run.assert_not_called()
            path.unlink()

    def test_unsupported_workspaces_links_and_duplicate_manifest_keys_reject_before_network(self):
        for name, raw in (("package.json", b'{"workspaces":["hidden"]}'),
                          ("package.json", b'{"name":"first","name":"second"}'),
                          ("package-lock.json", b'{"lockfileVersion":3,"packages":{"x":{"link":true}}}'),
                          ("package-lock.json", b'{"lockfileVersion":3,"packages":{"":null}}')):
            path = self.root / name
            original = path.read_bytes()
            path.write_bytes(raw)
            with self.subTest(name=name), self.assertRaises(ValueError):
                audit.manifests(self.root)
            path.write_bytes(original)

    def test_installed_validation_failure_or_expiry_prevents_final_receipt(self):
        self.capture()
        with mock.patch.object(audit, "evaluate_report", side_effect=ValueError("expired or changed bytes")), \
             self.assertRaises(ValueError):
            audit.postinstall(self.directory, self.root, "a" * 40, "b" * 40)
        self.assertFalse((self.directory / "receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
