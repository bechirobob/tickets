"""Offline exact-tree and negative release-isolation tests."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import recovery_maintenance as maintenance
import recovery_maintenance_test_support as support


class RecoveryMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.write('app/live.txt', b'unchanged application\n')
        self.write('ops/vps/code-release.py', b'unchanged admission\n')
        self.base = self.commit()
        self.scope = set(maintenance.ALLOWED)
        for path in self.scope:
            self.write(path, b'reviewed synthetic maintenance: ' + path.encode() + b'\n')
        for path in maintenance.WORKFLOWS:
            self.write(path, b'          RECOVERY_MAINTENANCE_SOURCE: REVIEWED_RECOVERY_SOURCE\n')
        self.payload = self.commit()
        for path in maintenance.WORKFLOWS:
            self.write(path, b'          RECOVERY_MAINTENANCE_SOURCE: ' + self.payload.encode() + b'\n')
        self.candidate = self.commit()
        self.patcher = patch.object(maintenance, 'BASE', self.base)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL).decode().strip()

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'Synthetic fixture')
        return self.git('rev-parse', 'HEAD')

    def classify(self, **overrides):
        arguments = dict(event='push', repository='bechirobob/tickets', ref='refs/heads/main',
                         before=self.base, reviewed=self.payload, candidate=self.git('rev-parse', 'HEAD'))
        arguments.update(overrides)
        return maintenance.classify(self.root, **arguments)

    def test_exact_pin_commit_and_merge_only(self):
        self.assertTrue(self.classify())
        self.git('checkout', '-qb', 'synthetic-main', self.base)
        self.git('merge', '--no-ff', '-qm', 'Exact reviewed merge', self.candidate)
        self.assertTrue(self.classify())

    def test_manual_other_repo_branch_event_before_never_suppresses_release(self):
        for values in ({'event':'workflow_dispatch'}, {'repository':'other/tickets'}, {'ref':'refs/heads/feature'},
                       {'before':'0'*40}, {'event':'pull_request'}):
            with self.subTest(values=values):
                self.assertFalse(self.classify(**values))

    # Reconstructed gap in retained block 4: exercise mixed and unknown changes.
    def test_changed_added_mode_and_deleted_paths_reject(self):
        for name in (*sorted(self.scope), 'app/live.txt', 'ops/vps/code-release.py', 'unknown.txt'):
            with self.subTest(name=name):
                self.git('reset', '--hard', self.candidate)
                self.write(name, b'unreviewed\n')
                changed = self.commit()
                with self.assertRaises(ValueError): self.classify(candidate=changed)
        self.git('reset', '--hard', self.candidate)
        (self.root / 'app/live.txt').chmod(0o755)
        with self.assertRaises(ValueError): self.classify(candidate=self.commit())
        self.git('reset', '--hard', self.candidate)
        (self.root / 'app/live.txt').unlink()
        with self.assertRaises(ValueError): self.classify(candidate=self.commit())

    def test_wrong_source_dirty_checkout_and_wrong_ancestry_reject(self):
        for reviewed in ('main', self.base, '0'*40):
            with self.assertRaises((ValueError, subprocess.SubprocessError)):
                self.classify(reviewed=reviewed)
        self.write('untracked', b'unreviewed')
        with self.assertRaises(ValueError): self.classify()
        (self.root/'untracked').unlink()
        self.write('app/live.txt', b'dirty tracked')
        with self.assertRaises(ValueError): self.classify()
        self.git('reset', '--hard', self.candidate)
        self.git('commit', '--allow-empty', '-qm', 'Unreviewed later empty commit')
        with self.assertRaises(ValueError): self.classify()

    def test_reviewed_payload_cannot_expand_scope_or_change_admission(self):
        self.git('checkout', '-q', self.payload)
        self.write('ops/vps/code-release.py', b'changed admission')
        altered = self.commit()
        with self.assertRaises(ValueError): maintenance.expected_inventory(self.root, altered)
        self.git('checkout', '-q', self.payload)
        (self.root / 'docs/runbooks/d1-recovery.md').unlink()
        with self.assertRaises(ValueError): maintenance.expected_inventory(self.root, self.commit())


class RecoveryWorkflowTests(unittest.TestCase):
    def test_existing_release_workflows_reconstruct_exact_baseline(self):
        for path in maintenance.WORKFLOWS:
            raw = (support.ROOT/path).read_bytes()
            self.assertEqual(support.digest(support.restore_workflow(path, raw)), support.BASE_WORKFLOWS[path])
            for mutation in (raw+b'\n# extra', raw.replace(b'contents: read', b'contents: write', 1),
                             raw.replace(b"matches != 'true'", b"matches == 'true'", 1)):
                self.assertNotEqual(support.digest(support.restore_workflow(path, mutation)), support.BASE_WORKFLOWS[path])

    def test_every_release_step_is_guarded_and_manual_dispatch_remains(self):
        for path in maintenance.WORKFLOWS:
            text = (support.ROOT/path).read_text()
            target = text.split('      - name: Classify exact recovery maintenance\n', 1)[1]
            release_steps = target.split('      - name: Verify exact source ancestry', 1)[1]
            if path.endswith('vps-runtime.yml'):
                release_steps = release_steps.split('\n  handoff:', 1)[0]
                self.assertIn("    if: needs.verify.outputs.recovery_maintenance != 'true'", text)
            steps = ('      - name: Verify exact source ancestry'+release_steps).split('      - ')[1:]
            self.assertTrue(steps)
            for step in steps:
                self.assertEqual(step.count("        if: steps.recovery_maintenance.outputs.matches != 'true'"), 1)
            self.assertIn('git show "$RECOVERY_MAINTENANCE_SOURCE:ops/vps/recovery_maintenance.py"', target)
            self.assertIn('python3 -I "$RUNNER_TEMP/recovery-maintenance.py"', target)
        self.assertIn('  workflow_dispatch:', (support.ROOT/maintenance.WORKFLOWS[0]).read_text())

    def test_production_admission_sources_are_outside_maintenance_scope(self):
        for path in ('ops/vps/code-release.py', 'ops/vps/runtime_release.py', 'ops/vps/public_runtime_guard.py',
                     'scripts/audit-release-dependencies.py', 'package.json', 'package-lock.json'):
            self.assertNotIn(path, maintenance.ALLOWED)
        self.assertEqual(set(support.PATHS), maintenance.ALLOWED)


if __name__ == '__main__':
    unittest.main()
