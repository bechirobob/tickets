"""Finite default-parallel rollout tests; real isolated Git, no external access."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import test_code_release as controls
import test_parallel_admission as parallel_tests

release = controls.release


def blob(raw):
    return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


class DefaultRolloutFixture:
    """Exact L/B/C/P fixture shared by the independently added P-only suite."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        previous = Path.cwd(); os.chdir(self.root); self.addCleanup(os.chdir, previous)
        self.git('init', '-q'); self.git('config', 'user.name', 'Local rollout tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.base_files = {name: ('baseline ' + name + '\n').encode() for name in (
            'package.json', 'package-lock.json', 'app/page.tsx', 'drizzle/0001.sql', 'README.md',
            'ops/vps/runtime_release.py', *release.DEFAULT_PARALLEL_CONTROL_FILES,
            *(name for name in release.DEFAULT_PARALLEL_OUTPUT_BLOBS
              if name not in (release.DEFAULT_PARALLEL_ADMISSION_FILE, release.DEFAULT_PARALLEL_PROMOTION_FILE)))}
        for name, raw in self.base_files.items(): self.write(name, raw)
        self.live = self.commit(); live_tree = self.git('rev-parse', 'HEAD^{tree}')
        self.base_outputs = {name: ('completed activation ' + name + '\n').encode()
                             for name in release.DEFAULT_PARALLEL_BASE_BLOBS}
        for name, raw in self.base_outputs.items(): self.write(name, raw)
        self.base = self.commit(); base_tree = self.git('rev-parse', 'HEAD^{tree}')
        self.base_files.update(self.base_outputs)
        self.outputs = {name: ('reviewed output ' + name + '\n').encode()
                        for name in release.DEFAULT_PARALLEL_OUTPUT_BLOBS}
        for name, raw in self.outputs.items():
            if name != release.DEFAULT_PARALLEL_PROMOTION_FILE: self.write(name, raw)
        for name in release.DEFAULT_PARALLEL_CONTROL_FILES: self.write(name, b'independent reviewed control\n')
        self.control = self.commit()
        self.write(release.DEFAULT_PARALLEL_PROMOTION_FILE, self.outputs[release.DEFAULT_PARALLEL_PROMOTION_FILE])
        self.source = self.commit(); self.git('update-ref', 'refs/remotes/origin/main', self.source)
        self.pins = {name: blob(raw) for name, raw in self.outputs.items()}
        self.staged_base = {name: ('100644', blob(raw)) for name, raw in self.base_files.items()
                            if name.startswith('ops/vps/') or name in controls.DEFAULT_PARALLEL_STAGED_BASE}
        for item in (
            patch.object(release, 'DEFAULT_PARALLEL_LIVE_BASELINE', self.live),
            patch.object(release, 'DEFAULT_PARALLEL_LIVE_TREE', live_tree),
            patch.object(release, 'DEFAULT_PARALLEL_MAIN_BASELINE', self.base),
            patch.object(release, 'DEFAULT_PARALLEL_MAIN_TREE', base_tree),
            patch.object(release, 'DEFAULT_PARALLEL_BASE_BLOBS', {name: blob(raw) for name, raw in self.base_outputs.items()}),
            patch.object(release, 'DEFAULT_PARALLEL_OUTPUT_BLOBS', self.pins),
            patch.object(release, '__file__', str(self.root / 'ops/vps/code-release.py')),
            patch.object(controls, 'DEFAULT_PARALLEL_OPERATOR_BLOB', blob(b'independent reviewed control\n')),
            patch.object(controls, 'DEFAULT_PARALLEL_STAGED_BASE', self.staged_base),
            patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)):
            item.start(); self.addCleanup(item.stop)

    def git(self, *args):
        return subprocess.check_output(['git', '--no-replace-objects', '-C', str(self.root), *args],
            stderr=subprocess.DEVNULL, env=release.git_environment()).decode().strip()

    def write(self, name, raw):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink(): path.unlink()
        path.write_bytes(raw); path.chmod(0o644); return path

    def commit(self):
        self.git('add', '-A'); self.git('commit', '-qm', 'isolated default rollout')
        return self.git('rev-parse', 'HEAD')

    def reset(self, revision=None):
        self.git('reset', '--hard', revision or self.source); self.git('clean', '-fdq')

    def staged(self, root, promoted):
        manifest = dict(self.staged_base)
        manifest.update({name: ('100644', self.pins[name]) for name in self.outputs
                         if (name.startswith('ops/vps/') or name in self.staged_base)
                         and (promoted or name != release.DEFAULT_PARALLEL_PROMOTION_FILE)})
        for name in manifest:
            raw = (b'independent reviewed control\n' if name in release.DEFAULT_PARALLEL_CONTROL_FILES
                   else self.outputs.get(name, self.base_files.get(name)))
            path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
        return manifest


class DefaultParallelAdmissionTests(DefaultRolloutFixture, unittest.TestCase):
    def test_exact_live_main_controls_and_promotion_admit_no_migrations(self):
        changes = release.vetted_changes(self.live, self.source)
        self.assertEqual(set(changes), set(self.base_outputs) | set(self.pins) | release.DEFAULT_PARALLEL_CONTROL_FILES)
        self.assertEqual(release.migration_plan(changes), [])
        for name in ('app/page.tsx', 'package.json', 'package-lock.json', 'drizzle/0001.sql'):
            self.assertEqual(self.git('ls-tree', self.live, '--', name), self.git('ls-tree', self.source, '--', name))

    def test_unapproved_application_dependencies_migration_docs_tests_and_deletion_reject(self):
        for name in ('app/page.tsx', 'package.json', 'package-lock.json', 'drizzle/0002.sql',
                     'docs/unreviewed.md', 'tests/unreviewed.py', 'README.md'):
            self.reset(); self.write(name, b'not reviewed\n'); source = self.commit()
            with self.subTest(name=name), self.assertRaisesRegex(release.ReleaseError, 'promotion'):
                release.vetted_changes(self.live, source)
        self.reset(); (self.root / 'README.md').unlink()
        with self.assertRaisesRegex(release.ReleaseError, 'deletion'):
            release.vetted_changes(self.live, self.commit())

    def test_every_output_and_control_is_immutable_in_p(self):
        for name in (*self.outputs, *release.DEFAULT_PARALLEL_CONTROL_FILES, *self.base_outputs):
            self.reset(); self.write(name, b'not reviewed\n'); source = self.commit()
            with self.subTest(name=name), self.assertRaises(release.ReleaseError):
                release.vetted_changes(self.live, source)

    def test_unreviewed_control_output_cannot_be_hidden_in_independently_merged_c(self):
        for name in (next(iter(self.outputs)), 'app/page.tsx', 'package-lock.json', 'drizzle/0002.sql'):
            self.reset(self.control); self.write(name, b'not reviewed\n'); control = self.commit()
            self.write(release.DEFAULT_PARALLEL_PROMOTION_FILE, self.outputs[release.DEFAULT_PARALLEL_PROMOTION_FILE])
            source = self.commit(); self.git('update-ref', 'refs/remotes/origin/main', source)
            with self.subTest(name=name), patch.dict(os.environ, BECORE_TRUSTED_BASE=control), self.assertRaises(release.ReleaseError):
                release.vetted_changes(self.live, source)

    def test_missing_p_self_trust_and_p_in_controls_reject(self):
        with self.assertRaises(release.ReleaseError): release.vetted_changes(self.live, self.control)
        for trusted in (self.live, self.base, self.source):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted), self.assertRaisesRegex(release.ReleaseError, 'independent'):
                release.vetted_changes(self.live, self.source)
        self.write('README.md', b'later\n'); later = self.commit()
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.source), self.assertRaisesRegex(release.ReleaseError, 'inventory'):
            release.vetted_changes(self.live, later)

    def test_exact_live_and_main_trees_and_completed_workflow_blob_are_required(self):
        for name in ('DEFAULT_PARALLEL_LIVE_TREE', 'DEFAULT_PARALLEL_MAIN_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaisesRegex(release.ReleaseError, 'baseline'):
                release.vetted_changes(self.live, self.source)
        changed = {name: 'f' * 40 for name in self.base_outputs}
        with patch.object(release, 'DEFAULT_PARALLEL_BASE_BLOBS', changed), self.assertRaisesRegex(release.ReleaseError, 'baseline entry'):
            release.vetted_changes(self.live, self.source)

    def test_merged_controls_and_controls_ancestry_are_independent_requirements(self):
        self.git('update-ref', 'refs/remotes/origin/main', self.base)
        with self.assertRaises(subprocess.CalledProcessError): release.vetted_changes(self.live, self.source)
        self.git('update-ref', 'refs/remotes/origin/main', self.source)
        self.reset(self.base); self.write('ops/vps/code-release.py', b'independent reviewed control\n')
        unrelated = self.commit()
        with self.assertRaises(subprocess.CalledProcessError):
            release.reviewed_default_parallel_application_blobs(self.live, unrelated)

    def test_executable_symlink_and_missing_p_fail_closed(self):
        self.reset(); (self.root / release.DEFAULT_PARALLEL_PROMOTION_FILE).chmod(0o755)
        with self.assertRaisesRegex(release.ReleaseError, 'executable'):
            release.vetted_changes(self.live, self.commit())
        self.reset(); path = self.root / release.DEFAULT_PARALLEL_PROMOTION_FILE
        path.unlink(); path.symlink_to('test_code_release.py')
        with self.assertRaises(release.ReleaseError): release.vetted_changes(self.live, self.commit())


class DefaultParallelVerifyOnlyTests(unittest.TestCase):
    def test_missing_false_and_noncanonical_verify_only_reject_before_checkout(self):
        for value in (None, '', 'false', 'True', '1'):
            env = {} if value is None else {'VERIFY_ONLY': value}
            with self.subTest(value=value), patch.dict(os.environ, env, clear=True), patch.object(release, 'git') as git:
                with self.assertRaisesRegex(release.ReleaseError, 'verification-only'):
                    release.verify_ci(argparse.Namespace(expected=release.DEFAULT_PARALLEL_LIVE_BASELINE))
                git.assert_not_called()

    def test_exact_true_omitted_mode_retains_parallel_proof_and_marks_provenance(self):
        parallel_tests.ParallelCiPipelineTests.setUp(self)
        verifier = parallel_tests.release
        self.args.expected = verifier.DEFAULT_PARALLEL_LIVE_BASELINE
        del self.args.candidate_mode
        with patch.dict(os.environ, VERIFY_ONLY='true'):
            verifier.verify_ci(self.args)
        proof = json.loads(Path(self.args.output).read_text())
        self.assertIs(proof['verificationOnly'], True)
        self.assertEqual(proof['sourceFamily'], verifier.DEFAULT_PARALLEL_SOURCE_FAMILY)
        self.assertEqual(proof['candidateVerification'], parallel_tests.proof_fixture())
        self.assertEqual(proof['migrations'], [])
        self.collector.assert_called_once()


class DefaultParallelHostRejectionTests(controls.DeploymentFixture):
    def test_live_baseline_is_blocked_with_or_without_provenance_before_lock_or_host_writes(self):
        for marked in (False, True):
            self.proof.update(expectedActive=release.DEFAULT_PARALLEL_LIVE_BASELINE)
            if marked: self.proof.update(verificationOnly=True, sourceFamily=release.DEFAULT_PARALLEL_SOURCE_FAMILY)
            self.refresh_digests(); deployment = self.new_deployment(expected=release.DEFAULT_PARALLEL_LIVE_BASELINE)
            for method in (deployment.apply, deployment.preflight, deployment.transact):
                with self.subTest(marked=marked, method=method.__name__), patch.object(release.os, 'open') as opened:
                    with self.assertRaisesRegex(release.ReleaseError, 'verification-only'): method()
                    opened.assert_not_called()
            self.assert_restored()
            self.assertFalse(deployment.snapshot.exists()); self.assertFalse(deployment.release.exists())

    def test_marked_provenance_cannot_be_relabelled_as_another_baseline(self):
        for marker in ({'verificationOnly': True}, {'sourceFamily': release.DEFAULT_PARALLEL_SOURCE_FAMILY}):
            self.proof = {key: value for key, value in self.proof.items() if key not in ('verificationOnly', 'sourceFamily')}
            self.proof.update(marker); self.refresh_digests()
            with self.assertRaisesRegex(release.ReleaseError, 'Verification-only provenance'): self.deployment.transact()
            self.assert_restored()
            self.assertFalse(self.deployment.snapshot.exists()); self.assertFalse(self.deployment.release.exists())


if __name__ == '__main__':
    unittest.main()
