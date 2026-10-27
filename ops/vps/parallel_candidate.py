#!/usr/bin/env python3
"""Offline admission of authenticated, exact-attempt parallel browser evidence.

The caller must obtain metadata/logs through authenticated GitHub endpoints and
select source, tree, audit baseline and reviewed workflow blob independently.
This module never downloads anything, reads source code, imports candidate
modules, or executes a checkout. Hashes alone do not establish provenance.
"""
import argparse
import calendar
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import stat
import sys

REPOSITORY = 'bechirobob/tickets'
WORKFLOW = '.github/workflows/candidate-parallel-checks.yml'
EXPERIMENT_BRANCH = 'improve/release-evidence-parallel-20261013'
SCHEMA = 'tickets-parallel-candidate/v2'
RECEIPT_SCHEMA = 'tickets-browser-build/v2'
PREFIX = 'TICKETS_BROWSER_BUILD_RECEIPT '
BROWSERS = ('desktop-chromium', 'mobile-chromium', 'mobile-webkit')
AGGREGATE_JOB = 'tickets-candidate-verified'
JOB_NAMES = ('build', *BROWSERS, AGGREGATE_JOB)
JOB_KEYS = ('build', 'desktop_chromium', 'mobile_chromium', 'mobile_webkit', 'verify')
MAX_JSON = 8 * 1024 * 1024
MAX_WORKFLOW = 256 * 1024
MAX_LOG = 128 * 1024 * 1024
MAX_RECEIPT = 8192
MAX_ARTIFACT = 272 * 1024 * 1024
MAX_NUMBER = 10 ** 20 - 1
SHA = re.compile(r'[a-f0-9]{40}\Z')
DIGEST = re.compile(r'[a-f0-9]{64}\Z')
NUMBER = re.compile(r'[1-9][0-9]{0,19}\Z')
TIMESTAMP = re.compile(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z\Z')
LOG_LINE = re.compile(rb'([0-9T:.Z-]+) ' + PREFIX.encode() + rb'([^\r\n]+)\Z')
RECEIPT_KEYS = {'schema', 'kind', 'browser', 'repository', 'source_sha', 'source_tree',
                'workflow_sha', 'audit_trusted_base', 'run_id', 'run_attempt', 'artifact_id',
                'artifact_digest', 'archive_sha256', 'manifest_sha256'}
PROOF_KEYS = {'schema', 'repository', 'source_sha', 'source_tree', 'workflow', 'workflow_sha',
              'workflow_blob', 'audit_trusted_base', 'run_id', 'run_attempt', 'event',
              'head_branch', 'artifact', 'jobs', 'receipts', 'metadata_sha256'}
ARTIFACT_KEYS = {'id', 'name', 'size_in_bytes', 'digest', 'archive_sha256', 'manifest_sha256',
                 'created_at', 'expires_at'}
COMMON_STEPS = (
    'Check out exact candidate', 'Verify exact source ancestry before executing checkout code',
    'Stage trusted audit verifier', 'Verify exact candidate source', 'Set up Node.js',
    'Audit dependencies', 'Install locked dependencies', 'Verify installed audited dependencies',
)
BUILD_STEPS = (*COMMON_STEPS, 'Lint application', 'Check application types',
               'Verify unit tests and rendered production build', 'Check database schema',
               'Validate the deployable Worker without publishing', 'Package verified browser build',
               'Verify candidate evidence transport', 'Upload one immutable bounded browser build',
               'Record exact producer transport receipt')
BROWSER_STEPS = (
    'Verify and restore the exact candidate build', 'Prepare isolated event fixtures',
    'Capture natural Room entry before the full browser suite',
    'Preserve natural Room entry evidence immediately', 'Verify every browser journey before release',
    'Verify keyboard navigation focus without retries',
    'Verify optional SeevPlus checkout on desktop and mobile',
    'Verify opt-in USDC checkout without provider traffic',
    'Verify RSVP and interest registration on desktop and mobile',
    'Verify owner Operations workflows on desktop and mobile',
    'Preserve required Operations visual evidence immediately',
    'Verify host report fixture recovery without retries',
)
AGGREGATE_STEP = 'Require every exact browser lane and build to succeed'


class ParallelError(ValueError):
    """Evidence is missing, malformed, stale, incomplete or mismatched."""


def require(value, message):
    if not value:
        raise ParallelError(message)


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def integer(value, minimum=1, maximum=MAX_NUMBER):
    return type(value) is int and minimum <= value <= maximum


def canonical(value):
    try:
        return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        raise ParallelError('Invalid JSON value') from error


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def json_shape(value, depth=0, budget=None):
    budget = [200000] if budget is None else budget
    budget[0] -= 1
    require(depth <= 32 and budget[0] >= 0, 'JSON nesting or inventory exceeds bound')
    if isinstance(value, dict):
        require(all(isinstance(key, str) and len(key) <= 512 for key in value), 'Invalid JSON key')
        for item in value.values():
            json_shape(item, depth + 1, budget)
    elif isinstance(value, list):
        for item in value:
            json_shape(item, depth + 1, budget)
    elif isinstance(value, str):
        require(len(value) <= MAX_JSON, 'JSON string exceeds bound')
    else:
        require(value is None or type(value) is bool or
                (type(value) is int and abs(value) <= MAX_NUMBER), 'Invalid JSON number or type')


def strict_json(raw, maximum=MAX_JSON):
    require(type(raw) in (bytes, str), 'JSON bytes required')
    try:
        require(len(raw.encode() if isinstance(raw, str) else raw) <= maximum, 'JSON exceeds bound')
        def pairs(items):
            result = {}
            for key, value in items:
                require(key not in result, 'Duplicate JSON key')
                result[key] = value
            return result
        def bad_number(_):
            raise ParallelError('Non-integer JSON number')
        value = json.loads(raw, object_pairs_hook=pairs, parse_float=bad_number, parse_constant=bad_number)
        json_shape(value)
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        raise ParallelError('Invalid bounded JSON document') from error


def metadata(value, expected_type):
    if isinstance(value, (bytes, str)):
        value = strict_json(value)
    require(type(value) is expected_type, 'Unexpected metadata type')
    json_shape(value)
    require(len(canonical(value)) <= MAX_JSON, 'Metadata exceeds bound')
    return value


def timestamp(value, *, end=False):
    require(matches(TIMESTAMP, value), 'UTC timestamp required')
    match = TIMESTAMP.fullmatch(value)
    try:
        seconds = calendar.timegm(datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S').timetuple())
    except ValueError as error:
        raise ParallelError('Invalid UTC timestamp') from error
    fraction = match[2]
    # GitHub's step API has whole-second resolution. The completed second is
    # inclusive; retain nanosecond precision for raw log timestamps.
    nanos = int(fraction.ljust(9, '0')) if fraction else (999999999 if end else 0)
    return seconds * 10 ** 9 + nanos


def current_time(now):
    require(isinstance(now, datetime) and now.tzinfo is not None and now.utcoffset().total_seconds() == 0,
            'Independent UTC verification time required')
    return calendar.timegm(now.utctimetuple()) * 10 ** 9 + now.microsecond * 1000


def expectations(*, repository, source_sha, source_tree, audit_trusted_base, workflow_blob,
                 run_id, run_attempt, now):
    require(repository == REPOSITORY, 'Unexpected repository')
    require(all(matches(SHA, value) for value in (source_sha, source_tree, audit_trusted_base, workflow_blob)),
            'Independent immutable source/tree/baseline/workflow identities required')
    require(audit_trusted_base != source_sha, 'Audit baseline cannot be candidate source')
    require(integer(run_id) and integer(run_attempt), 'Exact numeric run and attempt required')
    return current_time(now)


def workflow_inventory(raw, workflow_blob):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_WORKFLOW, 'Bounded trusted workflow bytes required')
    blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    require(blob == workflow_blob, 'Executed workflow bytes differ from reviewed controls')
    try:
        text = raw.decode('utf-8')
    except UnicodeError as error:
        raise ParallelError('Invalid workflow encoding') from error
    require(text.count('\njobs:\n') == 1, 'Unambiguous trusted workflow jobs required')
    blocks = re.split(r'^  ([a-z_]+):\n', text.split('\njobs:\n')[1], flags=re.M)
    require(tuple(blocks[1::2]) == JOB_KEYS, 'Exact five workflow jobs required')
    inventory = {}
    for key, block, name in zip(blocks[1::2], blocks[2::2], JOB_NAMES):
        names = re.findall(r'^    name: ([^\n]+)$', block, re.M)
        require(names == [name], 'Workflow job display identity differs')
        steps = re.findall(r'^      - name: ([^\n]+)$', block, re.M)
        require(0 < len(steps) <= 100 and len(steps) == len(set(steps))
                and all(0 < len(step) <= 256 for step in steps), 'Ambiguous workflow steps')
        required = BUILD_STEPS if key == 'build' else ((AGGREGATE_STEP,) if key == 'verify' else
            (*COMMON_STEPS, 'Verify prepared browsers for event-page verification',
             'Download exact producer artifact by immutable ID',
             *(f'{step} ({name})' for step in BROWSER_STEPS)))
        positions = [steps.index(step) if step in steps else -1 for step in required]
        require(-1 not in positions and positions == sorted(positions), 'Required workflow gates missing or reordered')
        inventory[name] = steps
    return inventory


def interval(record):
    start, end = timestamp(record.get('started_at')), timestamp(record.get('completed_at'), end=True)
    require(start <= end, 'Inverted execution interval')
    return start, end


def verify_run_jobs(run, jobs, workflow_bytes, *, repository, source_sha, source_tree,
                    audit_trusted_base, workflow_blob, run_id, run_attempt, now):
    now_ns = expectations(repository=repository, source_sha=source_sha, source_tree=source_tree,
                          audit_trusted_base=audit_trusted_base, workflow_blob=workflow_blob,
                          run_id=run_id, run_attempt=run_attempt, now=now)
    run, jobs = metadata(run, dict), metadata(jobs, list)
    inventory = workflow_inventory(workflow_bytes, workflow_blob)
    require(integer(run.get('id')) and run['id'] == run_id
            and integer(run.get('run_attempt')) and run['run_attempt'] == run_attempt
            and run.get('head_sha') == source_sha and run.get('path') == WORKFLOW
            and run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'Exact completed successful workflow run required')
    for key in ('repository', 'head_repository'):
        item = run.get(key)
        require(isinstance(item, dict) and item.get('full_name') == repository and integer(item.get('id')),
                'Workflow repository identity differs')
    require(run['repository']['id'] == run['head_repository']['id'], 'Foreign head repository')
    branch = run.get('head_branch')
    require(isinstance(branch, str) and 0 < len(branch) <= 255 and not branch.startswith('refs/')
            and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', branch)
            and not any(part in ('', '.', '..') for part in branch.split('/')),
            'Invalid workflow branch; pull-request merge refs are ineligible')
    require(run.get('event') == 'workflow_dispatch' or
            (run.get('event') == 'push' and branch == EXPERIMENT_BRANCH), 'Ineligible workflow event or branch')
    # Dispatches cannot smuggle a pull-request synthetic merge ref either.
    require(not branch.startswith('pull/'), 'Pull-request refs are ineligible')
    start = timestamp(run.get('run_started_at'))
    created, updated = timestamp(run.get('created_at')), timestamp(run.get('updated_at'), end=True)
    require(created <= start <= updated and timestamp(run.get('updated_at')) <= now_ns,
            'Stale or future workflow timestamps')
    require(len(jobs) == 5, 'Exact five jobs required')
    result, ids = {}, set()
    for job in jobs:
        require(isinstance(job, dict), 'Invalid job metadata')
        name, jid = job.get('name'), job.get('id')
        require(name in JOB_NAMES and name not in result and integer(jid) and jid not in ids,
                'Missing, duplicate or unexpected job')
        ids.add(jid)
        require(integer(job.get('run_id')) and job['run_id'] == run_id
                and integer(job.get('run_attempt')) and job['run_attempt'] == run_attempt
                and job.get('head_sha') == source_sha and job.get('status') == 'completed'
                and job.get('conclusion') == 'success', 'Job does not belong to exact successful attempt')
        lower, upper = interval(job)
        require(start <= lower <= upper <= updated and timestamp(job['completed_at']) <= now_ns,
                'Job outside workflow interval')
        steps = job.get('steps')
        require(isinstance(steps, list) and 0 < len(steps) <= 110, 'Bounded step inventory required')
        seen, required_seen, previous_number, previous_time = set(), [], 0, lower
        for step in steps:
            require('Complete job' not in seen, 'Steps after job completion')
            require(isinstance(step, dict), 'Invalid step metadata')
            step_name, number = step.get('name'), step.get('number')
            require(isinstance(step_name, str) and step_name not in seen
                    and integer(number, 1, 1000) and number > previous_number,
                    'Duplicate, malformed or reordered job step')
            seen.add(step_name)
            previous_number = number
            require(step.get('status') == 'completed' and step.get('conclusion') == 'success',
                    'Skipped, failed or incomplete workflow step')
            step_start, step_end = interval(step)
            require(lower <= step_start <= step_end <= upper and step_start >= previous_time,
                    'Step intervals are outside job or out of order')
            previous_time = timestamp(step['completed_at'])
            if step_name in inventory[name]:
                required_seen.append(step_name)
            else:
                before = ('Set up job', 'Initialize containers') if name in BROWSERS else ('Set up job',)
                after = ('Post Set up Node.js', 'Post Check out exact candidate', 'Complete job')
                if name in BROWSERS:
                    after += ('Post Set up Python for existing verification scripts', 'Stop containers')
                require(step_name in (*before, *after), 'Unexpected workflow step')
                require((step_name in before and not required_seen) or
                        (step_name in after and required_seen == inventory[name]),
                        'Lifecycle step interrupts required gates')
                if step_name == 'Initialize containers':
                    require('Set up job' in seen, 'Container initialization precedes job setup')
                if step_name.startswith('Post '):
                    require('Stop containers' not in seen, 'Post action after container shutdown')
        require(required_seen == inventory[name], 'Required gates missing or reordered')
        if name in BROWSERS:
            require({'Set up job', 'Initialize containers', 'Post Set up Python for existing verification scripts',
                     'Stop containers', 'Complete job'} <= seen,
                    'Complete container lifecycle evidence required')
        result[name] = job
    build_end = timestamp(result['build']['completed_at'])
    require(all(timestamp(result[name]['started_at']) >= build_end for name in BROWSERS),
            'Browser job began before immutable build completed')
    verify_start = timestamp(result[AGGREGATE_JOB]['started_at'])
    require(all(timestamp(result[name]['completed_at']) <= verify_start for name in JOB_NAMES[:-1]),
            'Aggregate job began before required lanes completed')
    return result


def validate_receipt(value, *, repository, source_sha, source_tree, audit_trusted_base,
                     run_id, run_attempt, browser):
    require(isinstance(value, dict) and set(value) == RECEIPT_KEYS, 'Invalid receipt schema')
    expected = {'schema': RECEIPT_SCHEMA, 'kind': 'producer' if browser is None else 'consumer',
                'browser': browser, 'repository': repository, 'source_sha': source_sha,
                'source_tree': source_tree, 'workflow_sha': source_sha,
                'audit_trusted_base': audit_trusted_base, 'run_id': str(run_id), 'run_attempt': str(run_attempt)}
    require(all(value[key] == item for key, item in expected.items()), 'Receipt identity or audit baseline differs')
    require(matches(NUMBER, value['artifact_id']) and all(matches(DIGEST, value[key]) for key in
            ('artifact_digest', 'archive_sha256', 'manifest_sha256')), 'Invalid artifact receipt identity')
    return value


def receipt_from_log(raw, job, **expected):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_LOG, 'Bounded authenticated raw log required')
    browser = None if job['name'] == 'build' else job['name']
    receipts = []
    for line in raw.split(b'\n'):
        # Never substring-match ANSI output, shell commands, quoted examples or
        # an untimestamped pasted receipt. Any extra receipt marker fails closed.
        if PREFIX.encode() not in line:
            continue
        require(len(line) <= MAX_RECEIPT, 'Receipt line exceeds bound')
        match = LOG_LINE.fullmatch(line)
        require(match is not None, 'Receipt must be anchored in a timestamped raw log line')
        require(job['name'] != AGGREGATE_JOB, 'Aggregate job cannot produce a build receipt')
        receipt_time = timestamp(match[1].decode('ascii'))
        step_name = ('Record exact producer transport receipt' if browser is None else
                     f'Verify and restore the exact candidate build ({browser})')
        steps = [step for step in job['steps'] if step['name'] == step_name]
        require(len(steps) == 1, 'Receipt step is missing or duplicated')
        lower, upper = interval(steps[0])
        require(lower <= receipt_time <= upper, 'Receipt is outside its authenticated named step interval')
        value = strict_json(match[2], MAX_RECEIPT)
        require(canonical(value).rstrip(b'\n') == match[2], 'Receipt JSON is not canonical')
        receipts.append(validate_receipt(value, browser=browser, **expected))
    require(len(receipts) == (0 if job['name'] == AGGREGATE_JOB else 1), 'Exactly one receipt per build/browser job required')
    return receipts[0] if receipts else None


def verified_receipts(run, jobs, logs, workflow_bytes, **expected):
    inventory = verify_run_jobs(run, jobs, workflow_bytes, **expected)
    require(isinstance(logs, dict) and all(integer(key) for key in logs)
            and set(logs) == {job['id'] for job in inventory.values()}, 'Exact five authenticated job logs required')
    receipt_expected = {key: expected[key] for key in
                        ('repository', 'source_sha', 'source_tree', 'audit_trusted_base', 'run_id', 'run_attempt')}
    receipts = []
    for name in JOB_NAMES:
        receipt = receipt_from_log(logs[inventory[name]['id']], inventory[name], **receipt_expected)
        if receipt:
            receipts.append(receipt)
    for key in ('artifact_id', 'artifact_digest', 'archive_sha256', 'manifest_sha256'):
        require(len({receipt[key] for receipt in receipts}) == 1, 'Browser lanes did not use one immutable producer build')
    return inventory, receipts


def producer_artifact_id(run, jobs, logs, workflow_bytes, **expected):
    _, receipts = verified_receipts(run, jobs, logs, workflow_bytes, **expected)
    return int(receipts[0]['artifact_id'])


def verify_evidence(run, jobs, artifact, logs, workflow_bytes, **expected):
    run, jobs, artifact = metadata(run, dict), metadata(jobs, list), metadata(artifact, dict)
    inventory, receipts = verified_receipts(run, jobs, logs, workflow_bytes, **expected)
    receipt = receipts[0]
    run_id, run_attempt = expected['run_id'], expected['run_attempt']
    require(integer(artifact.get('id')) and artifact['id'] == int(receipt['artifact_id'])
            and artifact.get('name') == f'browser-build-{run_id}-{run_attempt}'
            and integer(artifact.get('size_in_bytes'), 1, MAX_ARTIFACT)
            and artifact.get('expired') is False
            and artifact.get('digest') == 'sha256:' + receipt['artifact_digest'],
            'Immutable artifact identity, digest, size or expiry differs')
    owner = artifact.get('workflow_run')
    require(isinstance(owner, dict) and integer(owner.get('id')) and owner['id'] == run_id
            and integer(owner.get('repository_id')) and owner['repository_id'] == run['repository']['id']
            and integer(owner.get('head_repository_id')) and owner['head_repository_id'] == run['head_repository']['id']
            and owner.get('head_sha') == expected['source_sha'] and owner.get('head_branch') == run['head_branch'],
            'Artifact belongs to another repository, run or source')
    created = timestamp(artifact.get('created_at'))
    updated = timestamp(artifact.get('updated_at'))
    expiry = timestamp(artifact.get('expires_at'))
    now_ns = current_time(expected['now'])
    upload = next(step for step in inventory['build']['steps'] if step['name'] == 'Upload one immutable bounded browser build')
    upload_start, upload_end = interval(upload)
    require(upload_start <= created <= updated <= upload_end and updated <= now_ns < expiry
            and created < expiry, 'Artifact timestamps are expired, future or outside producer upload')
    proof = {'schema': SCHEMA, 'repository': expected['repository'], 'source_sha': expected['source_sha'],
             'source_tree': expected['source_tree'], 'workflow': WORKFLOW, 'workflow_sha': expected['source_sha'],
             'workflow_blob': expected['workflow_blob'], 'audit_trusted_base': expected['audit_trusted_base'],
             'run_id': run_id, 'run_attempt': run_attempt, 'event': run['event'], 'head_branch': run['head_branch'],
             'artifact': {'id': artifact['id'], 'name': artifact['name'], 'size_in_bytes': artifact['size_in_bytes'],
                          'digest': receipt['artifact_digest'], 'archive_sha256': receipt['archive_sha256'],
                          'manifest_sha256': receipt['manifest_sha256'], 'created_at': artifact['created_at'],
                          'expires_at': artifact['expires_at']},
             'jobs': [{'id': inventory[name]['id'], 'name': name,
                       'log_sha256': sha256(logs[inventory[name]['id']]),
                       'steps_sha256': sha256(canonical(inventory[name]['steps']))} for name in JOB_NAMES],
             'receipts': receipts, 'metadata_sha256': {key: sha256(canonical(value)) for key, value in
                                                     (('run', run), ('jobs', jobs), ('artifact', artifact))}}
    validate_proof(proof, **{key: expected[key] for key in expected if key != 'now'})
    return proof


def validate_proof(proof, *, repository, source_sha, source_tree, run_id, run_attempt,
                   audit_trusted_base, workflow_blob=None):
    """Validate a persisted proof's strict shape and independently supplied pins.

    This is a format/binding check, not a substitute for authenticated collection
    and verify_evidence. A self-authored JSON document is never admission proof.
    """
    proof = metadata(proof, dict)
    require(set(proof) == PROOF_KEYS and proof['schema'] == SCHEMA, 'Version 2 parallel proof required')
    require(repository == REPOSITORY and all(matches(SHA, item) for item in
            (source_sha, source_tree, audit_trusted_base)) and audit_trusted_base != source_sha
            and integer(run_id) and integer(run_attempt), 'Invalid independent proof controls')
    expected = {'repository': repository, 'source_sha': source_sha, 'source_tree': source_tree,
                'workflow': WORKFLOW, 'workflow_sha': source_sha, 'audit_trusted_base': audit_trusted_base,
                'run_id': run_id, 'run_attempt': run_attempt}
    require(all(proof[key] == value for key, value in expected.items())
            and integer(proof['run_id']) and integer(proof['run_attempt'])
            and matches(SHA, proof['workflow_blob'])
            and (workflow_blob is None or proof['workflow_blob'] == workflow_blob), 'Parallel proof identity differs')
    require(proof['event'] in ('push', 'workflow_dispatch') and isinstance(proof['head_branch'], str)
            and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,254}', proof['head_branch'])
            and not proof['head_branch'].startswith(('refs/', 'pull/'))
            and not any(part in ('', '.', '..') for part in proof['head_branch'].split('/'))
            and (proof['event'] != 'push' or proof['head_branch'] == EXPERIMENT_BRANCH), 'Ineligible proof event/ref')
    artifact = proof['artifact']
    require(isinstance(artifact, dict) and set(artifact) == ARTIFACT_KEYS and integer(artifact['id'])
            and integer(artifact['size_in_bytes'], 1, MAX_ARTIFACT)
            and artifact['name'] == f'browser-build-{run_id}-{run_attempt}'
            and all(matches(DIGEST, artifact[key]) for key in ('digest', 'archive_sha256', 'manifest_sha256')),
            'Invalid proof artifact')
    require(timestamp(artifact['created_at']) < timestamp(artifact['expires_at']), 'Invalid proof artifact timestamps')
    jobs = proof['jobs']
    require(isinstance(jobs, list) and len(jobs) == 5, 'Complete proof job inventory required')
    ids = set()
    for job, name in zip(jobs, JOB_NAMES):
        require(isinstance(job, dict) and set(job) == {'id', 'name', 'log_sha256', 'steps_sha256'}
                and integer(job['id']) and job['id'] not in ids and job['name'] == name
                and matches(DIGEST, job['log_sha256']) and matches(DIGEST, job['steps_sha256']), 'Invalid proof job inventory')
        ids.add(job['id'])
    receipts = proof['receipts']
    require(isinstance(receipts, list) and len(receipts) == 4, 'Four proof receipts required')
    for value, browser in zip(receipts, (None, *BROWSERS)):
        validate_receipt(value, repository=repository, source_sha=source_sha, source_tree=source_tree,
                         audit_trusted_base=audit_trusted_base, run_id=run_id, run_attempt=run_attempt, browser=browser)
        require(value['artifact_id'] == str(artifact['id']) and value['artifact_digest'] == artifact['digest']
                and value['archive_sha256'] == artifact['archive_sha256']
                and value['manifest_sha256'] == artifact['manifest_sha256'], 'Proof receipt differs from shared artifact')
    hashes = proof['metadata_sha256']
    require(isinstance(hashes, dict) and set(hashes) == {'run', 'jobs', 'artifact'}
            and all(matches(DIGEST, value) for value in hashes.values()), 'Complete metadata digests required')
    return proof


def read_file(path, maximum):
    path = Path(path)
    require(not any(item.is_symlink() for item in (path, *path.parents)), 'Linked evidence input')
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= maximum,
            'Bounded regular evidence input required')
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    require(len(raw) <= maximum, 'Evidence input exceeds bound')
    return raw


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    for name in ('source-sha', 'source-tree', 'audit-trusted-base', 'workflow-blob'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--run-id', required=True, type=int)
    parser.add_argument('--run-attempt', required=True, type=int)
    args = parser.parse_args(argv)
    try:
        root = Path(args.directory)
        run = strict_json(read_file(root / 'run.json', MAX_JSON))
        jobs = strict_json(read_file(root / 'jobs.json', MAX_JSON))
        artifact = strict_json(read_file(root / 'artifact.json', MAX_JSON))
        expected = {key: getattr(args, key) for key in
                    ('source_sha', 'source_tree', 'audit_trusted_base', 'workflow_blob', 'run_id', 'run_attempt')}
        expected.update(repository=REPOSITORY, now=datetime.now(timezone.utc))
        workflow = read_file(root / 'workflow.yml', MAX_WORKFLOW)
        inventory = verify_run_jobs(run, jobs, workflow, **expected)
        logs = {job['id']: read_file(root / 'logs' / f"{job['id']}.log", MAX_LOG) for job in inventory.values()}
        proof = verify_evidence(run, jobs, artifact, logs, workflow, **expected)
        sys.stdout.buffer.write(canonical(proof))
        return 0
    except (ParallelError, OSError) as error:
        print('Parallel evidence rejected: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
