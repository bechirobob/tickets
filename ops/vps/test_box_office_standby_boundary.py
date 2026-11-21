"""Real Git fixtures; no Cloudflare, network, secrets, or work outside temporary trees."""
import importlib.util
import subprocess
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

    def test_exact_box_office_only_defers_cloudflare(self):
        self.assertFalse(self.outcome())

    def test_later_unrelated_main_push_still_allows(self):
        self.put('app/later.tsx', 'ordinary future app work')
        self.assertTrue(self.outcome(before=self.head, head=self.commit('ordinary later push')))

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
        self.assertIn('if [ "$GITHUB_EVENT_NAME" = workflow_dispatch ]; then', gate)
        self.assertIn("echo 'allow_cloudflare=true'", gate)
        self.assertIn("if: needs.box_office_standby_boundary.outputs.allow_cloudflare == 'true'", existing)
        self.assertIn('CLOUDFLARE_API_TOKEN', existing)


if __name__ == '__main__':
    unittest.main()
