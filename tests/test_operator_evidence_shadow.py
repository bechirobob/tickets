"""The shadow comparison never replaces execution, including a valid evidence match."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('shadow', Path(__file__).resolve().parents[1] / '.github/scripts/operator-evidence-shadow.py')
shadow = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(shadow)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.expected = {'source': 'a' * 40, 'operator': 'b' * 40, 'expectedActive': 'c' * 40,
                         'inventory': {'ops/vps/test_code_release.py': ['100644', 'd' * 40]},
                         'layout': 'staged', 'environment': {'imageOS': 'ubuntu24', 'imageVersion': 'reviewed-image'}}
        self.run = {'id': 12, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success',
                    'repository': {'full_name': shadow.REPOSITORY}, 'head_repository': {'full_name': shadow.REPOSITORY},
                    'path': shadow.WORKFLOW, 'event': 'workflow_dispatch', 'head_branch': 'main', 'head_sha': 'a' * 40}
        steps = {'Verify updater regression suite': 'success', 'Record verification-only result': 'success',
                 'Apply reversible Tickets-only code transaction': 'skipped', 'Connect existing dedicated Tickets identity': 'skipped'}
        self.jobs = {'total_count': 1, 'jobs': [{'name': 'release', 'run_id': 12, 'run_attempt': 1, 'head_sha': 'a' * 40,
                    'status': 'completed', 'conclusion': 'success', 'steps': [
                        {'name': name, 'status': 'completed', 'conclusion': conclusion} for name, conclusion in steps.items()]}]}
        self.receipt = {'schema': 1, 'run': 12, 'attempt': 1, 'created': 1000, 'context': copy.deepcopy(self.expected), 'suitePassed': True}
        self.artifact = {'id': 34, 'name': shadow.ARTIFACT, 'expired': False, 'size_in_bytes': 100,
                         'workflow_run': {'id': 12, 'head_sha': 'a' * 40}}
        self.repack()
        self.calls = 0

    def repack(self, raw=None, filename='receipt.json'):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as zipped:
            zipped.writestr(filename, raw if raw is not None else json.dumps(self.receipt))
        self.archive = buffer.getvalue()
        self.artifact['digest'] = 'sha256:' + hashlib.sha256(self.archive).hexdigest()

    def json(self, path):
        if path.endswith('/runs/12'):
            return copy.deepcopy(self.run)
        if '/attempts/' in path and path.endswith('/jobs?per_page=100'):
            return copy.deepcopy(self.jobs)
        if path.endswith('/artifacts?per_page=100'):
            return {'total_count': 1, 'artifacts': [copy.deepcopy(self.artifact)]}
        raise AssertionError(path)

    def bytes(self, path):
        self.assertEqual(path, '/repos/bechirobob/tickets/actions/artifacts/34/zip')
        return self.archive

    def execute(self):
        self.calls += 1
        return 0

    def check(self, expected='unavailable-or-mismatch'):
        result = shadow.shadow(self, 12, self.expected, 1100, self.execute)
        self.assertEqual(result['comparison'], expected)
        self.assertFalse(result['testsSkipped'])
        self.assertEqual(self.calls, 1)

    def test_matching_evidence_still_runs_suite(self):
        self.check('match')

    def test_suite_failure_propagates_despite_match(self):
        result = shadow.shadow(self, 12, self.expected, 1100, lambda: 7)
        self.assertEqual(result['suiteExitCode'], 7)
        self.assertFalse(result['testsSkipped'])

    def test_producer_identity_and_outcome_mutations_fall_back(self):
        for key, value in [('id', 13), ('run_attempt', 2), ('status', 'in_progress'), ('conclusion', 'failure'),
                           ('path', '.github/workflows/other.yml'), ('event', 'pull_request'), ('head_branch', 'topic'), ('head_sha', 'e' * 40),
                           ('repository', {'full_name': 'other/repo'}), ('head_repository', {'full_name': 'other/repo'})]:
            with self.subTest(key=key):
                self.setUp(); self.run[key] = value; self.check()

    def test_context_changes_fall_back(self):
        for key in self.expected:
            with self.subTest(key=key):
                self.setUp(); self.receipt['context'][key] = 'changed'; self.repack(); self.check()

    def test_receipt_scope_age_and_success_mutations_fall_back(self):
        for key, value in [('schema', 2), ('run', 13), ('attempt', 2), ('created', -90000), ('created', 1200), ('suitePassed', False), ('extra', True)]:
            with self.subTest(key=key, value=value):
                self.setUp(); self.receipt[key] = value; self.repack(); self.check()

    def test_failed_skipped_and_duplicate_required_steps_fall_back(self):
        for conclusion in ('failure', 'skipped', 'cancelled'):
            with self.subTest(conclusion=conclusion):
                self.setUp(); self.jobs['jobs'][0]['steps'][0]['conclusion'] = conclusion; self.check()
        self.setUp(); self.jobs['jobs'][0]['steps'].append(self.jobs['jobs'][0]['steps'][0]); self.check()

    def test_artifact_identity_digest_and_size_mutations_fall_back(self):
        for key, value in [('expired', True), ('name', 'other'), ('size_in_bytes', shadow.LIMIT + 1), ('digest', 'sha256:' + '0' * 64),
                           ('workflow_run', {'id': 13, 'head_sha': 'a' * 40})]:
            with self.subTest(key=key):
                self.setUp(); self.artifact[key] = value; self.check()

    def test_missing_authentication_falls_back(self):
        class Unavailable:
            def json(self, path):
                raise subprocess.CalledProcessError(1, ['gh', 'api'])
        result = shadow.shadow(Unavailable(), 12, self.expected, 1100, self.execute)
        self.assertEqual(result['comparison'], 'unavailable-or-mismatch')
        self.assertEqual(self.calls, 1)

    def test_incomplete_jobs_and_wrong_job_identity_fall_back(self):
        for key, value in [('run_id', 13), ('run_attempt', 2), ('head_sha', 'e' * 40), ('status', 'queued'), ('conclusion', 'failure')]:
            with self.subTest(key=key):
                self.setUp(); self.jobs['jobs'][0][key] = value; self.check()
        self.setUp(); self.jobs['total_count'] = 101; self.check()

    def test_missing_runner_image_never_matches(self):
        self.expected['environment']['imageVersion'] = None
        self.receipt['context'] = copy.deepcopy(self.expected)
        self.repack(); self.check()

    def test_duplicate_archive_entries_fall_back(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as zipped:
            zipped.writestr('receipt.json', json.dumps(self.receipt))
            zipped.writestr('extra.json', '{}')
        self.archive = buffer.getvalue()
        self.artifact['digest'] = 'sha256:' + hashlib.sha256(self.archive).hexdigest()
        self.check()

    def test_archive_path_and_duplicate_json_keys_fall_back(self):
        self.repack(filename='../receipt.json'); self.check()
        self.setUp(); self.repack(raw='{"schema":1,"schema":1}'); self.check()

    def test_changed_producer_attempt_during_comparison_falls_back(self):
        original = self.json
        calls = []
        def changing(path):
            result = original(path)
            if path.endswith('/runs/12'):
                calls.append(path)
                if len(calls) > 1:
                    result['run_attempt'] = 2
            return result
        self.json = changing
        self.check()


class ContextTests(unittest.TestCase):
    def test_cli_runs_staged_tests_from_source_without_api_tokens(self):
        class Unavailable:
            def json(self, path):
                raise OSError('unavailable')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected = {'suite': ['unittest', 'discover', '-s', '<stage>/ops/vps', '-p', 'test_*.py']}
            argv = ['shadow', '--checkout', str(root / 'repo'), '--stage', str(root / 'stage'),
                    '--source', 'a' * 40, '--operator', 'b' * 40, '--expected-active', 'c' * 40,
                    '--reference-run', '12', '--output', str(root / 'report.json')]
            with patch.object(shadow.sys, 'argv', argv), patch.object(shadow, 'context', return_value=expected), \
                 patch.object(shadow, 'GitHub', return_value=Unavailable()), \
                 patch.dict(shadow.os.environ, GH_TOKEN='fixture', GITHUB_TOKEN='fixture'), \
                 patch.object(shadow.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as execute:
                self.assertEqual(shadow.main(), 0)
            args, kwargs = execute.call_args
            self.assertEqual(args[0], [shadow.sys.executable, '-m', 'unittest', 'discover', '-s', str(root / 'stage/ops/vps'), '-p', 'test_*.py'])
            self.assertEqual(kwargs['cwd'], root / 'repo')
            self.assertNotIn('GH_TOKEN', kwargs['env'])
            self.assertNotIn('GITHUB_TOKEN', kwargs['env'])

    def test_context_checks_real_git_stage_bytes_modes_and_inventory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); repo = root / 'repo'; repo.mkdir(); stage = root / 'stage'; stage.mkdir()
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=repo, stderr=subprocess.DEVNULL).decode().strip()
            git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture')
            files = {shadow.WORKFLOW: 'git archive "$OPERATOR_SHA" ops/vps | tar -x -C "$operator"\n',
                     'ops/vps/test_code_release.py': '# fixture\n'}
            for name, value in files.items():
                path = repo / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(value); path.chmod(0o644)
            git('add', '.'); git('commit', '-qm', 'fixture'); source = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', source)
            target = stage / 'ops/vps/test_code_release.py'; target.parent.mkdir(parents=True); target.write_text('# fixture\n'); target.chmod(0o644)
            original = shadow.context(repo, stage, source, source, source)
            self.assertEqual(original['layout'], 'staged')
            for mutation in ('bytes', 'mode', 'extra', 'symlink'):
                with self.subTest(mutation=mutation):
                    if mutation == 'bytes': target.write_text('# changed\n')
                    elif mutation == 'mode': target.chmod(0o755)
                    elif mutation == 'extra': (stage / 'extra').write_text('extra')
                    else: target.unlink(); target.symlink_to(repo / 'ops/vps/test_code_release.py')
                    with self.assertRaises(ValueError): shadow.context(repo, stage, source, source, source)
                    if target.is_symlink(): target.unlink()
                    target.write_text('# fixture\n'); target.chmod(0o644); (stage / 'extra').unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
