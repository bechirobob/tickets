"""Cross-file release contracts sourced from declared producer workflows.

Offline only. Successful job fixtures deliberately come from YAML step names,
not verifier constants, so a renamed producer cannot silently drift from its
consumer even when each component's own tests use self-consistent fixtures.
"""
import copy
import importlib.util
from pathlib import Path
import re
import unittest

import runtime_release as transport

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('workflow_contract_operator', ROOT / 'ops/vps/code-release.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


def declared_jobs(path):
    text = (ROOT / path).read_text()
    jobs = {}
    # These reviewed workflows use explicit two-space job IDs and six-space
    # named steps; fail rather than silently accepting another layout.
    for match in re.finditer(r'^  ([A-Za-z_][A-Za-z0-9_-]*):\n(?:(?!^  [A-Za-z_][A-Za-z0-9_-]*:).|\n)*', text.split('jobs:\n', 1)[1], re.M):
        names = re.findall(r'^      - name: (.+)$', match[0], re.M)
        if not names:
            raise AssertionError('Every producer job requires explicitly named contract steps')
        if names:
            if any(name.startswith(('"', "'", '${{')) for name in names):
                raise AssertionError('Workflow named-step format needs explicit contract review')
            jobs[match[1]] = names
    return jobs


def successful_job(name, steps):
    return {'name': name, 'conclusion': 'success', 'status': 'completed', 'steps': [
        {'name': step, 'conclusion': 'success', 'status': 'completed'} for step in steps]}


class RuntimeWorkflowContractTests(unittest.TestCase):
    def setUp(self):
        self.runtime_names = declared_jobs('.github/workflows/vps-runtime.yml')
        self.candidate_names = declared_jobs('.github/workflows/candidate-checks.yml')
        self.runtime = [successful_job(name, steps) for name, steps in self.runtime_names.items()]
        self.candidate = [successful_job(name, steps) for name, steps in self.candidate_names.items()]

    def test_every_declared_named_gate_has_exact_consumer_contract(self):
        self.assertEqual(set(self.runtime_names), {'verify', 'handoff'})
        self.assertEqual(set(self.candidate_names), {'verify'})
        expected = operator.CANDIDATE_CORE_STEPS | {
            f'{name} ({browser})' for browser in operator.BROWSERS for name in operator.CANDIDATE_BROWSER_STEPS}
        for names, required in ((self.runtime_names['verify'], operator.RUNTIME_VERIFY_STEPS),
                                (self.runtime_names['handoff'], operator.RUNTIME_HANDOFF_STEPS),
                                (self.candidate_names['verify'], expected)):
            self.assertEqual(len(names), len(set(names)), 'Duplicated declared producer step')
            self.assertEqual(set(names), required)
        self.assertEqual(transport.WORKFLOW, '.github/workflows/vps-runtime.yml')
        self.assertEqual(transport.PUBLISH_STEP, 'Publish verified public runtime release')
        self.assertEqual(self.runtime_names['verify'].count(transport.PUBLISH_STEP), 1)
        self.assertIn(transport.PUBLISH_STEP, operator.RUNTIME_VERIFY_STEPS)

    def test_actual_declared_workflows_pass_consumer(self):
        operator.verify_jobs(self.runtime, self.candidate)

    def test_historical_private_label_never_satisfies_public_publication(self):
        runtime = copy.deepcopy(self.runtime)
        step = next(s for j in runtime for s in j['steps'] if s['name'] == transport.PUBLISH_STEP)
        step['name'] = 'Publish verified private runtime release'
        with self.assertRaises(operator.ReleaseError):
            operator.verify_jobs(runtime, self.candidate)

    def test_every_named_gate_rejects_missing_duplicate_failed_or_unfinished_step(self):
        for group in ('runtime', 'candidate'):
            original = getattr(self, group)
            for job_index, job in enumerate(original):
                for step_index, step in enumerate(job['steps']):
                    for mutation in ('missing', 'duplicate', 'failed', 'skipped', 'unfinished'):
                        jobs = copy.deepcopy(original)
                        steps = jobs[job_index]['steps']
                        if mutation == 'missing':
                            steps.pop(step_index)
                        elif mutation == 'duplicate':
                            steps.append(copy.deepcopy(steps[step_index]))
                        elif mutation == 'unfinished':
                            steps[step_index]['status'] = 'in_progress'
                        else:
                            steps[step_index]['conclusion'] = mutation
                        with self.subTest(group=group, job=job['name'], step=step['name'], mutation=mutation):
                            with self.assertRaises(operator.ReleaseError):
                                operator.verify_jobs(jobs if group == 'runtime' else self.runtime,
                                                     jobs if group == 'candidate' else self.candidate)


if __name__ == '__main__':
    unittest.main()
