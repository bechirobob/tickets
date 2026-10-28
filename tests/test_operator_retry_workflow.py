"""Operator-only retry boundaries; never a replacement for release evidence."""
import itertools
import os
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/tickets-release-operator-checks.yml'


def job_blocks(text):
    body = text.split('jobs:\n', 1)[1]
    return dict(re.findall(r'^  ([a-z_]+):\n(.*?)(?=^  [a-z_]+:|\Z)', body,
                           re.MULTILINE | re.DOTALL))


class OperatorRetryWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()
        self.jobs = job_blocks(self.text)

    def test_exact_stage_inventory_and_source_order(self):
        self.assertEqual(list(self.jobs), ['source_guards', 'staged_layout', 'verify'])
        self.assertIn('    needs: source_guards\n', self.jobs['staged_layout'])
        self.assertNotIn('    needs:', self.jobs['source_guards'])
        self.assertIn('    needs: [source_guards, staged_layout]\n', self.jobs['verify'])
        self.assertIn('    if: ${{ always() }}\n', self.jobs['verify'])
        # Native retry of the staged job traverses only its downstream aggregate,
        # not its already-successful prerequisite. No cached test pass is read.
        self.assertNotIn('source_guards', self.jobs['staged_layout'].split('    steps:', 1)[1])

    def test_both_test_stages_checkout_the_same_immutable_event_source(self):
        for name in ('source_guards', 'staged_layout'):
            block = self.jobs[name]
            self.assertEqual(block.count('uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262'), 1)
            self.assertIn('ref: ${{ github.event.pull_request.head.sha || github.sha }}', block)
            self.assertIn('persist-credentials: false', block)
            self.assertIn('fetch-depth: 0', block)
            self.assertIn('timeout-minutes: 20', block)
        self.assertNotIn('actions/checkout', self.jobs['verify'])

    def test_original_full_and_staged_checks_remain_distinct_and_required(self):
        source = self.jobs['source_guards']
        staged = self.jobs['staged_layout']
        self.assertIn("python3 -I -m unittest discover -s tests -p 'test_caption_source.py' -v", source)
        self.assertIn("python3 -I -m unittest discover -s tests -p 'test_audit_release*.py' -v", source)
        self.assertIn("python3 -m unittest discover -s ops/vps -p 'test_*.py'", source)
        self.assertIn('python3 -m py_compile "ops/vps/code-release.py"', source)
        self.assertIn('git -C "$GITHUB_WORKSPACE" diff --check', source)
        self.assertIn('git archive HEAD ops/vps ops/email/mailer.py ', staged)
        self.assertIn('mkdir -m 700 "$staged"', staged)
        self.assertIn('python3 -m unittest discover -s "$staged/ops/vps" -p \'test_*.py\'', staged)
        self.assertNotIn('unittest', self.jobs['verify'])
        self.assertEqual(self.text.count('      - name: Verify the exact staged operator layout used for release'), 1)

    def test_aggregate_executes_fail_closed_for_every_stage_result(self):
        block = self.jobs['verify']
        self.assertIn('SOURCE_GUARDS_RESULT: ${{ needs.source_guards.result }}', block)
        self.assertIn('STAGED_LAYOUT_RESULT: ${{ needs.staged_layout.result }}', block)
        script = '\n'.join(line[10:] for line in block.split('        run: |\n', 1)[1].splitlines())
        for source, staged in itertools.product(('success', 'failure', 'cancelled', 'skipped', ''), repeat=2):
            with self.subTest(source=source, staged=staged):
                result = subprocess.run(['bash', '-c', script], env={**os.environ,
                    'SOURCE_GUARDS_RESULT': source, 'STAGED_LAYOUT_RESULT': staged},
                    capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, source == staged == 'success')

    def test_no_permissions_or_proof_reuse_expansion(self):
        self.assertIn('permissions:\n  contents: read\n', self.text)
        for forbidden in ('continue-on-error', 'actions: write', 'contents: write', 'secrets.',
                          'actions/cache', 'download-artifact', 'pull_request_target', 'workflow_run:'):
            self.assertNotIn(forbidden, self.text)

    def test_contract_test_triggers_and_runs_before_full_guards(self):
        self.assertIn('      - tests/test_operator_retry_workflow.py\n', self.text)
        block = self.jobs['source_guards']
        self.assertLess(block.index("-p 'test_operator_retry_workflow.py'"),
                        block.index("-s ops/vps -p 'test_*.py'"))


if __name__ == '__main__':
    unittest.main()
