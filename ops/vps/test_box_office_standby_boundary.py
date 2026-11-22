"""Real Git fixtures; no Cloudflare, network, secrets, or work outside temporary trees."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('standby_boundary', Path(__file__).with_name('box_office_standby_boundary.py'))
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class StandbyBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Release fixture')
        self.git('config', 'user.email', 'release@example.invalid')
        self.put('app/page.tsx', 'baseline app')
        self.put('package.json', '{"dependencies":{"next":"16.4.1"}}')
        self.put('.github/workflows/deploy.yml', 'old workflow')
        self.base = self.commit('baseline')
        self.put('app/page.tsx', 'reviewed visual')
        self.put('package.json', '{"dependencies":{"next":"16.4.6"}}')
        self.snapshot = self.commit('snapshot')
        self.git('checkout', '-q', '--detach', self.base)
        for path in boundary.CONTROLS:
            self.put(path, 'approved independent controls')
        self.trusted = self.commit('controls only')
        self.git('merge', '--no-ff', '-m', 'exact app + independent controls', self.snapshot)
        self.head = self.git('rev-parse', 'HEAD')
        self.context = dict(repository=boundary.REPOSITORY, ref=boundary.MAIN, event='push',
            before=self.trusted, head=self.head, base=self.base, base_tree=self.rev_tree(self.base),
            snapshot=self.snapshot, snapshot_tree=self.rev_tree(self.snapshot))

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True, stderr=subprocess.PIPE).strip()

    def put(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, label):
        self.git('add', '-A')
        self.git('commit', '-qm', label)
        return self.git('rev-parse', 'HEAD')

    def rev_tree(self, revision):
        return self.git('rev-parse', revision + '^{tree}')

    def outcome(self, **overrides):
        return boundary.allow_cloudflare(self.root, **(self.context | overrides))

    def canvas_fixture(self):
        self.put('app/page.tsx', 'reviewed follow-up visual')
        snapshot = self.commit('follow-up app only')
        self.git('checkout', '-q', '--detach', self.head)
        for path in boundary.CANVAS_CONTROLS:
            self.put(path, 'reviewed independent follow-up controls')
        trusted = self.commit('follow-up controls only')
        self.git('merge', '--no-ff', '-m', 'exact follow-up and independent controls', snapshot)
        return trusted, snapshot, self.git('rev-parse', 'HEAD')

    def classify_canvas(self, trusted, snapshot, head, missing=None):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'step-output'
            env = dict(os.environ, GITHUB_REPOSITORY=boundary.REPOSITORY,
                GITHUB_REF=boundary.MAIN, GITHUB_EVENT_NAME='push', GITHUB_SHA=head, GITHUB_OUTPUT=str(output),
                BECORE_PUSH_BEFORE=trusted,
                BECORE_BOX_BASE=self.base, BECORE_BOX_BASE_TREE=self.rev_tree(self.base),
                BECORE_BOX_SNAPSHOT=self.snapshot, BECORE_BOX_SNAPSHOT_TREE=self.rev_tree(self.snapshot),
                BECORE_CANVAS_BASE=self.head, BECORE_CANVAS_BASE_TREE=self.rev_tree(self.head),
                BECORE_CANVAS_SNAPSHOT=snapshot, BECORE_CANVAS_SNAPSHOT_TREE=self.rev_tree(snapshot),
                BECORE_UNIFIED_BASE=self.head, BECORE_UNIFIED_BASE_TREE=self.rev_tree(self.head),
                BECORE_UNIFIED_SNAPSHOT='f' * 40, BECORE_UNIFIED_SNAPSHOT_TREE='f' * 40)
            if missing:
                del env[missing]
            result = subprocess.run([sys.executable, '-I', boundary.__file__], cwd=self.root, env=env,
                                    text=True, capture_output=True, timeout=15)
            return result.returncode, output.read_text() if output.exists() else ''

    def test_exact_box_office_only_defers_cloudflare(self):
        self.assertFalse(self.outcome())

    def test_later_unrelated_main_push_still_allows(self):
        self.put('app/later.tsx', 'ordinary future app work')
        self.assertTrue(self.outcome(before=self.head, head=self.commit('ordinary later push')))

    def test_exact_canvas_push_defers_then_later_unrelated_main_allows(self):
        trusted, snapshot, head = self.canvas_fixture()
        self.assertEqual(self.classify_canvas(trusted, snapshot, head), (0, 'allow_cloudflare=false\n'))
        self.put('app/later.tsx', 'ordinary future app work')
        future = self.commit('ordinary later push')
        self.assertEqual(self.classify_canvas(head, snapshot, future), (0, 'allow_cloudflare=true\n'))

    def test_canvas_snapshot_missing_ancestry_or_pin_fails_closed(self):
        trusted, snapshot, head = self.canvas_fixture()
        for pin in ('BECORE_CANVAS_BASE', 'BECORE_CANVAS_BASE_TREE', 'BECORE_CANVAS_SNAPSHOT', 'BECORE_CANVAS_SNAPSHOT_TREE'):
            with self.subTest(pin=pin):
                self.assertEqual(self.classify_canvas(trusted, snapshot, head, missing=pin), (1, ''))
        self.git('checkout', '-q', '--detach', trusted)
        self.put('app/page.tsx', 'unreviewed app')
        self.assertEqual(self.classify_canvas(trusted, snapshot, self.commit('wrong app')), (1, ''))

    def test_canvas_rejects_changed_app_control_or_mode(self):
        trusted, snapshot, head = self.canvas_fixture()
        for mutation in (
            lambda: self.put('app/extra.tsx', 'unreviewed app'),
            lambda: self.put('.github/workflows/deploy.yml', 'unreviewed controls'),
            lambda: (self.root / 'app/page.tsx').chmod(0o755),
        ):
            self.git('reset', '--hard', head)
            mutation()
            self.assertEqual(self.classify_canvas(trusted, snapshot, self.commit('unreviewed merge bytes')), (1, ''))

    def test_canvas_first_appearance_without_controls_fails_closed(self):
        _trusted, snapshot, _head = self.canvas_fixture()
        self.git('checkout', '-q', '--detach', self.head)
        self.put('README.md', 'ordinary unrelated work')
        before = self.commit('unexpected prior main')
        self.git('merge', '--no-ff', '-m', 'app without independently staged controls', snapshot)
        self.assertEqual(self.classify_canvas(before, snapshot, self.git('rev-parse', 'HEAD')), (1, ''))

    def test_unified_after_consumed_canvas_admits_only_exact_vps_tree(self):
        canvas_controls, canvas_snapshot, active = self.canvas_fixture()
        self.put('app/page.tsx', 'reviewed unified public surface')
        snapshot = self.commit('unified app only')
        self.git('checkout', '-q', '--detach', active)
        for path in boundary.UNIFIED_CONTROLS:
            self.put(path, 'third independently reviewed controls')
        trusted = self.commit('unified controls only')
        self.git('merge', '--no-ff', '-m', 'compose exact unified app and controls', snapshot)
        deployed = self.git('rev-parse', 'HEAD')
        def classify(before, head, **overrides):
            with tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / 'step-output'
                env = dict(os.environ, GITHUB_REPOSITORY=boundary.REPOSITORY,
                    GITHUB_REF=boundary.MAIN, GITHUB_EVENT_NAME='push', GITHUB_SHA=head,
                    GITHUB_OUTPUT=str(output), BECORE_PUSH_BEFORE=before,
                    BECORE_BOX_BASE=self.base, BECORE_BOX_BASE_TREE=self.rev_tree(self.base),
                    BECORE_BOX_SNAPSHOT=self.snapshot, BECORE_BOX_SNAPSHOT_TREE=self.rev_tree(self.snapshot),
                    BECORE_CANVAS_BASE=self.head, BECORE_CANVAS_BASE_TREE=self.rev_tree(self.head),
                    BECORE_CANVAS_SNAPSHOT=canvas_snapshot, BECORE_CANVAS_SNAPSHOT_TREE=self.rev_tree(canvas_snapshot),
                    BECORE_UNIFIED_BASE=active, BECORE_UNIFIED_BASE_TREE=self.rev_tree(active),
                    BECORE_UNIFIED_SNAPSHOT=snapshot, BECORE_UNIFIED_SNAPSHOT_TREE=self.rev_tree(snapshot))
                result = subprocess.run([sys.executable, '-I', boundary.__file__], cwd=self.root,
                                        env=env | overrides, capture_output=True, timeout=15)
                return result.returncode, output.read_text() if output.exists() else ''
        # The controls-only push itself is ignored by deploy.yml (checked below).
        self.assertEqual(self.git('diff', '--name-only', active, trusted).splitlines(),
                         sorted(boundary.UNIFIED_CONTROLS))
        self.assertEqual(classify(trusted, deployed), (0, 'allow_cloudflare=false\n'))
        self.assertEqual(classify(trusted, deployed, BECORE_UNIFIED_SNAPSHOT='f' * 40), (1, ''))
        self.assertEqual(classify(trusted, deployed, BECORE_UNIFIED_SNAPSHOT_TREE='f' * 40), (1, ''))
        self.git('checkout', '-q', '--detach', snapshot)
        self.assertEqual(classify(active, snapshot), (1, ''))
        for name in ('app/unreviewed.tsx', 'drizzle/9999_unreviewed.sql'):
            self.git('reset', '--hard', deployed)
            self.put(name, 'unreviewed')
            self.assertEqual(classify(trusted, self.commit('unreviewed merge')), (1, ''))
        self.git('reset', '--hard', deployed)
        self.put('app/ordinary.tsx', 'unrelated future change')
        self.assertEqual(classify(deployed, self.commit('later ordinary push')), (0, 'allow_cloudflare=true\n'))

    def test_unrelated_push_without_pending_controls_still_allows(self):
        self.git('checkout', '-q', '--detach', self.base)
        self.put('app/earlier.tsx', 'ordinary unrelated app work')
        self.assertTrue(self.outcome(before=self.base, head=self.commit('ordinary earlier push')))

    def test_exact_intended_slot_without_snapshot_ancestry_fails_closed(self):
        self.git('checkout', '-q', '--detach', self.trusted)
        self.put('app/page.tsx', 'edited, not the reviewed snapshot')
        with self.assertRaisesRegex(boundary.BoundaryError, 'missing or drifted'):
            self.outcome(head=self.commit('wrong release'))

    def test_unexpected_ancestor_for_first_snapshot_appearance_fails_closed(self):
        self.git('checkout', '-q', '--detach', self.base)
        self.put('README.md', 'an unrelated earlier change')
        wrong_before = self.commit('unexpected prior main')
        self.git('merge', '--no-ff', '-m', 'snapshot without exact controls', self.snapshot)
        with self.assertRaisesRegex(boundary.BoundaryError, 'missing or drifted'):
            self.outcome(before=wrong_before, head=self.git('rev-parse', 'HEAD'))

    def test_after_exact_merge_any_added_app_control_or_mode_drift_fails(self):
        mutations = (
            lambda: self.put('app/extra.tsx', 'not reviewed'),
            lambda: self.put('.github/workflows/deploy.yml', 'not prior reviewed bytes'),
            lambda: (self.root / 'app/page.tsx').chmod(0o755),
        )
        for mutation in mutations:
            self.git('reset', '--hard', self.head)
            mutation()
            with self.assertRaisesRegex(boundary.BoundaryError, 'merge tree differs'):
                self.outcome(head=self.commit('head differs'))

    def test_identity_and_pin_mismatch_fail_before_allowing(self):
        cases = (
            {'snapshot_tree': 'f' * 40}, {'base_tree': 'f' * 40}, {'head': self.trusted},
            {'ref': 'refs/heads/other'}, {'repository': 'somewhere/else'}, {'event': 'workflow_dispatch'},
        )
        for override in cases:
            with self.subTest(override=override), self.assertRaises(boundary.BoundaryError):
                self.outcome(**override)

    def test_dirty_checkout_is_never_approved(self):
        self.put('README.md', 'untracked fixture')
        with self.assertRaisesRegex(boundary.BoundaryError, 'clean main push'):
            self.outcome()

    def test_workflow_keeps_manual_path_and_credentials_outside_boundary(self):
        source = (Path(__file__).resolve().parents[2] / '.github/workflows/deploy.yml').read_text()
        gate, existing = source.split('  deploy:\n', 1)
        self.assertNotIn('CLOUDFLARE_API_TOKEN', gate)
        self.assertIn('persist-credentials: false', gate)
        self.assertIn('git show "$BECORE_PUSH_BEFORE:ops/vps/box_office_standby_boundary.py"', gate)
        ignored = gate.split('  workflow_dispatch:', 1)[0]
        for path in boundary.CANVAS_CONTROLS | boundary.UNIFIED_CONTROLS:
            self.assertIn(f"      - '{path}'\n", ignored)
        self.assertIn('if [ "$GITHUB_EVENT_NAME" = workflow_dispatch ]; then', gate)
        self.assertIn("echo 'allow_cloudflare=true'", gate)
        self.assertIn("if: needs.box_office_standby_boundary.outputs.allow_cloudflare == 'true'", existing)
        self.assertIn('CLOUDFLARE_API_TOKEN', existing)


if __name__ == '__main__':
    unittest.main()
