"""Authenticated write-once collection of the complete 1-to-2 retry graph.

No caller-supplied authentication flag, alternative transport, or candidate code.
The existing authenticated client and private immutable custody primitives are
reused; the v2 collector and admission policy are not changed.
"""
import datetime as dt
import os
from pathlib import Path
import secrets
import parallel_candidate_control as base

SCHEMA = 'tickets-parallel-retry-collection/v3'
CollectionError = base.CollectionError
require = base.require
RETRY_CONTROLS = ('ops/vps/parallel_candidate.py', 'ops/vps/parallel_candidate_control.py',
                  'ops/vps/parallel_candidate_retry.py', 'ops/vps/parallel_candidate_retry_control.py')


def authenticate_source(root, *, source, candidate, trusted_baseline):
    identity, workflow = base.authenticate_source(root, source=source, candidate=candidate,
                                                 trusted_baseline=trusted_baseline)
    with base.Directory(root, private=False):
        for path in RETRY_CONTROLS:
            blob, content = base.control_blob(root, trusted_baseline, path)
            require(base.control_blob(root, source, path) == (blob, content)
                    and base.control_blob(root, candidate, path) == (blob, content),
                    'Retry controls differ from independently trusted baseline: ' + path)
            identity['controls'][path] = blob
    return identity, workflow


def latest(client, run_id, candidate, repository_id):
    value = client.api(f'actions/runs/{run_id}')
    require(type(value) is dict and type(value.get('id')) is int and value['id'] == run_id
            and type(value.get('run_attempt')) is int and value['run_attempt'] == 2
            and value.get('head_sha') == candidate and value.get('path') == base.WORKFLOW
            and value.get('status') == 'completed' and value.get('conclusion') == 'success'
            and type(value.get('repository')) is dict and value['repository'].get('id') == repository_id
            and value['repository'].get('full_name') == base.REPOSITORY,
            'Latest run is not the selected terminal second attempt')
    return value


def match_latest(newest, documents, run_id):
    """GitHub's attempt endpoint has its own record-created time and URL routes.

    Validate those three differences explicitly; every other returned field must
    remain byte-canonically equal, including unknown future metadata fields.
    """
    origin, current = documents['original_run'], documents['run']
    prefix = f'https://api.github.com/repos/{base.REPOSITORY}/actions/runs/{run_id}'
    for value, suffix in ((newest,''),(origin,'/attempts/1'),(current,'/attempts/2')):
        require(value.get('url') == prefix and value.get('jobs_url') == prefix+suffix+'/jobs'
                and value.get('logs_url') == prefix+suffix+'/logs', 'Unexpected authenticated run endpoint URLs')
    require(newest.get('created_at') == origin.get('created_at'), 'Latest run creation differs from original run')
    ignored = {'created_at','jobs_url','logs_url'}
    require(base.canonical({k:v for k,v in newest.items() if k not in ignored}) ==
            base.canonical({k:v for k,v in current.items() if k not in ignored}),
            'Latest run differs from exact second attempt')


def inventory(client, *, run_id, candidate):
    repo = client.repository()
    require(type(repo) is dict and repo.get('full_name') == base.REPOSITORY
            and repo.get('private') is False and repo.get('visibility') == 'public'
            and repo.get('fork') is False and type(repo.get('id')) is int and repo['id'] > 0,
            'Unexpected authenticated retry repository')
    newest = latest(client, run_id, candidate, repo['id'])
    documents = {}
    for attempt, prefix in ((1, 'original_'), (2, '')):
        run = client.api(f'actions/runs/{run_id}/attempts/{attempt}')
        require(type(run) is dict and type(run.get('repository')) is dict
                and run['repository'].get('id') == repo['id'], 'Retry repository identity changed')
        documents[prefix+'run'] = run
        document = client.api(f'actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
        documents[prefix+'jobs'] = jobs(document, 5)
    documents['all_jobs'] = jobs(client.api(f'actions/runs/{run_id}/jobs?filter=all&per_page=100'), 10)
    match_latest(newest, documents, run_id)
    require(len(base.canonical(documents)) <= base.MAX_JSON, 'Oversized complete retry metadata')
    return documents, repo['id']


def jobs(document, count):
    require(type(document) is dict and type(document.get('total_count')) is int
            and document['total_count'] == count and type(document.get('jobs')) is list
            and len(document['jobs']) == count, 'Incomplete or extra authenticated job inventory')
    return document['jobs']


def graph_args(documents):
    return tuple(documents[k] for k in ('original_run','original_jobs','run','jobs','all_jobs'))


def collect_or_verify(client, directory, *, root, source, candidate, trusted_baseline,
                      run_id, attempt, verifier, now=None, expected_proof=None):
    try:
        return _collect(client, directory, root=root, source=source, candidate=candidate,
                        trusted_baseline=trusted_baseline, run_id=run_id, attempt=attempt,
                        verifier=verifier, now=now, expected_proof=expected_proof)
    except (OSError, UnicodeError, RecursionError, KeyError, TypeError) as error:
        raise CollectionError('Retry evidence collection failed closed') from error


def _collect(client, directory, *, root, source, candidate, trusted_baseline, run_id,
             attempt, verifier, now, expected_proof):
    run_id, attempt = base.number(run_id), base.number(attempt)
    require(attempt == 2, 'Exactly one additional consumer attempt is supported')
    now = now or dt.datetime.now(dt.timezone.utc)
    identity, workflow = authenticate_source(root, source=source, candidate=candidate, trusted_baseline=trusted_baseline)
    identity.update(run_id=run_id, run_attempt=attempt)
    expected = dict(repository=base.REPOSITORY, source_sha=candidate, source_tree=identity['source_tree'],
                    audit_trusted_base=trusted_baseline, workflow_blob=identity['controls'][base.WORKFLOW],
                    run_id=run_id, run_attempt=attempt, now=now)
    directory = Path(directory)
    require(directory.name not in ('', '.', '..') and '..' not in directory.parts, 'Invalid retry custody directory')
    with base.Directory(directory.parent) as parent:
        documents, repo_id = inventory(client, run_id=run_id, candidate=candidate)
        args = graph_args(documents)
        verifier.verify_run_jobs(*args, workflow, **expected)
        all_jobs = documents['all_jobs']
        def finish(selected, stored, raw, records, proof):
            # Every pre-host invocation checks the current latest attempt again.
            match_latest(latest(client, run_id, candidate, repo_id), documents, run_id)
            require(selected.read('selection.json', base.MAX_JSON) == raw
                    and base.read_logs(selected, all_jobs)[1] == records
                    and selected.names() == {'selection.json', *(r['name'] for r in records)},
                    'Immutable retry evidence changed during verification')
            return proof
        if parent.exists(directory.name):
            with base.Directory(directory) as selected:
                raw = selected.read('selection.json', base.MAX_JSON)
                stored = base.strict_json(raw)
                require(type(stored) is dict and set(stored) == {'schema','identity','metadata','artifact','logs','proof'}
                        and stored['schema'] == SCHEMA and stored['identity'] == identity
                        and raw == base.canonical(stored) and stored['metadata'] == documents,
                        'Original retry selection changed; replacement forbidden')
                logs, records = base.read_logs(selected, all_jobs)
                require(records == stored['logs'], 'Original retry log bytes changed')
                identifier = base.number(verifier.producer_artifact_id(*args, logs, workflow, **expected))
                artifact = client.api(f'actions/artifacts/{identifier}')
                require(artifact == stored['artifact'], 'Original immutable artifact metadata changed')
                proof = verifier.verify_evidence(*args, artifact, logs, workflow, **expected)
                require(proof == stored['proof'] and (expected_proof is None or proof == expected_proof),
                        'Original authenticated retry proof changed')
                return finish(selected, stored, raw, records, proof)
        require(expected_proof is None, 'Previously selected retry evidence is missing')
        staging_name = '.retry-pending-' + secrets.token_hex(16)
        os.mkdir(staging_name, mode=0o700, dir_fd=parent.fd)
        with base.Directory(directory.parent / staging_name) as staging:
            logs, records = base.stream_logs(client, staging, all_jobs)
            identifier = base.number(verifier.producer_artifact_id(*args, logs, workflow, **expected))
            artifact = client.api(f'actions/artifacts/{identifier}')
            require(type(artifact) is dict and len(base.canonical(artifact)) <= base.MAX_JSON, 'Malformed artifact metadata')
            proof = verifier.verify_evidence(*args, artifact, logs, workflow, **expected)
            stored = dict(schema=SCHEMA, identity=identity, metadata=documents, artifact=artifact, logs=records, proof=proof)
            raw = base.canonical(stored)
            staging.write('selection.json', raw)
            finish(staging, stored, raw, records, proof)
            os.fsync(staging.fd)
            base.rename_new(parent, staging_name, directory.name)
            prior_parent, _, fd, pinned = staging.links[-1]
            staging.links[-1] = (prior_parent, directory.name, fd, pinned)
            staging.path = directory.absolute()
            staging.check()
            return finish(staging, stored, raw, records, proof)
