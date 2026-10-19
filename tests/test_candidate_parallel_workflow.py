"""Parallel workflow coverage and default parallel admission contract tests."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
BROWSERS = ('desktop-chromium','mobile-chromium','mobile-webkit')


class ParallelWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.old=(ROOT/'.github/workflows/candidate-checks.yml').read_text()
        self.new=(ROOT/'.github/workflows/candidate-parallel-checks.yml').read_text()

    def test_parallel_default_exact_branch_push_or_dispatch_with_explicit_legacy_recovery(self):
        self.assertIn('Single-job candidate verification missing or incomplete.',(ROOT/'ops/vps/code-release.py').read_text())
        operator=(ROOT/'ops/vps/code-release.py').read_text()
        self.assertIn('getattr(args, "candidate_mode", "parallel-v1")',operator)
        self.assertIn('choices=("legacy", "parallel-v1"), default="parallel-v1"',operator)
        self.assertIn('candidate_mode in ("legacy", "parallel-v1")',operator)
        self.assertIn('validate_parallel_proof(proof',operator)
        self.assertNotIn('  pull_request:',self.new)
        self.assertIn("branches: ['**', '!main']",self.new)
        self.assertNotIn('  pull_request:', self.old)
        self.assertIn('  workflow_dispatch:', self.old)
        self.assertEqual(self.new.count('BECORE_TRUSTED_BASE: ${{ needs.build.outputs.trusted_base }}'), 3)
        self.assertNotIn('d257f41b669a542de0eebbe09993e7efa8dd5074', self.new)
        self.assertIn('BECORE_RELEASE_SHA: ${{ github.sha }}',self.new)
        self.assertEqual(re.findall(r'^  ([a-z_]+):$',self.new.split('jobs:\n',1)[1],re.M),
                         ['build','desktop_chromium','mobile_chromium','mobile_webkit','verify'])

    def test_operator_checks_trigger_for_each_parallel_helper_and_test(self):
        workflow=(ROOT/'.github/workflows/tickets-release-operator-checks.yml').read_text()
        paths=workflow.split('    paths:\n',1)[1].split('  workflow_dispatch:',1)[0]
        for name in ('candidate_build.py','parallel_candidate.py','parallel_candidate_control.py',
                     'test_candidate_build.py','test_parallel_candidate.py',
                     'test_parallel_candidate_control.py','test_parallel_admission.py',
                     'test_parallel_source_family.py'):
            self.assertIn('      - ops/vps/' + name + '\n', paths)

    def test_every_original_browser_command_preserved(self):
        for browser in BROWSERS:
            start=self.old.index(f'      - name: Prepare isolated event fixtures ({browser})')
            end=self.old.find('      - name: Verify and restore the exact candidate build',start)
            block=self.old[start:end if end!=-1 else None]
            self.assertIn(block.strip(),self.new)
        core=self.old[self.old.index('      - name: Lint application'):self.old.index('      - name: Package verified browser build')]
        self.assertIn(core,self.new)
        self.assertEqual(self.new.count('run: npm test\n'),1)

    def test_readonly_same_run_immutable_bounded_artifact_and_no_cache(self):
        self.assertIn('permissions:\n  contents: read',self.new)
        for forbidden in ('actions: write','contents: write','id-token:', 'secrets.', 'github-token:', 'actions/cache', 'cache: npm','continue-on-error','strategy:'):
            self.assertNotIn(forbidden,self.new)
        self.assertIn('retention-days: 1',self.new);self.assertIn('overwrite: false',self.new)
        self.assertIn('if-no-files-found: error',self.new)
        self.assertEqual(self.new.count('artifact-ids: ${{ needs.build.outputs.artifact_id }}'),3)
        self.assertEqual(self.new.count('python3 ops/vps/candidate_build.py restore'),3)

    def test_all_consumers_reaudit_and_aggregate_explicit_success(self):
        self.assertEqual(self.new.count('run: npm ci --no-audit'),4)
        self.assertEqual(self.new.count('--phase preinstall'),4)
        self.assertEqual(self.new.count('--phase postinstall'),4)
        for name in ('BUILD','DESKTOP','MOBILE','WEBKIT'):self.assertIn(f'test "${name}" = success',self.new)
        self.assertIn('if: ${{ always() }}',self.new)
        self.assertIn('needs: [build, desktop_chromium, mobile_chromium, mobile_webkit]',self.new)


if __name__=='__main__': unittest.main()
