"""Offline regression tests: python3 -m unittest discover -s tests -p test_release_timing.py"""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('release_timing', ROOT / 'scripts/release-timing.py')
TIMING = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TIMING)


def fixture():
    return {'total_count': 1, 'jobs': [{
        'id': 11, 'run_id': 42, 'run_attempt': 1, 'head_sha': 'a' * 40,
        'run_url': 'https://api.github.com/repos/example/tickets/actions/runs/42',
        'status': 'completed', 'conclusion': 'success', 'name': 'verify',
        'labels': ['ubuntu-latest'], 'created_at': '2026-10-13T00:00:00Z',
        'started_at': '2026-10-13T00:00:03Z', 'completed_at': '2026-10-13T00:01:04Z',
        'steps': [{'number': 1, 'name': 'Browser (desktop-chromium)', 'status': 'completed',
                   'conclusion': 'success', 'started_at': '2026-10-13T00:00:04Z',
                   'completed_at': '2026-10-13T00:01:03Z'}]}]}


def run_fixture(attempt=1):
    return {'id': 42, 'run_attempt': attempt, 'head_sha': 'a' * 40,
            'repository': {'full_name': 'example/tickets'}, 'status': 'completed',
            'conclusion': 'success', 'created_at': '2026-10-13T00:00:00Z',
            'run_started_at': '2026-10-13T00:00:02Z'}


class ReleaseTimingTests(unittest.TestCase):
    def test_single_job_measured_and_modeled_are_distinct(self):
        r = TIMING.summarize(fixture(), 42, 1)
        self.assertEqual(r['runner_seconds'], 61)
        self.assertEqual(r['execution_wall_seconds'], 61)
        self.assertEqual(r['jobs_observed_elapsed_seconds'], 64)
        self.assertEqual(r['summed_job_queue_seconds'], 3)
        self.assertEqual(r['modeled_ceil_job_minutes'], 2)
        self.assertIsNone(r['run_queue_seconds'])
        self.assertEqual(r['jobs'][0]['lanes']['desktop-chromium']['summed_step_seconds'], 59)
        self.assertEqual(r['jobs'][0]['unattributed_job_seconds'], 2)

    def test_parallel_jobs_sum_occupancy_not_wall_or_rounded_total(self):
        p = fixture()
        other = copy.deepcopy(p['jobs'][0])
        other.update(id=12, labels=['self-hosted', 'Linux'])
        p['jobs'].append(other)
        p['total_count'] = 2
        r = TIMING.summarize(p, 42, 1)
        self.assertEqual(r['execution_wall_seconds'], 61)
        self.assertEqual(r['runner_seconds'], 122)
        self.assertEqual(r['modeled_ceil_job_minutes'], 4)
        self.assertEqual(len(r['runner_groups']), 2)

    def test_complete_run_metadata(self):
        r = TIMING.summarize(fixture(), 42, 1, run_fixture())
        self.assertEqual(r['run_queue_seconds'], 2)
        self.assertEqual(r['run_elapsed_through_last_job_seconds'], 64)
        self.assertEqual(r['run_conclusion'], 'success')

    def test_retry_never_uses_original_creation_as_attempt_enqueue(self):
        p = fixture()
        p['jobs'][0]['run_attempt'] = 2
        r = TIMING.summarize(p, 42, 2, run_fixture(2))
        self.assertIsNone(r['run_queue_seconds'])
        self.assertTrue(any('Retry enqueue' in w for w in r['warnings']))

    def test_failures_retained_not_discarded(self):
        p = fixture()
        p['jobs'][0]['conclusion'] = 'failure'
        p['jobs'][0]['steps'][0]['conclusion'] = 'failure'
        r = TIMING.summarize(p, 42, 1)
        self.assertEqual(r['non_success_jobs'], [11])
        self.assertEqual(r['runner_seconds'], 61)

    def test_skipped_placeholder_times_are_not_negative_work(self):
        p = fixture()
        p['jobs'][0].update(conclusion='skipped', steps=[],
                            completed_at='2026-10-12T00:00:00Z')
        r = TIMING.summarize(p, 42, 1)
        self.assertEqual(r['execution_wall_seconds'], 0)
        self.assertEqual(r['runner_seconds'], 0)
        self.assertEqual(r['modeled_ceil_job_minutes'], 0)
        self.assertEqual(r['non_success_jobs'], [11])
        self.assertTrue(any('skipped' in w for w in r['warnings']))

    def test_skipped_steps_can_lack_timestamps(self):
        p = fixture()
        p['jobs'][0]['steps'][0].update(conclusion='skipped', started_at=None, completed_at=None)
        r = TIMING.summarize(p, 42, 1)
        self.assertEqual(r['jobs'][0]['steps'][0]['seconds'], 0)
        self.assertEqual(r['jobs'][0]['unattributed_job_seconds'], 61)

    def test_incomplete_pagination_rejected(self):
        p = fixture()
        p['total_count'] = 2
        with self.assertRaisesRegex(ValueError, 'pagination'):
            TIMING.summarize(p, 42, 1)

    def test_duplicate_jobs_rejected(self):
        p = fixture()
        p['jobs'] *= 2
        p['total_count'] = 2
        with self.assertRaisesRegex(ValueError, 'duplicate id'):
            TIMING.summarize(p, 42, 1)

    def test_wrong_identity_and_missing_attempt_rejected(self):
        for key, value in [('run_id', 43), ('run_attempt', 2), ('run_attempt', None),
                           ('run_id', True), ('head_sha', 'short')]:
            with self.subTest(key=key, value=value):
                p = fixture()
                p['jobs'][0][key] = value
                with self.assertRaises(ValueError):
                    TIMING.summarize(p, 42, 1)

    def test_mixed_repository_or_head_rejected(self):
        for key, value in [('head_sha', 'b' * 40),
                           ('run_url', 'https://api.github.com/repos/other/tickets/actions/runs/42')]:
            with self.subTest(key=key):
                p = fixture()
                other = copy.deepcopy(p['jobs'][0])
                other.update(id=12)
                other[key] = value
                p['jobs'].append(other)
                p['total_count'] = 2
                with self.assertRaisesRegex(ValueError, 'mixed repository or source SHA'):
                    TIMING.summarize(p, 42, 1)

    def test_bad_run_metadata_rejected(self):
        for key, value in [('id', 43), ('run_attempt', 2), ('head_sha', 'b' * 40),
                           ('repository', {'full_name': 'wrong/repo'}), ('status', 'in_progress'),
                           ('run_started_at', '2026-10-13T00:02:00Z')]:
            with self.subTest(key=key):
                r = run_fixture()
                r[key] = value
                with self.assertRaises(ValueError):
                    TIMING.summarize(fixture(), 42, 1, r)

    def test_invalid_or_incomplete_job_rejected(self):
        for key, value in [('status', 'in_progress'), ('conclusion', None), ('conclusion', 'bogus'),
                           ('started_at', '2026-10-13T00:00:03'), ('created_at', None),
                           ('completed_at', '2026-10-13T00:00:02Z'),
                           ('created_at', '2026-10-13T00:00:04Z'), ('steps', None)]:
            with self.subTest(key=key, value=value):
                p = fixture()
                p['jobs'][0][key] = value
                with self.assertRaises(ValueError):
                    TIMING.summarize(p, 42, 1)

    def test_step_outside_job_or_incomplete_rejected(self):
        for key, value in [('started_at', '2026-10-12T00:00:00Z'),
                           ('completed_at', '2026-10-14T00:00:00Z'),
                           ('status', 'in_progress'), ('conclusion', None)]:
            p = fixture()
            p['jobs'][0]['steps'][0][key] = value
            with self.assertRaises(ValueError):
                TIMING.summarize(p, 42, 1)

    def test_duplicate_or_overlapping_steps_rejected(self):
        for number in [1, 2]:
            p = fixture()
            step = copy.deepcopy(p['jobs'][0]['steps'][0])
            step['number'] = number
            p['jobs'][0]['steps'].append(step)
            with self.assertRaises(ValueError):
                TIMING.summarize(p, 42, 1)

    def test_archive_selects_only_explicit_run(self):
        r = TIMING.summarize({'42': fixture(), '99': {}}, 42, 1)
        self.assertEqual(r['run_id'], 42)
        with self.assertRaises(ValueError):
            TIMING.summarize({'99': fixture()}, 42, 1)

    def test_compare_deltas_and_zero_denominators(self):
        before = TIMING.summarize(fixture(), 42, 1)
        after = copy.deepcopy(before)
        after.update(execution_wall_seconds=30.5, runner_seconds=120, modeled_ceil_job_minutes=3)
        result = TIMING.compare(before, after)
        self.assertEqual(result['wall_speedup'], 2)
        self.assertEqual(result['wall_reduction_fraction'], 0.5)
        self.assertEqual(result['runner_seconds_delta'], 59)
        self.assertEqual(result['modeled_ceil_job_minutes_delta'], 1)
        after['execution_wall_seconds'] = 0
        self.assertIsNone(TIMING.compare(before, after)['wall_speedup'])

    def test_duplicate_json_key_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'jobs.json'
            p.write_text('{"jobs": [], "jobs": []}')
            with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
                TIMING.read_json(p)

    def test_cli_reports_represented_retries_without_double_count(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for attempt in [1, 2]:
                p = fixture()
                p['jobs'][0]['run_attempt'] = attempt
                path = Path(directory) / f'{attempt}.json'
                path.write_text(json.dumps(p))
                paths.append(path)
            command = [sys.executable, str(ROOT / 'scripts/release-timing.py'),
                       '--sample', 'before', '42', '1', str(paths[0]),
                       '--sample', 'after', '42', '2', str(paths[1]), '--compare', 'before', 'after']
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            report = json.loads(result.stdout)
            group = report['represented_attempt_groups'][0]
            self.assertEqual(group['attempts'], [1, 2])
            self.assertEqual(group['runner_seconds'], 122)
            result = subprocess.run(command + ['--sample', 'duplicate', '42', '1', str(paths[0])],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, '')
            self.assertIn('duplicate run/attempt', result.stderr)


if __name__ == '__main__':
    unittest.main()
