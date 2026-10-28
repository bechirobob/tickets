"""Parallel workflow coverage and explicit opt-in admission contract tests."""
from pathlib import Path
import re
import os
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
BROWSERS = ('desktop-chromium','mobile-chromium','mobile-webkit')


class ParallelWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.old=(ROOT/'.github/workflows/candidate-checks.yml').read_text()
        self.new=(ROOT/'.github/workflows/candidate-parallel-checks.yml').read_text()

    def test_legacy_default_parallel_requires_explicit_mode_exact_branch_or_dispatch(self):
        self.assertIn('Single-job candidate verification missing or incomplete.',(ROOT/'ops/vps/code-release.py').read_text())
        operator=(ROOT/'ops/vps/code-release.py').read_text()
        self.assertIn('getattr(args, "candidate_mode", "legacy")',operator)
        self.assertIn('choices=("legacy", "parallel-v1", "parallel-retry-v3"), default="legacy"',operator)
        self.assertIn('candidate_mode in ("legacy", "parallel-v1", "parallel-retry-v3")',operator)
        self.assertIn('validate_parallel_proof(proof',operator)
        self.assertNotIn('  pull_request:',self.new)
        self.assertIn('branches: [improve/release-evidence-parallel-20261013]',self.new)
        self.assertIn('BECORE_RELEASE_SHA: ${{ github.sha }}',self.new)
        self.assertEqual(re.findall(r'^  ([a-z_]+):$',self.new.split('jobs:\n',1)[1],re.M),
                         ['build','desktop_chromium','mobile_chromium','mobile_webkit','verify'])

    def test_unique_aggregate_with_explicit_serial_fallback(self):
        self.assertIn('  verify:\n    name: tickets-candidate-verified\n', self.new)
        self.assertNotIn('    name: verify\n', self.new)
        self.assertNotIn('  pull_request:', self.old)
        self.assertIn('  workflow_dispatch:', self.old)
        self.assertNotIn('  pull_request:', self.new)
        self.assertNotIn('  pull_request_target:', self.new)
        self.assertIn('  workflow_dispatch:', self.new)

    def test_dispatch_branch_movement_fails_before_candidate_code(self):
        self.assertIn('      expected_source:', self.new)
        self.assertIn("BECORE_EXPECTED_SOURCE: ${{ github.event_name == 'push' && github.sha || inputs.expected_source }}", self.new)
        self.assertEqual(self.new.count('test "$BECORE_RELEASE_SHA" = "$BECORE_EXPECTED_SOURCE"'), 4)
        for block in self.new.split('      - name: Verify exact source ancestry before executing checkout code')[1:]:
            guard = block.split('      - name: Stage trusted audit verifier', 1)[0]
            self.assertIn('test "$BECORE_RELEASE_SHA" = "$BECORE_EXPECTED_SOURCE"', guard)
        release = (ROOT/'.github/workflows/tickets-code-release.yml').read_text()
        self.assertIn('default: parallel-v1', release)
        self.assertIn("CANDIDATE_MODE: ${{ inputs.candidate_mode || 'parallel-v1' }}", release)
        self.assertIn('--candidate-mode "$CANDIDATE_MODE"', release)

    def test_expected_source_guard_rejects_moved_or_malformed_dispatch(self):
        start = self.new.index('          [[ "$BECORE_EXPECTED_SOURCE"')
        end = self.new.index('          test "$BECORE_TRUSTED_BASE"', start)
        script = 'set -euo pipefail\n' + self.new[start:end] + 'printf candidate-code-reached'
        expected = 'a' * 40
        for requested, actual, allowed in ((expected, expected, True),
                                           (expected, 'b' * 40, False),
                                           ('', expected, False),
                                           ('A' * 40, expected, False),
                                           ('main', expected, False)):
            with self.subTest(requested=requested, actual=actual):
                result = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                    env={**os.environ, 'BECORE_EXPECTED_SOURCE': requested, 'BECORE_RELEASE_SHA': actual})
                self.assertEqual(result.returncode == 0, allowed)
                self.assertEqual('candidate-code-reached' in result.stdout, allowed)

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
        self.assertEqual(self.new.count('python3 ops/vps/candidate_build.py restore --'),3)
        self.assertEqual(self.new.count('python3 ops/vps/candidate_build.py restore-retry --'),3)

    def test_all_consumers_reaudit_and_aggregate_explicit_success(self):
        self.assertEqual(self.new.count('run: npm ci --no-audit'),4)
        self.assertEqual(self.new.count('--phase preinstall'),4)
        self.assertEqual(self.new.count('--phase postinstall'),4)
        for name in ('BUILD','DESKTOP','MOBILE','WEBKIT'):self.assertIn(f'test "${name}" = success',self.new)
        self.assertIn('if: ${{ always() }}',self.new)
        self.assertIn('needs: [build, desktop_chromium, mobile_chromium, mobile_webkit]',self.new)

    def test_explicit_retry_transport_is_bounded_and_does_not_skip_lane_checks(self):
        self.assertIn('producer_attempt: ${{ steps.build.outputs.producer_attempt }}',self.new)
        self.assertEqual(self.new.count('BUILD_PRODUCER_ATTEMPT: ${{ needs.build.outputs.producer_attempt }}'),3)
        for browser in BROWSERS:
            block=self.new.split(f'      - name: Verify and restore the exact candidate build ({browser})',1)[1].split('      - name:',1)[0]
            self.assertIn('if [[ "$BUILD_PRODUCER_ATTEMPT" = "$GITHUB_RUN_ATTEMPT" ]]',block)
            self.assertIn('test "$BUILD_PRODUCER_ATTEMPT" = 1',block)
            self.assertIn('test "$GITHUB_RUN_ATTEMPT" = 2',block)
            self.assertIn(f'restore-retry --directory "$RUNNER_TEMP/candidate-build" --browser {browser}',block)
        # Actual original download failure eligibility is checked independently;
        # no workflow input may declare evidence authenticated or skip tests.
        self.assertNotIn('retry_failure:',self.new)
        self.assertNotIn('continue-on-error:',self.new)
        self.assertEqual(self.new.count('--phase preinstall'),4)
        self.assertEqual(self.new.count('--phase postinstall'),4)

    def test_restore_dispatch_executes_only_same_attempt_or_first_retry(self):
        block=self.new.split('      - name: Verify and restore the exact candidate build (desktop-chromium)',1)[1].split('      - name:',1)[0]
        body=block.split('        run: |\n',1)[1]
        script='python3() { printf "%s\\n" "$2"; };\n'+body
        for producer, consumer, command in (('1','1','restore'),('2','2','restore'),
                                           ('1','2','restore-retry'),('1','3',None),
                                           ('2','3',None),('','2',None),('01','2',None)):
            with self.subTest(producer=producer,consumer=consumer):
                result=subprocess.run(['bash','-c',script],capture_output=True,text=True,
                    env={**os.environ,'BUILD_PRODUCER_ATTEMPT':producer,'GITHUB_RUN_ATTEMPT':consumer,
                         'RUNNER_TEMP':'/unused-local-contract-test'})
                self.assertEqual(result.returncode==0,command is not None)
                self.assertEqual(result.stdout.strip(),command or '')


if __name__=='__main__': unittest.main()
