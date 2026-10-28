"""Versioned one-download-retry evidence validation; v2 remains unchanged.

All inputs require independent authenticated collection. This module performs no
network calls and never imports candidate code. Only the approved combined
download/unpack stage may fail; authoritative integrity checks must not start.
"""
import parallel_candidate as v2

SCHEMA = 'tickets-parallel-candidate-retry/v3'
RECEIPT_SCHEMA = 'tickets-browser-build/v3'
DOWNLOAD_STEP = 'Download exact producer artifact by immutable ID'
PROOF_KEYS = v2.PROOF_KEYS | {'original_attempt', 'retry_browser', 'original_jobs', 'aliases'}
METADATA_KEYS = {'original_run', 'original_jobs', 'run', 'jobs', 'all_jobs', 'artifact'}
ALIAS_FIELDS = ('name', 'run_id', 'head_sha', 'status', 'conclusion', 'started_at',
                'completed_at', 'runner_id', 'runner_name', 'runner_group_name', 'labels',
                'steps', 'workflow_name', 'head_branch', 'run_url')
JOB_KEYS = {'id', 'run_id', 'workflow_name', 'head_branch', 'run_url', 'run_attempt', 'node_id',
            'head_sha', 'url', 'html_url', 'status', 'conclusion', 'created_at', 'started_at',
            'completed_at', 'name', 'steps', 'check_run_url', 'labels', 'runner_id',
            'runner_name', 'runner_group_id', 'runner_group_name'}
STEP_KEYS = {'name', 'number', 'status', 'conclusion', 'started_at', 'completed_at'}
ParallelError = v2.ParallelError
require = v2.require


def _run(run, attempt, conclusion, expected):
    run = v2.metadata(run, dict)
    now = v2.expectations(**expected)
    require(run.get('id') == expected['run_id'] and v2.integer(run.get('id'))
            and run.get('run_attempt') == attempt and v2.integer(run.get('run_attempt'))
            and run.get('head_sha') == expected['source_sha'] and run.get('path') == v2.WORKFLOW
            and run.get('status') == 'completed' and run.get('conclusion') == conclusion,
            'Exact terminal retry run identity differs')
    for key in ('repository', 'head_repository'):
        repo = run.get(key)
        require(type(repo) is dict and repo.get('full_name') == expected['repository']
                and v2.integer(repo.get('id')), 'Foreign retry repository')
    require(run['repository']['id'] == run['head_repository']['id'], 'Foreign head repository')
    branch = run.get('head_branch')
    require(type(branch) is str and 0 < len(branch) <= 255
            and v2.re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', branch)
            and not branch.startswith(('refs/', 'pull/'))
            and not any(part in ('', '.', '..') for part in branch.split('/')),
            'Invalid retry branch')
    require(run.get('event') == 'workflow_dispatch' or
            run.get('event') == 'push' and branch == v2.EXPERIMENT_BRANCH, 'Ineligible retry event')
    created, start, end = (v2.timestamp(run.get(k)) for k in ('created_at', 'run_started_at', 'updated_at'))
    require((created <= start if attempt == 1 else start <= created) and max(created,start) <= end <= now,
            'Invalid original/run-attempt record interval')
    return run


def _steps(job, inventory, failure_step=None):
    """Every expected step, including skipped downstream work, must be present."""
    name = job['name']; expected = inventory[name]
    steps = job.get('steps')
    require(type(steps) is list and 0 < len(steps) <= 110, 'Bounded complete steps required')
    lower, upper = v2.interval(job)
    seen, declared, number, prior_time = set(), [], 0, lower
    failure_seen = False
    for step in steps:
        require(type(step) is dict and set(step) == STEP_KEYS, 'Unknown or missing step fields')
        title = step['name']
        require(type(title) is str and title not in seen and 'Complete job' not in seen
                and v2.integer(step['number'], 1, 1000) and step['number'] > number,
                'Duplicate or reordered retry step')
        seen.add(title); number = step['number']
        require(step['status'] == 'completed', 'Incomplete retry step')
        if title in expected:
            declared.append(title)
            conclusion = ('failure' if title == failure_step else
                          'skipped' if failure_seen else 'success')
            require(step['conclusion'] == conclusion, 'Failed, executed downstream or skipped prior gate')
            if title == failure_step: failure_seen = True
        else:
            before = ('Set up job', 'Initialize containers') if name in v2.BROWSERS else ('Set up job',)
            after = ('Post Set up Node.js', 'Post Check out exact candidate', 'Complete job')
            if name in v2.BROWSERS:
                after += ('Post Set up Python for existing verification scripts', 'Stop containers')
            require(title in before and not declared or title in after and declared == expected,
                    'Unexpected or misplaced lifecycle step')
            require(step['conclusion'] == 'success', 'Failed lifecycle cleanup')
            if title == 'Initialize containers': require('Set up job' in seen, 'Missing job setup')
            if title.startswith('Post '): require('Stop containers' not in seen, 'Post action after shutdown')
        # GitHub skipped entries may carry no timestamps or equal boundary times;
        # they cannot claim an execution interval after the failed download.
        if step['conclusion'] == 'skipped' and step['started_at'] is None and step['completed_at'] is None:
            continue
        start, end = v2.interval(step)
        require(lower <= start <= end <= upper and start >= prior_time,
                'Invalid or reordered step interval')
        if step['conclusion'] == 'skipped':
            require(v2.timestamp(step['started_at']) == v2.timestamp(step['completed_at']),
                    'Skipped application step has execution duration')
        prior_time = v2.timestamp(step['completed_at'])
    require(declared == expected and (failure_step is None or failure_seen), 'Incomplete exact workflow inventory')
    if name in v2.BROWSERS:
        require({'Set up job', 'Initialize containers', 'Post Set up Python for existing verification scripts',
                 'Stop containers', 'Complete job'} <= seen, 'Incomplete container lifecycle')


def _jobs(jobs, attempt, run, inventory, expected, failed_browser=None, retry_start=None):
    jobs = v2.metadata(jobs, list)
    require(len(jobs) == 5, 'Exactly five retry job records required')
    result, ids = {}, set()
    for job in jobs:
        require(type(job) is dict and set(job) <= JOB_KEYS, 'Unknown retry job fields')
        name, identifier = job.get('name'), job.get('id')
        require(name in v2.JOB_NAMES and name not in result and v2.integer(identifier)
                and identifier not in ids, 'Duplicate, missing or unexpected retry job')
        ids.add(identifier)
        require(job.get('run_id') == expected['run_id'] and v2.integer(job.get('run_id'))
                and job.get('run_attempt') == attempt and v2.integer(job.get('run_attempt'))
                and job.get('head_sha') == expected['source_sha'] and job.get('status') == 'completed'
                and v2.integer(job.get('runner_id')) and type(job.get('runner_name')) is str
                and job['runner_name'], 'Retry job execution identity differs')
        failure = DOWNLOAD_STEP if name == failed_browser else (
            v2.AGGREGATE_STEP if failed_browser is not None and name == v2.AGGREGATE_JOB else None)
        require(job.get('conclusion') == ('failure' if failure else 'success'), 'Unexpected job failure')
        lower, upper = v2.interval(job)
        require(v2.timestamp(expected.get('original_created_at',run['created_at'])) <= lower <= upper <= v2.timestamp(run['updated_at'], end=True)
                and v2.timestamp(job['completed_at']) <= v2.current_time(expected['now']), 'Job outside run')
        if attempt == 1:
            require(v2.timestamp(run['run_started_at']) <= lower, 'Original job precedes original attempt')
        elif retry_start is not None:
            require(lower >= retry_start if name in (expected['retry_browser'], v2.AGGREGATE_JOB)
                    else upper < retry_start, 'Fresh/retained execution interval differs')
        _steps(job, inventory, failure)
        result[name] = job
    return result


def verify_run_jobs(original_run, original_jobs, current_run, current_jobs, all_jobs, workflow_bytes, **expected):
    require(expected['run_attempt'] == 2, 'Only the single 1-to-2 manual retry is supported')
    original_run = _run(original_run, 1, 'failure', expected)
    current_run = _run(current_run, 2, 'success', expected)
    for key in ('id', 'head_sha', 'path', 'event', 'head_branch', 'repository', 'head_repository'):
        require(original_run[key] == current_run[key], 'Original/current run scope changed')
    require(v2.timestamp(original_run['updated_at'], end=True) < v2.timestamp(current_run['run_started_at']),
            'Original attempt was not terminal before retry')
    inventory = v2.workflow_inventory(workflow_bytes, expected['workflow_blob'])
    old = v2.metadata(original_jobs, list)
    failures = [j.get('name') for j in old if type(j) is dict and j.get('conclusion') == 'failure'
                and j.get('name') in v2.BROWSERS]
    require(len(failures) == 1, 'Exactly one original browser failure required')
    browser = failures[0]
    original = _jobs(old, 1, original_run, inventory, expected, failed_browser=browser)
    current = _jobs(current_jobs, 2, current_run, inventory, dict(expected, retry_browser=browser,original_created_at=original_run['created_at']),
                    retry_start=v2.timestamp(current_run['run_started_at']))
    union = {j['id']:j for j in [*original.values(), *current.values()]}
    require(len(union) == 10, 'Original executions and current API identities must be distinct')
    history = v2.metadata(all_jobs, list)
    require(len(history) == 10 and all(type(j) is dict and v2.integer(j.get('id')) for j in history)
            and len({j['id'] for j in history}) == 10
            and {j['id']:j for j in history} == union, 'Incomplete, duplicate or extra attempt history')
    for name in v2.JOB_NAMES:
        if name not in (browser, v2.AGGREGATE_JOB):
            require(all(key in original[name] and key in current[name]
                        and original[name][key] == current[name][key] for key in ALIAS_FIELDS),
                    'Retained alias changed original execution')
    build_end = v2.timestamp(original['build']['completed_at'], end=True)
    require(all(v2.timestamp(original[n]['started_at']) >= build_end for n in v2.BROWSERS),
            'Original browser started before producer completed')
    for records in (original, current):
        require(all(v2.timestamp(records[n]['completed_at'], end=True) <=
                    v2.timestamp(records[v2.AGGREGATE_JOB]['started_at']) for n in v2.JOB_NAMES[:-1]),
                'Aggregate preceded required lane completion')
    return original, current, browser


def _receipt(value, browser, attempt, expected):
    if attempt == 1:
        return v2.validate_receipt(value, **{k:expected[k] for k in
            ('repository','source_sha','source_tree','audit_trusted_base','run_id')},
            run_attempt=1, browser=browser)
    require(type(value) is dict and set(value) == v2.RECEIPT_KEYS | {'producer_attempt'},
            'Exact v3 retried consumer receipt required')
    fixed = dict(schema=RECEIPT_SCHEMA, kind='consumer', browser=browser,
                 repository=expected['repository'], source_sha=expected['source_sha'],
                 source_tree=expected['source_tree'], workflow_sha=expected['source_sha'],
                 audit_trusted_base=expected['audit_trusted_base'], run_id=str(expected['run_id']),
                 run_attempt='2', producer_attempt='1')
    require(browser in v2.BROWSERS and all(value[k] == val for k,val in fixed.items()),
            'Retried consumer receipt identity differs')
    require(v2.matches(v2.NUMBER,value['artifact_id']) and all(v2.matches(v2.DIGEST,value[k])
            for k in ('artifact_digest','archive_sha256','manifest_sha256')), 'Invalid v3 artifact receipt')
    return value


def _receipt_log(raw, job, attempt, expected, required=True):
    require(type(raw) is bytes and 0 < len(raw) <= v2.MAX_LOG, 'Bounded authenticated retry log required')
    browser = None if job['name'] == 'build' else job['name']
    found = []
    for line in raw.split(b'\n'):
        if v2.PREFIX.encode() not in line: continue
        require(required and job['name'] != v2.AGGREGATE_JOB and len(line) <= v2.MAX_RECEIPT,
                'Unexpected receipt in failed or aggregate job')
        match = v2.LOG_LINE.fullmatch(line)
        require(match is not None, 'Retry receipt must be an anchored timestamped line')
        title = ('Record exact producer transport receipt' if browser is None else
                 f'Verify and restore the exact candidate build ({browser})')
        steps = [s for s in job['steps'] if s['name'] == title]
        require(len(steps) == 1 and steps[0]['conclusion'] == 'success', 'Receipt step did not succeed')
        lower,upper = v2.interval(steps[0]); when = v2.timestamp(match[1].decode('ascii'))
        require(lower <= when <= upper, 'Retry receipt outside its execution step')
        value = v2.strict_json(match[2],v2.MAX_RECEIPT)
        require(v2.canonical(value).rstrip(b'\n') == match[2], 'Noncanonical retry receipt')
        found.append(_receipt(value,browser,attempt,expected))
    require(len(found) == (1 if required else 0), 'Missing or duplicate retry receipt')
    return found[0] if found else None


def verified_receipts(original_run, original_jobs, current_run, current_jobs, all_jobs,
                      logs, workflow_bytes, **expected):
    original,current,browser = verify_run_jobs(original_run,original_jobs,current_run,current_jobs,
                                               all_jobs,workflow_bytes,**expected)
    ids = {j['id'] for j in [*original.values(),*current.values()]}
    require(type(logs) is dict and set(logs) == ids and all(v2.integer(k) for k in logs),
            'Exactly ten authenticated original and current logs required')
    receipts = []
    for name in v2.JOB_NAMES:
        old,new = original[name],current[name]
        if name == browser:
            _receipt_log(logs[old['id']],old,1,expected,required=False)
            receipts.append(_receipt_log(logs[new['id']],new,2,expected))
        elif name == v2.AGGREGATE_JOB:
            _receipt_log(logs[old['id']],old,1,expected,required=False)
            _receipt_log(logs[new['id']],new,2,expected,required=False)
        else:
            require(logs[old['id']] == logs[new['id']], 'Alias log bytes differ from original execution')
            receipts.append(_receipt_log(logs[old['id']],old,1,expected))
    for key in ('artifact_id','artifact_digest','archive_sha256','manifest_sha256'):
        require(len({r[key] for r in receipts}) == 1, 'Retry lanes differ from original immutable producer')
    return original,current,browser,receipts


def producer_artifact_id(original_run, original_jobs, current_run, current_jobs, all_jobs,
                         logs, workflow_bytes, **expected):
    return int(verified_receipts(original_run,original_jobs,current_run,current_jobs,all_jobs,
                                logs,workflow_bytes,**expected)[3][0]['artifact_id'])


def _artifact(artifact, producer, receipt, run, expected):
    artifact = v2.metadata(artifact,dict)
    require(v2.integer(artifact.get('id')) and artifact['id'] == int(receipt['artifact_id'])
            and artifact.get('name') == f"browser-build-{expected['run_id']}-1"
            and v2.integer(artifact.get('size_in_bytes'),1,v2.MAX_ARTIFACT)
            and artifact.get('expired') is False
            and artifact.get('digest') == 'sha256:'+receipt['artifact_digest'], 'Original artifact differs')
    owner = artifact.get('workflow_run')
    require(type(owner) is dict and owner.get('id') == expected['run_id'] and v2.integer(owner.get('id'))
            and v2.integer(owner.get('repository_id')) and owner.get('repository_id') == run['repository']['id']
            and v2.integer(owner.get('head_repository_id')) and owner.get('head_repository_id') == run['head_repository']['id']
            and owner.get('head_sha') == expected['source_sha'] and owner.get('head_branch') == run['head_branch'],
            'Foreign original artifact')
    created,updated,expiry = (v2.timestamp(artifact.get(k)) for k in ('created_at','updated_at','expires_at'))
    upload = next(s for s in producer['steps'] if s['name'] == 'Upload one immutable bounded browser build')
    lower,upper = v2.interval(upload)
    require(lower <= created <= updated <= upper and updated <= v2.current_time(expected['now']) < expiry
            and 0 < expiry-created <= 86400*10**9, 'Expired, future or excessive original artifact lifetime')
    return {k:artifact[k] for k in ('id','name','size_in_bytes','created_at','expires_at')} | {
        'digest':receipt['artifact_digest'],'archive_sha256':receipt['archive_sha256'],
        'manifest_sha256':receipt['manifest_sha256']}


def verify_evidence(original_run, original_jobs, current_run, current_jobs, all_jobs, artifact,
                    logs, workflow_bytes, **expected):
    original,current,browser,receipts = verified_receipts(original_run,original_jobs,current_run,
                                        current_jobs,all_jobs,logs,workflow_bytes,**expected)
    artifact_proof = _artifact(artifact,original['build'],receipts[0],current_run,expected)
    def summary(job):
        return dict(id=job['id'],name=job['name'],log_sha256=v2.sha256(logs[job['id']]),
                    steps_sha256=v2.sha256(v2.canonical(job['steps'])))
    proof = {k:expected[k] for k in ('repository','source_sha','source_tree','audit_trusted_base',
                                    'workflow_blob','run_id','run_attempt')}
    proof.update(schema=SCHEMA,workflow=v2.WORKFLOW,workflow_sha=expected['source_sha'],
        event=current_run['event'],head_branch=current_run['head_branch'],original_attempt=1,
        retry_browser=browser,artifact=artifact_proof,jobs=[summary(current[n]) for n in v2.JOB_NAMES],
        original_jobs=[summary(original[n]) | {'run_attempt':1,'conclusion':original[n]['conclusion']}
                       for n in v2.JOB_NAMES],
        aliases=[dict(name=n,original_job_id=original[n]['id'],alias_job_id=current[n]['id'],
                      original_attempt=1,api_attempt=2) for n in v2.JOB_NAMES if n not in (browser,v2.AGGREGATE_JOB)],
        receipts=receipts,metadata_sha256={key:v2.sha256(v2.canonical(value)) for key,value in
            (('original_run',original_run),('original_jobs',original_jobs),('run',current_run),
             ('jobs',current_jobs),('all_jobs',all_jobs),('artifact',artifact))})
    validate_proof(proof,**{k:v for k,v in expected.items() if k != 'now'})
    return proof


def validate_proof(proof, *, repository, source_sha, source_tree, run_id, run_attempt,
                   audit_trusted_base, workflow_blob=None):
    """Strict shape/binding only. Never authenticates a self-authored document."""
    proof = v2.metadata(proof,dict)
    require(set(proof) == PROOF_KEYS and proof['schema'] == SCHEMA, 'Exact retry proof schema required')
    require(repository == v2.REPOSITORY and run_attempt == 2 and v2.integer(run_id)
            and all(v2.matches(v2.SHA,x) for x in (source_sha,source_tree,audit_trusted_base))
            and source_sha != audit_trusted_base, 'Invalid independent retry proof controls')
    fixed = dict(repository=repository,source_sha=source_sha,source_tree=source_tree,
        workflow=v2.WORKFLOW,workflow_sha=source_sha,audit_trusted_base=audit_trusted_base,
        run_id=run_id,run_attempt=2,original_attempt=1)
    require(all(proof[k] == value for k,value in fixed.items()) and type(proof['original_attempt']) is int
            and type(proof['run_id']) is int and type(proof['run_attempt']) is int and v2.matches(v2.SHA,proof['workflow_blob'])
            and (workflow_blob is None or proof['workflow_blob'] == workflow_blob), 'Retry proof identity differs')
    browser = proof['retry_browser']; require(browser in v2.BROWSERS, 'Invalid retried browser')
    branch = proof['head_branch']
    require(type(branch) is str and 0 < len(branch) <= 255 and v2.re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*',branch)
            and not branch.startswith(('refs/','pull/')) and not any(x in ('','.','..') for x in branch.split('/'))
            and (proof['event'] == 'workflow_dispatch' or proof['event'] == 'push' and branch == v2.EXPERIMENT_BRANCH),
            'Invalid proof branch/event')
    artifact = proof['artifact']
    require(type(artifact) is dict and set(artifact) == v2.ARTIFACT_KEYS and v2.integer(artifact['id'])
            and artifact['name'] == f'browser-build-{run_id}-1'
            and v2.integer(artifact['size_in_bytes'],1,v2.MAX_ARTIFACT)
            and all(v2.matches(v2.DIGEST,artifact[k]) for k in ('digest','archive_sha256','manifest_sha256')),
            'Invalid original artifact proof')
    created,expiry = v2.timestamp(artifact['created_at']),v2.timestamp(artifact['expires_at'])
    require(0 < expiry-created <= 86400*10**9, 'Invalid artifact proof lifetime')
    maps,ids = [],set()
    for original in (True,False):
        jobs = proof['original_jobs' if original else 'jobs']
        require(type(jobs) is list and len(jobs) == 5, 'Exact proof job inventory required')
        mapped = {}
        keys = {'id','name','log_sha256','steps_sha256'} | ({'run_attempt','conclusion'} if original else set())
        for job,name in zip(jobs,v2.JOB_NAMES):
            require(type(job) is dict and set(job) == keys and job['name'] == name and v2.integer(job['id'])
                    and job['id'] not in ids and all(v2.matches(v2.DIGEST,job[k]) for k in ('log_sha256','steps_sha256')),
                    'Invalid or duplicate proof job identity')
            if original:
                require(type(job['run_attempt']) is int and job['run_attempt'] == 1
                        and job['conclusion'] == ('failure' if name in (browser,v2.AGGREGATE_JOB) else 'success'),
                        'Original failed/success history differs')
            ids.add(job['id']);mapped[name]=job
        maps.append(mapped)
    old,current = maps
    aliases = proof['aliases']; names = [n for n in v2.JOB_NAMES if n not in (browser,v2.AGGREGATE_JOB)]
    require(type(aliases) is list and len(aliases) == 3, 'Exact three retained aliases required')
    for alias,name in zip(aliases,names):
        require(type(alias) is dict and set(alias) == {'name','original_job_id','alias_job_id','original_attempt','api_attempt'}
                and alias == dict(name=name,original_job_id=old[name]['id'],alias_job_id=current[name]['id'],original_attempt=1,api_attempt=2)
                and all(type(alias[k]) is int for k in ('original_job_id','alias_job_id','original_attempt','api_attempt')),
                'Alias proof reassigns original execution')
        require(all(old[name][k] == current[name][k] for k in ('log_sha256','steps_sha256')), 'Alias proof hashes differ')
    receipts=proof['receipts']; require(type(receipts) is list and len(receipts)==4,'Four immutable build receipts required')
    expected=dict(repository=repository,source_sha=source_sha,source_tree=source_tree,
                  audit_trusted_base=audit_trusted_base,run_id=run_id)
    for value,name in zip(receipts,(None,*v2.BROWSERS)):
        _receipt(value,name,2 if name==browser else 1,expected)
        require(value['artifact_id']==str(artifact['id']) and value['artifact_digest']==artifact['digest']
                and value['archive_sha256']==artifact['archive_sha256'] and value['manifest_sha256']==artifact['manifest_sha256'],
                'Receipt differs from original artifact proof')
    hashes=proof['metadata_sha256']
    require(type(hashes) is dict and set(hashes)==METADATA_KEYS and all(v2.matches(v2.DIGEST,x) for x in hashes.values()),
            'Complete original/current metadata hashes required')
    return proof
