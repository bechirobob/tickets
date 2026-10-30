"""Only exact authenticated updater evidence may replace this one regression suite."""
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

SPEC = importlib.util.spec_from_file_location('shadow', Path(__file__).with_name('operator_evidence.py'))
shadow = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(shadow)


BASE_WORKFLOW_BLOB = 'd1f3bffa33b6f2d13cbdf4675862071d94346817'
DEPLOY_BLOB = '0bf4539141356389a96f768ac8305e1355d86834'
WORKFLOW_BLOB = 'f7877dec7c650e4a14600c3c24347444e38aefed'
WORKFLOW_REVERSE = [(976, 1409, b''),
 (3728, 3872, b''),
 (7734, 7834, b''),
 (7838, 8155, b''),
 (8165, 8166, b'm'),
 (8167, 8222, b''),
 (8223, 8223, b'ni'),
 (8224, 8247, b'te'),
 (8249, 8251, b' discov'),
 (8252, 8252, b'r -s'),
 (8283, 8302, b'/'),
 (8303, 8320, b'ps/vps'),
 (8323, 8325, b''),
 (8326, 8332, b''),
 (8333, 8356, b"'"),
 (8358, 8411, b''),
 (8412, 8524, b''),
 (8525, 8546, b'_*'),
 (8547, 8560, b''),
 (8561, 8594, b"y'"),
 (16801, 17220, b'')]

def restore_deploy(raw):
    digest = lambda value: hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
    if digest(raw) == DEPLOY_BLOB:
        raw = raw.replace(b"      - 'ops/vps/operator_evidence.py'\n      - 'ops/vps/test_operator_evidence.py'\n", b'', 1)
        if digest(raw) != '9e656e4f618a4fc335844b1bee7a864850c134c2':
            raise AssertionError('Evidence deploy filter changed other bytes')
    return raw


def restore_workflow(raw):
    digest = lambda value: hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
    if digest(raw) != WORKFLOW_BLOB:
        return raw
    for start, end, original in reversed(WORKFLOW_REVERSE):
        raw = raw[:start] + original + raw[end:]
    if digest(raw) != BASE_WORKFLOW_BLOB:
        raise AssertionError('Evidence workflow did not restore its exact baseline')
    return raw


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.expected = {'source': 'a' * 40, 'workflowSource': 'a' * 40, 'workflowBlob': '1'*40,
                         'sourceTree': '2'*40, 'observerDigest': '3'*64, 'releaseInputs': {'RUNTIME_RUN':'123'}, 'operator': 'b' * 40, 'expectedActive': 'c' * 40,
                         'inventory': {'ops/vps/test_code_release.py': ['100644', 'd' * 40]},
                         'layout': 'staged', 'environment': {'tools': {'node': 'v22.fixture', 'npm': '10.fixture', 'go': 'go version fixture'}, 'imageOS': 'ubuntu24', 'imageVersion': 'reviewed-image'}}
        self.run = {'id': 12, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success',
                    'repository': {'full_name': shadow.REPOSITORY}, 'head_repository': {'full_name': shadow.REPOSITORY},
                    'path': shadow.WORKFLOW, 'event': 'workflow_dispatch', 'head_branch': 'main', 'head_sha': 'a' * 40}
        steps = {'Verify updater regression suite': 'success', 'Record verification-only result': 'success',
                 'Publish executed operator test receipt': 'success',
                 'Apply reversible Tickets-only code transaction': 'skipped', 'Connect existing dedicated Tickets identity': 'skipped'}
        self.jobs = {'total_count': 1, 'jobs': [{'name': 'release', 'run_id': 12, 'run_attempt': 1, 'head_sha': 'a' * 40,
                    'status': 'completed', 'conclusion': 'success', 'steps': [
                        {'name': name, 'status': 'completed', 'conclusion': conclusion} for name, conclusion in steps.items()]}]}
        self.receipt = {'schema': 2, 'durationSeconds': 300.0, 'run': 12, 'attempt': 1, 'created': 1000, 'context': copy.deepcopy(self.expected), 'suitePassed': True}
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
        result = shadow.verify_or_run(self, 12, self.expected, 1100, self.execute, 'reuse')
        self.assertEqual(result['comparison'], expected)
        self.assertEqual(result['testsSkipped'], expected == 'match')
        self.assertEqual(self.calls, 0 if expected == 'match' else 1)

    def test_matching_evidence_reuses_only_in_reuse_mode(self):
        self.check('match')

    def test_seven_day_age_boundary_and_future_timestamps(self):
        for age in (-1, 0, 86400, 86401, 518400, 604799, 604800, 604801):
            with self.subTest(age=age):
                self.setUp()
                result = shadow.verify_or_run(self, 12, self.expected, 1000 + age, self.execute, 'reuse')
                accepted = 0 <= age <= 604800
                self.assertEqual(result['testsSkipped'], accepted)
                self.assertEqual(self.calls, 0 if accepted else 1)

    def test_each_tool_change_or_missing_version_falls_back_after_six_days(self):
        for name in ('node', 'npm', 'go'):
            for value in ('changed', None, ''):
                with self.subTest(name=name, value=value):
                    self.setUp()
                    self.expected['environment']['tools'][name] = value
                    if not value:
                        self.receipt['context'] = copy.deepcopy(self.expected)
                        self.repack()
                    result = shadow.verify_or_run(self, 12, self.expected, 1000 + 518400, self.execute, 'reuse')
                    self.assertFalse(result['testsSkipped'])
                    self.assertEqual(self.calls, 1)

    def test_tool_version_capture_and_unavailable_tools(self):
        with patch.object(shadow, 'command', side_effect=[b'v22\n', b'10\n', b'go version fixture\n']) as command:
            self.assertEqual(shadow.tool_versions(), {'node': 'v22', 'npm': '10', 'go': 'go version fixture'})
            self.assertEqual([call.args[0] for call in command.call_args_list],
                             [['node', '--version'], ['npm', '--version'], ['go', 'version']])
        for error in (FileNotFoundError(), subprocess.TimeoutExpired('tool', 60), subprocess.CalledProcessError(1, 'tool')):
            with self.subTest(error=type(error).__name__), patch.object(shadow, 'command', side_effect=error):
                self.assertEqual(shadow.tool_versions(), dict.fromkeys(('node', 'npm', 'go')))

    def test_suite_failure_propagates_despite_match(self):
        result = shadow.verify_or_run(self, 12, self.expected, 1100, lambda: 7, 'shadow')
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
        for key, value in [('schema', 3), ('durationSeconds', 0), ('durationSeconds', 1300), ('run', 13), ('attempt', 2), ('created', -604800), ('created', 1200), ('suitePassed', False), ('extra', True)]:
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
        result = shadow.verify_or_run(Unavailable(), 12, self.expected, 1100, self.execute, 'reuse')
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


class ContextAndWorkflowTests(unittest.TestCase):
    def test_only_new_tooling_files_are_excluded_from_application_deployment(self):
        raw = (Path(__file__).resolve().parents[2]/'.github/workflows/deploy.yml').read_bytes()
        digest = lambda value: hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
        self.assertEqual(digest(raw), DEPLOY_BLOB)
        self.assertEqual(digest(restore_deploy(raw)), '9e656e4f618a4fc335844b1bee7a864850c134c2')
        self.assertEqual(restore_deploy(raw+b'changed'), raw+b'changed')

    def test_workflow_preserves_all_other_release_steps_and_permissions(self):
        raw = (Path(__file__).resolve().parents[2]/shadow.WORKFLOW).read_bytes()
        digest = lambda value: hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()
        self.assertEqual(digest(raw), WORKFLOW_BLOB)
        self.assertEqual(digest(restore_workflow(raw)), BASE_WORKFLOW_BLOB)
        self.assertEqual(restore_workflow(raw+b'changed'), raw+b'changed')
        self.assertIn(b"inputs.verify_only && steps.operator_tests.outputs.executed == 'true'", raw)
        self.assertIn(b'default: shadow', raw)
        self.assertIn(b'retention-days: 7', raw)

    def test_context_checks_real_git_inputs_and_executing_verifier(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); repo=root/'repo'; repo.mkdir(); stage=root/'stage'; stage.mkdir()
            def git(*args):
                return subprocess.check_output(['git',*args],cwd=repo,stderr=subprocess.DEVNULL).decode().strip()
            git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture')
            files={shadow.WORKFLOW:b'git archive "$OPERATOR_SHA" ops/vps | tar -x -C "$operator"\n',
                   shadow.VERIFIER:Path(shadow.__file__).read_bytes(), 'ops/vps/test_code_release.py':b'# fixture\n'}
            for name,raw in files.items():
                p=repo/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
                if name.startswith('ops/vps/'):
                    p=stage/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
            git('add','.');git('commit','-qm','fixture');source=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',source)
            env={'GITHUB_SHA':source,'GITHUB_REF':'refs/heads/main','GITHUB_REPOSITORY':shadow.REPOSITORY,'GITHUB_EVENT_NAME':'workflow_dispatch'}
            with patch.dict(shadow.os.environ,env):
                expected=shadow.context(repo,stage,source,source,source,source)
                self.assertEqual(expected['workflowSource'],source)
                for key,value in [('GITHUB_SHA','a'*40),('GITHUB_REF','refs/heads/topic'),('GITHUB_EVENT_NAME','push')]:
                    with self.subTest(key=key),patch.dict(shadow.os.environ,{key:value}):
                        with self.assertRaises(ValueError):shadow.context(repo,stage,source,source,source,source)
                p=stage/'ops/vps/test_code_release.py';p.write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError,'inventory'):shadow.context(repo,stage,source,source,source,source)

    def test_cli_never_publishes_reused_or_failed_results(self):
        for reused,exit_code in [(False,0),(False,1),(True,0)]:
            with self.subTest(reused=reused,exit_code=exit_code),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                expected={'suite':['unittest','discover','-s','<stage>/ops/vps','-p','test_*.py']}
                argv=['evidence','--checkout',str(root/'repo'),'--stage',str(root/'stage'),'--source','a'*40,
                      '--operator','b'*40,'--expected-active','c'*40,'--workflow-source','d'*40,
                      '--output',str(root/'report.json'),'--receipt-output',str(root/'receipt.json')]
                result={'testsSkipped':reused,'suiteExitCode':exit_code,'suiteSeconds':300}
                with patch.object(shadow.sys,'argv',argv),patch.object(shadow,'context',return_value=expected), \
                     patch.object(shadow,'verify_or_run',return_value=result), \
                     patch.dict(shadow.os.environ,{'GITHUB_RUN_ID':'12','GITHUB_RUN_ATTEMPT':'1','GITHUB_OUTPUT':str(root/'outputs')}):
                    self.assertEqual(shadow.main(),exit_code)
                self.assertEqual((root/'receipt.json').exists(),not reused and exit_code==0)
                self.assertEqual((root/'outputs').read_text(),'executed='+('false' if reused else 'true')+'\n')

    def test_cli_runs_original_suite_without_api_tokens_or_bytecode_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            expected={'suite':['unittest','discover','-s','<stage>/ops/vps','-p','test_*.py']}
            argv=['evidence','--checkout',str(root/'repo'),'--stage',str(root/'stage'),'--source','a'*40,
                  '--operator','b'*40,'--expected-active','c'*40,'--workflow-source','d'*40,
                  '--output',str(root/'report.json'),'--receipt-output',str(root/'receipt.json')]
            with patch.object(shadow.sys,'argv',argv),patch.object(shadow,'context',return_value=expected), \
                 patch.dict(shadow.os.environ,{'GH_TOKEN':'fixture','GITHUB_TOKEN':'fixture','GITHUB_OUTPUT':str(root/'outputs')}), \
                 patch.object(shadow.subprocess,'run',return_value=subprocess.CompletedProcess([],1)) as execute:
                self.assertEqual(shadow.main(),1)
            args,kwargs=execute.call_args
            self.assertEqual(args[0],[shadow.sys.executable,'-m','unittest','discover','-s',str(root/'stage/ops/vps'),'-p','test_*.py'])
            self.assertEqual(kwargs['cwd'],root/'repo')
            self.assertNotIn('GH_TOKEN',kwargs['env']);self.assertNotIn('GITHUB_TOKEN',kwargs['env'])
            self.assertEqual(kwargs['env']['PYTHONDONTWRITEBYTECODE'],'1')


if __name__ == '__main__':
    unittest.main()
