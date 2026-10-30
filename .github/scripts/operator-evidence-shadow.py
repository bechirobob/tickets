"""Compare authenticated updater evidence, then run the suite regardless of the result."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shlex
import stat
import subprocess
import sys
import zipfile

REPOSITORY = 'bechirobob/tickets'
WORKFLOW = '.github/workflows/tickets-code-release.yml'
ARTIFACT = 'operator-regression-receipt-v1'
EXPERIMENT_WORKFLOW = '.github/workflows/operator-evidence-shadow.yml'
EXPERIMENT_BRANCH = 'chore/operator-evidence-shadow-20261029'
EXPERIMENT_ARTIFACT = 'operator-shadow-experiment-receipt-v1'
LIMIT = 262144


def require(condition, message):
    if not condition:
        raise ValueError(message)


def decode(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    require(len(raw) <= LIMIT, 'Receipt exceeds size bound')
    return json.loads(raw, object_pairs_hook=unique)


def command(args, cwd=None):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, timeout=60).stdout


def context(checkout, stage, source, operator, expected_active):
    git = lambda *args: command(['git', '--no-replace-objects', *args], checkout).decode().strip()
    for revision in (source, operator, expected_active):
        require(re.fullmatch('[a-f0-9]{40}', revision), 'Exact revisions required')
    require(git('rev-parse', 'HEAD') == source, 'Checkout differs from source')
    require(not git('status', '--porcelain', '--untracked-files=all'), 'Checkout is not clean')
    for ancestor, descendant in ((operator, source), (expected_active, source), (source, 'origin/main')):
        git('merge-base', '--is-ancestor', ancestor, descendant)
    workflow = git('show', operator + ':' + WORKFLOW)
    require(git('rev-parse', source + ':' + WORKFLOW) == git('rev-parse', operator + ':' + WORKFLOW),
            'Producer workflow differs from independently selected operator')
    lines = [line.strip() for line in workflow.splitlines() if line.strip().startswith('git archive "$OPERATOR_SHA" ')]
    require(len(lines) == 1, 'Trusted staged inventory is ambiguous')
    paths = shlex.split(lines[0].split(' | ', 1)[0])[3:]
    require(paths and all(not path.startswith('-') for path in paths), 'Invalid archive paths')
    records = command(['git', '--no-replace-objects', 'ls-tree', '-rz', '--full-tree', operator, '--', *paths], checkout)
    expected = {}
    for record in records.split(b'\0'):
        if record:
            metadata, name = record.split(b'\t', 1)
            mode, kind, blob = metadata.decode().split()
            require(kind == 'blob' and mode in ('100644', '100755'), 'Unsupported staged entry')
            expected[os.fsdecode(name)] = (mode, blob)
    actual = {}
    for path in stage.rglob('*'):
        require(not path.is_symlink(), 'Staged symlink')
        if path.is_dir():
            continue
        name = path.relative_to(stage).as_posix()
        require(stat.S_ISREG(path.stat().st_mode) and path.stat().st_nlink == 1, 'Unsupported staged file')
        raw = path.read_bytes()
        actual[name] = ('100755' if path.stat().st_mode & 0o111 else '100644',
                        hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest())
    require(actual == expected and 'ops/vps/test_code_release.py' in actual, 'Staged inventory differs')
    return {'schema': 1, 'source': source, 'sourceTree': git('rev-parse', source + '^{tree}'),
            'operator': operator, 'expectedActive': expected_active, 'main': git('rev-parse', 'origin/main'),
            'workflowBlob': git('rev-parse', operator + ':' + WORKFLOW), 'layout': 'staged',
            'observerDigest': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'inventory': {name: list(value) for name, value in sorted(actual.items())},
            'workingDirectory': 'source',
            'suite': ['unittest', 'discover', '-s', '<stage>/ops/vps', '-p', 'test_*.py'],
            'environment': {'python': sys.version, 'git': git('--version'), 'system': platform.system(),
                            'machine': platform.machine(), 'imageOS': os.environ.get('ImageOS'),
                            'imageVersion': os.environ.get('ImageVersion'),
                            'locale': {key: os.environ.get(key) for key in ('LANG', 'LC_ALL', 'TZ', 'PYTHONHASHSEED')}}}


class GitHub:
    def bytes(self, path):
        require(path.startswith('/repos/' + REPOSITORY + '/actions/'), 'Unexpected API path')
        return command(['gh', 'api', '--hostname', 'github.com', '--method', 'GET', path])

    def json(self, path):
        return json.loads(self.bytes(path))


def compare(api, run_id, expected, now, experiment_head=None):
    """Return a diagnostic only. Nothing returned here authorizes skipping tests."""
    require(type(run_id) is int and run_id > 0, 'Invalid reference run')
    base = '/repos/' + REPOSITORY + '/actions'
    run = api.json(f'{base}/runs/{run_id}')
    require(run['id'] == run_id and run['status'] == 'completed' and run['conclusion'] == 'success', 'Producer did not succeed')
    require(run['repository']['full_name'] == REPOSITORY and run['head_repository']['full_name'] == REPOSITORY, 'Wrong producer repository')
    if experiment_head is None:
        require(run['path'] == WORKFLOW and run['event'] == 'workflow_dispatch' and run['head_branch'] == 'main', 'Wrong producer workflow')
        producer_head, job_name, artifact_name = expected['source'], 'release', ARTIFACT
        required = {'Verify updater regression suite': 'success', 'Record verification-only result': 'success',
                    'Apply reversible Tickets-only code transaction': 'skipped', 'Connect existing dedicated Tickets identity': 'skipped'}
    else:
        require(re.fullmatch('[a-f0-9]{40}', experiment_head)
                and set(expected.get('experiment', {})) == {'tree', 'workflowBlob'}, 'Invalid experiment identity')
        require(run['path'] == EXPERIMENT_WORKFLOW and run['event'] == 'push'
                and run['head_branch'] == EXPERIMENT_BRANCH, 'Wrong experiment workflow')
        producer_head, job_name, artifact_name = experiment_head, 'historical_shadow', EXPERIMENT_ARTIFACT
        required = {'Compare authenticated evidence and run the full suite': 'success',
                    'Require actual suite execution': 'success', 'Publish experiment receipt': 'success'}
    require(run['head_sha'] == producer_head, 'Producer source differs')
    attempt = run['run_attempt']
    require(type(attempt) is int and attempt > 0, 'Invalid producer attempt')
    jobs = api.json(f'{base}/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    require(jobs['total_count'] == len(jobs['jobs']) <= 100, 'Incomplete job inventory')
    releases = [job for job in jobs['jobs'] if job['name'] == job_name]
    require(len(releases) == 1, 'Ambiguous release job')
    job = releases[0]
    require(job['run_id'] == run_id and job['run_attempt'] == attempt and job['head_sha'] == producer_head
            and job['status'] == 'completed' and job['conclusion'] == 'success', 'Release job differs')
    for name, conclusion in required.items():
        steps = [step for step in job['steps'] if step['name'] == name]
        require(len(steps) == 1 and steps[0]['status'] == 'completed' and steps[0]['conclusion'] == conclusion, 'Producer step differs')
    artifacts = api.json(f'{base}/runs/{run_id}/artifacts?per_page=100')
    require(artifacts['total_count'] == len(artifacts['artifacts']) <= 100, 'Incomplete artifact inventory')
    matches = [item for item in artifacts['artifacts'] if item['name'] == artifact_name]
    require(len(matches) == 1, 'Missing or ambiguous receipt artifact')
    artifact = matches[0]
    require(not artifact['expired'] and 0 < artifact['size_in_bytes'] <= LIMIT, 'Receipt artifact unavailable')
    require(artifact['workflow_run']['id'] == run_id and artifact['workflow_run']['head_sha'] == producer_head, 'Artifact producer differs')
    archive = api.bytes(f"{base}/artifacts/{artifact['id']}/zip")
    require(len(archive) <= LIMIT and artifact['digest'] == 'sha256:' + hashlib.sha256(archive).hexdigest(), 'Artifact digest differs')
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        entries = zipped.infolist()
        require(len(entries) == 1 and entries[0].filename == 'receipt.json' and entries[0].file_size <= LIMIT,
                'Unexpected receipt archive entries')
        require(not stat.S_ISLNK(entries[0].external_attr >> 16), 'Receipt symlink')
        receipt = decode(zipped.read(entries[0]))
    require(set(receipt) == {'schema', 'run', 'attempt', 'created', 'context', 'suitePassed'}, 'Receipt fields differ')
    require(receipt['schema'] == 1 and receipt['run'] == run_id and receipt['attempt'] == attempt, 'Receipt attempt differs')
    require(type(receipt['created']) is int and 0 <= now - receipt['created'] <= 86400, 'Receipt is stale')
    require(receipt['suitePassed'] is True and receipt['context'] == expected, 'Test inputs or outcome differ')
    require(expected['environment']['imageOS'] and expected['environment']['imageVersion'], 'Runner image is not recorded')
    require(api.json(f'{base}/runs/{run_id}') == run, 'Producer changed during comparison')
    return {'comparison': 'match', 'referenceRun': run_id, 'referenceAttempt': attempt, 'artifact': artifact['id']}


def shadow(api, run_id, expected, now, execute, experiment_head=None):
    try:
        result = compare(api, run_id, expected, now, experiment_head)
    except (ValueError, KeyError, TypeError, OSError, RuntimeError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        result = {'comparison': 'unavailable-or-mismatch', 'referenceRun': run_id,
                  'reason': str(error) if isinstance(error, ValueError) else 'Evidence unavailable'}
    result['mode'] = 'shadow'
    result['testsSkipped'] = False
    result['suiteExitCode'] = execute()
    return result


def experiment_context(root):
    """Keep experiment evidence separate from actual release receipts."""
    git = lambda *args: command(['git', '--no-replace-objects', *args], root).decode().strip()
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY
            and os.environ.get('GITHUB_EVENT_NAME') == 'push'
            and os.environ.get('GITHUB_REF') == 'refs/heads/' + EXPERIMENT_BRANCH,
            'Experiment requires its isolated branch push')
    head = git('rev-parse', 'HEAD')
    require(head == os.environ.get('GITHUB_SHA') and not git('status', '--porcelain', '--untracked-files=all'),
            'Experiment checkout differs from runner')
    return {'tree': git('rev-parse', 'HEAD^{tree}'),
            'workflowBlob': git('rev-parse', 'HEAD:' + EXPERIMENT_WORKFLOW)}


def experiment_reference(api, root, identity):
    """Select only a completed run of identical experiment bytes; never accept a PR run."""
    listing = api.json('/repos/' + REPOSITORY + '/actions/workflows/operator-evidence-shadow.yml/runs'
                       '?branch=' + EXPERIMENT_BRANCH + '&event=push&status=success&per_page=30')
    for run in listing['workflow_runs']:
        head = run['head_sha']
        require(re.fullmatch('[a-f0-9]{40}', head), 'Invalid experiment revision')
        if str(run['id']) == os.environ.get('GITHUB_RUN_ID'):
            continue
        try:
            tree = command(['git', '--no-replace-objects', 'rev-parse', head + '^{tree}'], root).decode().strip()
            command(['git', '--no-replace-objects', 'merge-base', '--is-ancestor', head, 'HEAD'], root)
        except subprocess.SubprocessError:
            continue
        if tree == identity['tree']:
            return run['id'], head
    return 0, None


def main():
    import time
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('checkout', 'stage', 'source', 'operator', 'expected-active', 'output'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--reference-run', type=int)
    parser.add_argument('--experiment', action='store_true')
    parser.add_argument('--receipt-output')
    args = parser.parse_args()
    checkout, stage = Path(args.checkout).resolve(), Path(args.stage).resolve()
    expected = context(checkout, stage, args.source, args.operator, args.expected_active)
    api, experiment_head = GitHub(), None
    observer = Path(__file__).resolve().parents[2]
    if args.experiment:
        require(args.reference_run is None, 'Experiment selects its own producer')
        expected['experiment'] = experiment_context(observer)
        try:
            args.reference_run, experiment_head = experiment_reference(api, observer, expected['experiment'])
        except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
            args.reference_run = 0
    else:
        require(args.reference_run is not None, 'Reference run required')
    suite_environment = {key: value for key, value in os.environ.items() if key not in ('GH_TOKEN', 'GITHUB_TOKEN')}
    suite_environment['PYTHONDONTWRITEBYTECODE'] = '1'
    suite = [value.replace('<stage>', str(stage)) for value in expected['suite']]
    result = shadow(api, args.reference_run, expected, int(time.time()),
                    lambda: subprocess.run([sys.executable, '-m', *suite], cwd=checkout,
                                           env=suite_environment, timeout=1200, check=False).returncode,
                    experiment_head)
    if args.experiment:
        result['experiment'] = True
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    if args.receipt_output and result['suiteExitCode'] == 0:
        require(context(checkout, stage, args.source, args.operator, args.expected_active)
                == {key: value for key, value in expected.items() if key != 'experiment'},
                'Test inputs changed during execution')
        if args.experiment:
            require(experiment_context(observer) == expected['experiment'], 'Experiment changed during tests')
        else:
            require(os.environ.get('GITHUB_SHA') == args.source, 'Receipt source differs from runner')
        run, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
        require(re.fullmatch('[1-9][0-9]*', run) and re.fullmatch('[1-9][0-9]*', attempt), 'Receipt requires runner identity')
        receipt = {'schema': 1, 'run': int(run), 'attempt': int(attempt), 'created': int(time.time()),
                   'context': expected, 'suitePassed': True}
        Path(args.receipt_output).write_text(json.dumps(receipt, sort_keys=True) + '\n')
    return result['suiteExitCode']


if __name__ == '__main__':
    raise SystemExit(main())
