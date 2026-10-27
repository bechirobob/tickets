"""Fresh offline regressions for v2 parallel admission; no provider calls."""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import parallel_candidate as parallel

ROOT = Path(__file__).resolve().parents[2]


def fixture():
    """Representative authenticated API shapes; IDs are intentionally distinct."""
    workflow = (ROOT / parallel.WORKFLOW).read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(workflow)).encode() + b'\0' + workflow).hexdigest()
    expected = {'repository': parallel.REPOSITORY, 'source_sha': 'a' * 40,
                'source_tree': 'b' * 40, 'audit_trusted_base': 'c' * 40,
                'workflow_blob': blob, 'run_id': 12345, 'run_attempt': 2,
                'now': datetime(2026, 10, 14, 1, tzinfo=timezone.utc)}
    start = datetime(2026, 10, 14, tzinfo=timezone.utc)
    stamp = lambda seconds: (start + timedelta(seconds=seconds)).strftime('%Y-%m-%dT%H:%M:%SZ')
    run = {'id': 12345, 'run_attempt': 2, 'head_sha': 'a' * 40, 'path': parallel.WORKFLOW,
           'status': 'completed', 'conclusion': 'success', 'repository': {'id': 10, 'full_name': parallel.REPOSITORY},
           'head_repository': {'id': 10, 'full_name': parallel.REPOSITORY}, 'event': 'push',
           'head_branch': parallel.EXPERIMENT_BRANCH, 'created_at': stamp(0), 'run_started_at': stamp(0),
           'updated_at': stamp(170)}
    inventory = parallel.workflow_inventory(workflow, blob)
    jobs, logs, receipts = [], {}, []
    for index, name in enumerate(parallel.JOB_NAMES):
        offset = 1 if name == 'build' else (145 if name == parallel.AGGREGATE_JOB else 60)
        names = (['Set up job', 'Initialize containers', *inventory[name],
                  'Post Set up Python for existing verification scripts', 'Stop containers', 'Complete job']
                 if name in parallel.BROWSERS else ['Set up job', *inventory[name], 'Complete job'])
        steps = [{'name': step, 'number': number, 'status': 'completed', 'conclusion': 'success',
                  'started_at': stamp(offset + number * 2), 'completed_at': stamp(offset + number * 2 + 1)}
                 for number, step in enumerate(names, 1)]
        job = {'name': name, 'id': 500 + index, 'run_id': 12345, 'run_attempt': 2, 'head_sha': 'a' * 40,
               'status': 'completed', 'conclusion': 'success', 'started_at': stamp(offset),
               'completed_at': stamp(offset + len(names) * 2 + 2), 'steps': steps}
        jobs.append(job)
        logs[job['id']] = b'2026-10-14T00:00:00Z ordinary harmless output\n'
        if name == parallel.AGGREGATE_JOB:
            continue
        browser = None if name == 'build' else name
        receipt = {'schema': parallel.RECEIPT_SCHEMA, 'kind': 'producer' if browser is None else 'consumer',
                   'browser': browser, 'repository': parallel.REPOSITORY, 'source_sha': 'a' * 40,
                   'source_tree': 'b' * 40, 'workflow_sha': 'a' * 40, 'audit_trusted_base': 'c' * 40,
                   'run_id': '12345', 'run_attempt': '2', 'artifact_id': '9876', 'artifact_digest': 'd' * 64,
                   'archive_sha256': 'e' * 64, 'manifest_sha256': 'f' * 64}
        step_name = 'Record exact producer transport receipt' if name == 'build' else f'Verify and restore the exact candidate build ({name})'
        step = next(step for step in steps if step['name'] == step_name)
        logtime = step['started_at'][:-1] + '.123456789Z'
        logs[job['id']] += logtime.encode() + b' ' + parallel.PREFIX.encode() + parallel.canonical(receipt)
        receipts.append(receipt)
    upload = next(step for step in jobs[0]['steps'] if step['name'] == 'Upload one immutable bounded browser build')
    artifact = {'id': 9876, 'name': 'browser-build-12345-2', 'size_in_bytes': 1024,
                'expired': False, 'digest': 'sha256:' + 'd' * 64,
                'created_at': upload['started_at'], 'updated_at': upload['completed_at'],
                'expires_at': '2026-10-15T00:00:00Z', 'workflow_run': {'id': 12345, 'repository_id': 10,
                'head_repository_id': 10, 'head_sha': 'a' * 40, 'head_branch': parallel.EXPERIMENT_BRANCH}}
    return run, jobs, artifact, logs, workflow, expected


class ParallelTests(unittest.TestCase):
    def setUp(self):
        self.run, self.jobs, self.artifact, self.logs, self.workflow, self.expected = fixture()

    def verify(self):
        return parallel.verify_evidence(self.run, self.jobs, self.artifact, self.logs, self.workflow, **self.expected)

    def reject(self):
        with self.assertRaises(parallel.ParallelError):
            self.verify()

    def mutate_receipt(self, index, change):
        job = self.jobs[index]
        lines = self.logs[job['id']].splitlines()
        line = lines[-1]
        marker = line.index(parallel.PREFIX.encode()) + len(parallel.PREFIX)
        value = parallel.strict_json(line[marker:])
        change(value)
        lines[-1] = line[:marker] + parallel.canonical(value).rstrip(b'\n')
        self.logs[job['id']] = b'\n'.join(lines) + b'\n'

    def test_container_lifecycle_missing_unknown_failed_or_reordered_rejected(self):
        import copy
        original = copy.deepcopy(self.jobs)
        for mutation in ('missing-init', 'missing-stop', 'unknown', 'failed', 'late-init', 'early-stop'):
            self.jobs = copy.deepcopy(original)
            steps = self.jobs[1]['steps']
            init = next(step for step in steps if step['name'] == 'Initialize containers')
            stop = next(step for step in steps if step['name'] == 'Stop containers')
            if mutation == 'missing-init': steps.remove(init)
            elif mutation == 'missing-stop': steps.remove(stop)
            elif mutation == 'unknown': init['name'] = 'Run arbitrary lifecycle command'
            elif mutation == 'failed': stop['conclusion'] = 'failure'
            elif mutation == 'late-init':
                steps[2]['name'], init['name'] = init['name'], steps[2]['name']
            elif mutation == 'early-stop':
                steps[3]['name'], stop['name'] = stop['name'], steps[3]['name']
            with self.subTest(mutation=mutation): self.reject()

    def test_generic_verify_or_missing_aggregate_cannot_satisfy_unique_gate(self):
        for name in ('verify', 'other-project-verified', 'build'):
            with self.subTest(name=name):
                self.jobs[-1]['name'] = name
                self.reject()
        self.jobs.pop()
        self.reject()

    def test_valid_proof_binds_complete_inventory_and_raw_hashes(self):
        proof = self.verify()
        self.assertEqual(proof['schema'], 'tickets-parallel-candidate/v2')
        self.assertEqual(proof['workflow_sha'], self.expected['source_sha'])
        self.assertEqual([job['name'] for job in proof['jobs']], list(parallel.JOB_NAMES))
        self.assertEqual(len(proof['receipts']), 4)
        for actual, raw in zip(proof['jobs'], self.jobs):
            self.assertEqual(actual['log_sha256'], hashlib.sha256(self.logs[raw['id']]).hexdigest())
            self.assertEqual(actual['steps_sha256'], hashlib.sha256(parallel.canonical(raw['steps'])).hexdigest())
        for key, raw in [('run', self.run), ('jobs', self.jobs), ('artifact', self.artifact)]:
            self.assertEqual(proof['metadata_sha256'][key], hashlib.sha256(parallel.canonical(raw)).hexdigest())
        self.assertEqual(parallel.producer_artifact_id(self.run, self.jobs, self.logs, self.workflow, **self.expected), 9876)
        self.expected['now'] += timedelta(minutes=1)
        self.assertEqual(proof, self.verify(), 'Verification time must not alter immutable proof')

    def test_dispatch_allowed_and_foreign_push_pr_merge_ref_rejected(self):
        self.run['event'] = 'workflow_dispatch'
        self.run['head_branch'] = 'main'
        self.artifact['workflow_run']['head_branch'] = 'main'
        self.verify()
        for event, branch in [('pull_request', 'main'), ('push', 'main'), ('workflow_dispatch', 'refs/pull/12/merge'),
                              ('workflow_dispatch', 'pull/12/merge'), ('workflow_dispatch', 'refs/heads/main'),
                              ('workflow_dispatch', 'feature/../main'), ('workflow_dispatch', True), ('schedule', 'main')]:
            with self.subTest(event=event, branch=branch):
                self.run['event'], self.run['head_branch'] = event, branch
                self.reject()

    def test_exact_run_fields_missing_tampered_or_boolean_fail(self):
        original = copy.deepcopy(self.run)
        mutations = {'id': [None, 0, True, 12346, '12345'], 'run_attempt': [None, 1, True, '2'],
                     'head_sha': [None, 'b' * 40], 'path': [None, 'candidate-checks.yml'],
                     'status': [None, 'in_progress'], 'conclusion': [None, 'failure', 'neutral'],
                     'repository': [None, {}, {'id': True, 'full_name': parallel.REPOSITORY}],
                     'head_repository': [None, {'id': 11, 'full_name': parallel.REPOSITORY},
                                         {'id': 10, 'full_name': 'fork/tickets'}]}
        for key, values in mutations.items():
            for value in values:
                self.run = copy.deepcopy(original)
                self.run[key] = value
                with self.subTest(key=key, value=value):
                    self.reject()
        for key in original:
            self.run = copy.deepcopy(original)
            del self.run[key]
            with self.subTest(missing=key):
                self.reject()

    def test_independent_source_tree_baseline_workflow_and_attempt_are_required(self):
        original = dict(self.expected)
        for key in original:
            if key == 'now':
                values = [None, datetime(2026, 10, 14), datetime(2026, 10, 13, tzinfo=timezone.utc)]
            elif key in ('run_id', 'run_attempt'):
                values = [True, '12345', 0, 9]
            else:
                values = [None, '', '0' * 40]
            for value in values:
                self.expected = dict(original, **{key: value})
                with self.subTest(key=key, value=value):
                    self.reject()
        self.expected = dict(original, audit_trusted_base=original['source_sha'])
        self.reject()

    def test_exact_job_inventory_and_attempt(self):
        original = copy.deepcopy(self.jobs)
        for mutation in ('missing', 'extra', 'duplicate_id', 'duplicate_name', 'old_attempt', 'bool_id',
                         'bool_run_id', 'bad_run', 'wrong_source', 'failed', 'running', 'wrong_name'):
            self.jobs = copy.deepcopy(original)
            if mutation == 'missing': self.jobs.pop()
            if mutation == 'extra': self.jobs.append(copy.deepcopy(self.jobs[0]))
            if mutation == 'duplicate_id': self.jobs[1]['id'] = self.jobs[0]['id']
            if mutation == 'duplicate_name': self.jobs[1]['name'] = self.jobs[0]['name']
            if mutation == 'old_attempt': self.jobs[1]['run_attempt'] = 1
            if mutation == 'bool_id': self.jobs[1]['id'] = True
            if mutation == 'bool_run_id': self.jobs[1]['run_id'] = True
            if mutation == 'bad_run': self.jobs[1]['run_id'] = 999
            if mutation == 'wrong_source': self.jobs[1]['head_sha'] = 'b' * 40
            if mutation == 'failed': self.jobs[1]['conclusion'] = 'failure'
            if mutation == 'running': self.jobs[1]['status'] = 'in_progress'
            if mutation == 'wrong_name': self.jobs[1]['name'] = 'desktop_chromium'
            with self.subTest(mutation=mutation): self.reject()

    def test_every_required_step_must_succeed_with_exact_order_and_types(self):
        original = copy.deepcopy(self.jobs)
        for job_index, job in enumerate(original):
            for step_index, step in enumerate(job['steps']):
                for mutation in ('missing', 'duplicate', 'skipped', 'failure', 'number_bool'):
                    self.jobs = copy.deepcopy(original)
                    target = self.jobs[job_index]['steps']
                    if mutation == 'missing': target.pop(step_index)
                    if mutation == 'duplicate': target.insert(step_index, copy.deepcopy(target[step_index]))
                    if mutation == 'skipped': target[step_index]['conclusion'] = 'skipped'
                    if mutation == 'failure': target[step_index]['conclusion'] = 'failure'
                    if mutation == 'number_bool': target[step_index]['number'] = True
                    if mutation == 'missing' and step['name'] in ('Set up job', 'Complete job'):
                        continue
                    with self.subTest(job=job['name'], step=step['name'], mutation=mutation): self.reject()
        self.jobs = copy.deepcopy(original)
        self.jobs[0]['steps'][4:6] = list(reversed(self.jobs[0]['steps'][4:6]))
        self.reject()
        self.jobs = copy.deepcopy(original)
        self.jobs[0]['steps'][0]['name'] = 'Unreviewed action'
        self.reject()

    def test_step_job_and_run_timestamp_bounds(self):
        mutations = [lambda: self.jobs[0]['steps'][3].update(started_at='2026-10-13T00:00:00Z'),
                     lambda: self.jobs[0]['steps'][3].update(completed_at='2026-10-15T00:00:00Z'),
                     lambda: self.jobs[0].update(completed_at='2026-10-13T00:00:00Z'),
                     lambda: self.jobs[1].update(started_at='2026-10-14T00:00:00Z'),
                     lambda: self.jobs[-1].update(started_at='2026-10-14T00:00:00Z'),
                     lambda: self.run.update(updated_at='2026-10-15T00:00:00Z'),
                     lambda: self.run.update(run_started_at='2026-10-15T00:00:00Z')]
        for mutation in mutations:
            self.setUp()
            mutation()
            self.reject()
        for value in ('2026-13-01T00:00:00Z', '2026-10-14T00:00:00+00:00', 'today', None, True):
            self.setUp()
            self.jobs[0]['steps'][0]['started_at'] = value
            self.reject()

    def test_receipts_v1_missing_unknown_keys_boolean_ids_and_mixed_values(self):
        original = copy.deepcopy(self.logs)
        for index in range(4):
            for key, value in [('schema', 'tickets-browser-build/v1'), ('kind', 'unexpected'), ('browser', 'unexpected'),
                               ('repository', 'fork/tickets'), ('source_sha', 'b'*40), ('source_tree', 'a'*40),
                               ('workflow_sha', 'b'*40), ('audit_trusted_base', 'd'*40), ('run_id', True),
                               ('run_attempt', '1'), ('artifact_id', '123'), ('artifact_digest', 'a'*64),
                               ('archive_sha256', 'b'*64), ('manifest_sha256', 'c'*64)]:
                self.logs = copy.deepcopy(original)
                self.mutate_receipt(index, lambda item: item.update({key: value}))
                with self.subTest(index=index, key=key): self.reject()
            for key in parallel.RECEIPT_KEYS:
                self.logs = copy.deepcopy(original)
                self.mutate_receipt(index, lambda item: item.pop(key))
                with self.subTest(index=index, missing=key): self.reject()
            self.logs = copy.deepcopy(original)
            self.mutate_receipt(index, lambda item: item.update(extra='untrusted'))
            self.reject()

    def test_one_consistent_foreign_audit_baseline_still_rejected(self):
        for index in range(4):
            self.mutate_receipt(index, lambda item: item.update(audit_trusted_base='d'*40))
        self.reject()
        self.expected['audit_trusted_base'] = 'd'*40
        self.verify()

    def test_receipts_are_anchored_unique_and_inside_named_step(self):
        original = copy.deepcopy(self.logs)
        for index in range(4):
            jid = self.jobs[index]['id']
            raw = original[jid]
            line = raw.splitlines()[-1]
            for changed in (b'no receipt\n', raw+line+b'\n', line.split(b' ', 1)[1]+b'\n',
                            b'prefix '+line+b'\n', b'\x1b[0m'+line+b'\n', line+b' trailing\n',
                            line.replace(b'T00:', b'T01:', 1)+b'\n', line.replace(b'Z ', b'Z  ', 1)+b'\n'):
                self.logs = copy.deepcopy(original)
                self.logs[jid] = changed
                with self.subTest(index=index, changed=changed[:60]): self.reject()
        self.logs = copy.deepcopy(original)
        self.logs[self.jobs[-1]['id']] += original[self.jobs[0]['id']]
        self.reject()

    def test_canonical_duplicate_json_keys_and_raw_log_bounds(self):
        jid = self.jobs[0]['id']
        original = self.logs[jid]
        for changed in (original.replace(b'{', b'{"schema":"tickets-browser-build/v2",', 1),
                        original.replace(b'"artifact_id":', b'"artifact_id": ', 1),
                        original.replace(b'"artifact_id":"9876"', b'"artifact_id":NaN', 1),
                        original.replace(b'"artifact_id":"9876"', b'"artifact_id":1.0', 1)):
            self.logs[jid] = changed
            self.reject()
        self.logs[jid] = original
        for limit in ('MAX_LOG', 'MAX_RECEIPT', 'MAX_JSON', 'MAX_WORKFLOW'):
            with patch.object(parallel, limit, 1): self.reject()
        self.logs[jid] = ''
        self.reject()

    def test_all_five_log_files_required_no_foreign_id(self):
        original = copy.deepcopy(self.logs)
        for jid in original:
            self.logs = copy.deepcopy(original)
            del self.logs[jid]
            self.reject()
        self.logs = copy.deepcopy(original)
        self.logs[999] = b'extra'
        self.reject()
        self.logs = copy.deepcopy(original)
        self.logs[True] = b'extra'
        self.reject()

    def test_artifact_metadata_identity_timing_expiry_and_bounds(self):
        original = copy.deepcopy(self.artifact)
        fields = {'id': [True, '9876', 0, 123], 'name': ['', 'browser-build-12345-1'],
                  'size_in_bytes': [True, 0, parallel.MAX_ARTIFACT+1], 'expired': [True, 0, None],
                  'digest': ['d'*64, 'sha256:'+'e'*64], 'created_at': ['2026-10-13T00:00:00Z'],
                  'updated_at': ['2026-10-15T00:00:00Z'], 'expires_at': ['2026-10-14T01:00:00Z', '2026-10-13T00:00:00Z']}
        for key, values in fields.items():
            for value in values:
                self.artifact = copy.deepcopy(original)
                self.artifact[key] = value
                with self.subTest(key=key, value=value): self.reject()
        for key in original:
            self.artifact = copy.deepcopy(original)
            del self.artifact[key]
            with self.subTest(missing=key): self.reject()
        for key in original['workflow_run']:
            self.artifact = copy.deepcopy(original)
            self.artifact['workflow_run'][key] = True if key.endswith('id') else 'wrong'
            with self.subTest(owner=key): self.reject()

    def test_trusted_workflow_pin_and_required_gates_cannot_be_bypassed(self):
        original = self.workflow
        for old, new in [(b'Lint application', b'Ignore lint'), (b'  mobile_webkit:\n', b'  unknown:\n'),
                         (b'name: mobile-webkit', b'name: unknown'), (b'jobs:\n', b'jobs:\n  build:\n')]:
            self.workflow = original.replace(old, new)
            self.reject()
            self.expected['workflow_blob'] = hashlib.sha1(b'blob '+str(len(self.workflow)).encode()+b'\0'+self.workflow).hexdigest()
            self.reject()
        self.workflow = original + b'\n# changed bytes\n'
        self.reject()

    def test_strict_json_duplicate_float_depth_and_oversize(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":1.0}', b'{"a":NaN}', b'[Infinity]', b'{',
                    b'"\xff"', b'['*40+b'0'+b']'*40, b'1'+b'0'*30):
            with self.subTest(raw=raw[:40]), self.assertRaises(parallel.ParallelError):
                parallel.strict_json(raw)
        with self.assertRaises(parallel.ParallelError): parallel.strict_json(b'{}', 1)

    def test_persisted_proof_rejects_all_root_omissions_and_nested_tampering(self):
        valid = self.verify()
        kwargs = {key: value for key, value in self.expected.items() if key != 'now'}
        self.assertEqual(parallel.validate_proof(valid, **kwargs), valid)
        for key in valid:
            changed = copy.deepcopy(valid)
            del changed[key]
            with self.subTest(missing=key), self.assertRaises(parallel.ParallelError):
                parallel.validate_proof(changed, **kwargs)
        mutations = [lambda p: p.update(schema='tickets-parallel-candidate/v1'), lambda p: p.update(run_attempt=True),
                     lambda p: p.update(extra=1), lambda p: p['artifact'].update(id=True),
                     lambda p: p['artifact'].update(digest='0'*64), lambda p: p['jobs'][0].update(id=True),
                     lambda p: p['jobs'][1].update(id=p['jobs'][0]['id']), lambda p: p['jobs'].reverse(),
                     lambda p: p['receipts'][0].update(audit_trusted_base='d'*40),
                     lambda p: p['receipts'].pop(), lambda p: p['metadata_sha256'].update(run='bad')]
        for mutation in mutations:
            changed = copy.deepcopy(valid)
            mutation(changed)
            with self.assertRaises(parallel.ParallelError): parallel.validate_proof(changed, **kwargs)

    def test_evidence_file_symlink_hardlink_and_overflow_rejected(self):
        import os
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'raw'
            path.write_bytes(b'{}')
            self.assertEqual(parallel.read_file(path, 2), b'{}')
            with self.assertRaises(parallel.ParallelError): parallel.read_file(path, 1)
            link = Path(root)/'linked'
            link.symlink_to(path)
            with self.assertRaises(parallel.ParallelError): parallel.read_file(link, 2)
            link.unlink()
            os.link(path, link)
            with self.assertRaises(parallel.ParallelError): parallel.read_file(path, 2)


if __name__ == '__main__':
    unittest.main()
