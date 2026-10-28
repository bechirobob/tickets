"""Offline adversarial retry graphs; no remote provider or release side effects."""
import copy
import unittest
from datetime import datetime, timedelta
import parallel_candidate as v2
import parallel_candidate_retry as retry
from test_parallel_candidate import fixture as v2fixture


def fixture():
    run, originals, artifact, logs, workflow, expected = v2fixture()
    run.update(run_attempt=1, conclusion='failure')
    target = v2.BROWSERS[-1]
    def shift(stamp):
        return (datetime.fromisoformat(stamp.replace('Z','+00:00')) + timedelta(seconds=300)).strftime('%Y-%m-%dT%H:%M:%SZ')
    current = copy.deepcopy(run)
    current.update(created_at=shift('2026-10-14T00:00:01Z'),run_attempt=2, conclusion='success', run_started_at=shift(run['run_started_at']), updated_at=shift(run['updated_at']))
    prefix='https://api.github.com/repos/bechirobob/tickets/actions/runs/12345'
    for record,attempt in ((run,1),(current,2)):
        record.update(url=prefix,jobs_url=f'{prefix}/attempts/{attempt}/jobs',logs_url=f'{prefix}/attempts/{attempt}/logs')
    currents = []
    for original in originals:
        original.update(run_attempt=1, runner_id=55+original['id'], runner_name='runner-'+str(original['id']),
                        runner_group_name='GitHub Actions', labels=['ubuntu-24.04'], workflow_name='Candidate',
                        head_branch=run['head_branch'], run_url='https://api.github.com/repos/bechirobob/tickets/actions/runs/12345')
        name = original['name']
        if name in v2.BROWSERS:
            # Pinned Node/Python setup both register success-only post hooks.
            post = next(x for x in original['steps'] if x['name'].startswith('Post Set up Python'))
            node_post = dict(post, name='Post Set up Node.js', completed_at=post['started_at'])
            original['steps'].insert(original['steps'].index(post),node_post)
            for number,step in enumerate(original['steps'],1):step['number']=number
        # Original receipts always carry original producer/execution attempt.
        logs[original['id']] = logs[original['id']].replace(b'"run_attempt":"2"',b'"run_attempt":"1"')
        alias = copy.deepcopy(original)
        alias.update(id=original['id']+100, run_attempt=2)
        if name in (target, v2.AGGREGATE_JOB):
            for key in ('started_at','completed_at'): alias[key]=shift(alias[key])
            for step in alias['steps']:
                for key in ('started_at','completed_at'): step[key]=shift(step[key])
            raw = logs[original['id']]
            if name == target:
                receipt = v2.strict_json(raw.split(v2.PREFIX.encode())[-1])
                receipt.update(schema=retry.RECEIPT_SCHEMA,run_attempt='2',producer_attempt='1')
                step = next(x for x in alias['steps'] if x['name'].startswith('Verify and restore'))
                raw = step['started_at'][:-1].encode()+b'.123456789Z '+v2.PREFIX.encode()+v2.canonical(receipt)
            logs[alias['id']] = raw
            original['conclusion']='failure'
            failed = retry.DOWNLOAD_STEP if name==target else v2.AGGREGATE_STEP
            found=False
            inventory=v2.workflow_inventory(workflow,expected['workflow_blob'])[name]
            for step in original['steps']:
                if step['name']==failed:
                    step['conclusion']='failure'; found=True
                elif found and (step['name'] in inventory or name == target and step['name'] in
                               ('Post Set up Node.js','Post Set up Python for existing verification scripts')):
                    step.update(conclusion='skipped',completed_at=step['started_at'])
            logs[original['id']]=b'2026-10-14T00:01:00Z Failed combined download/unpack\n'
        else:
            logs[alias['id']]=logs[original['id']]
        currents.append(alias)
    artifact['name']='browser-build-12345-1'
    return run,originals,current,currents,copy.deepcopy(originals+currents),artifact,logs,workflow,expected


class RetryTests(unittest.TestCase):
    def setUp(self): self.data=fixture()
    def verify(self): return retry.verify_evidence(*self.data[:-1],**self.data[-1])
    def sync(self): self.data[4][:]=copy.deepcopy(self.data[1]+self.data[3])
    def reject(self):
        with self.assertRaises(retry.ParallelError): self.verify()
    def test_real_failed_download_success_only_cache_posts_are_skipped(self):
        # Hosted run40739969801 proved Node's post-if success hook is skipped;
        # pinned setup-python ece7cb06/action.yml has the same post-if condition.
        for title in ('Post Set up Node.js','Post Set up Python for existing verification scripts'):
            original=next(x for x in self.data[1][3]['steps'] if x['name']==title)
            current=next(x for x in self.data[3][3]['steps'] if x['name']==title)
            self.assertEqual(original['conclusion'],'skipped')
            self.assertEqual(current['conclusion'],'success')
        self.verify()
    def test_original_cache_posts_cannot_claim_success_or_failure(self):
        for title in ('Post Set up Node.js','Post Set up Python for existing verification scripts'):
            for conclusion in ('success','failure','cancelled'):
                with self.subTest(title=title,conclusion=conclusion):
                    self.data=fixture()
                    next(x for x in self.data[1][3]['steps'] if x['name']==title)['conclusion']=conclusion
                    self.sync();self.reject()
    def test_successful_current_or_retained_cache_post_cannot_skip(self):
        for index in (1,2,3):
            for title in ('Post Set up Node.js','Post Set up Python for existing verification scripts'):
                with self.subTest(index=index,title=title):
                    self.data=fixture()
                    next(x for x in self.data[3][index]['steps'] if x['name']==title)['conclusion']='skipped'
                    if index != 3:
                        next(x for x in self.data[1][index]['steps'] if x['name']==title)['conclusion']='skipped'
                    self.sync();self.reject()
    def test_other_original_lifecycle_cannot_skip(self):
        for title in ('Set up job','Initialize containers','Stop containers','Complete job'):
            with self.subTest(title=title):
                self.data=fixture()
                next(x for x in self.data[1][3]['steps'] if x['name']==title)['conclusion']='skipped'
                self.sync();self.reject()
    def test_original_checkout_post_cleanup_cannot_skip(self):
        steps=self.data[1][3]['steps']
        post=dict(steps[-1],name='Post Check out exact candidate',conclusion='skipped',
                  completed_at=steps[-1]['started_at'])
        steps.insert(-1,post)
        for number,step in enumerate(steps,1):step['number']=number
        self.sync();self.reject()
    def test_original_cache_posts_allow_null_skipped_timestamps(self):
        for step in self.data[1][3]['steps']:
            if step['name'] in ('Post Set up Node.js','Post Set up Python for existing verification scripts'):
                step.update(started_at=None,completed_at=None)
        self.sync();self.verify()
    def test_original_cache_post_skipped_execution_duration_rejected(self):
        step=next(x for x in self.data[1][3]['steps'] if x['name']=='Post Set up Python for existing verification scripts')
        step['completed_at']=self.data[1][3]['completed_at'];self.sync();self.reject()
    def test_valid_retains_original_execution_ids_and_attempts(self):
        proof=self.verify()
        self.assertEqual(proof['original_attempt'],1)
        self.assertEqual(len(proof['aliases']),3)
        self.assertEqual(proof['receipts'][-1]['producer_attempt'],'1')
        self.assertEqual(proof['receipts'][0]['run_attempt'],'1')
    def test_proof_shape_roundtrip_and_mutations(self):
        proof=self.verify()
        expected={k:v for k,v in self.data[-1].items() if k!='now'}
        self.assertEqual(retry.validate_proof(proof,**expected),proof)
        mutations=[lambda p:p.update(extra=True),lambda p:p.update(original_attempt=True),
                   lambda p:p.update(run_attempt=3),lambda p:p.update(source_sha='f'*40),
                   lambda p:p['aliases'][0].update(original_job_id=p['jobs'][0]['id']),
                   lambda p:p['original_jobs'][0].update(run_attempt=2),
                   lambda p:p['jobs'][0].update(id=p['original_jobs'][0]['id']),
                   lambda p:p['receipts'][0].update(run_attempt='2'),
                   lambda p:p['metadata_sha256'].pop('original_jobs'),
                   lambda p:p['artifact'].update(name='browser-build-12345-2')]
        for number,mutate in enumerate(mutations):
            with self.subTest(number=number):
                value=copy.deepcopy(proof);mutate(value)
                with self.assertRaises(retry.ParallelError):retry.validate_proof(value,**expected)
    def test_every_required_failed_lane_guard_and_downstream_step(self):
        template=fixture();target=template[1][3]
        inventory=v2.workflow_inventory(template[-2],template[-1]['workflow_blob'])[target['name']]
        for title in inventory:
            if title==retry.DOWNLOAD_STEP:continue
            with self.subTest(step=title):
                self.data=fixture()
                step=next(x for x in self.data[1][3]['steps'] if x['name']==title)
                step['conclusion']='success' if step['conclusion']=='skipped' else 'skipped'
                self.sync();self.reject()
    def test_duplicate_receipt_and_failed_history_receipt_reject(self):
        for identifier in (503,603):
            with self.subTest(job=identifier):
                self.data=fixture();self.data[6][identifier]+=self.data[6][603];self.reject()
    def test_wrong_current_producer_or_attempt_alias_reject(self):
        self.data[3][0]['started_at']=self.data[2]['run_started_at'];self.sync();self.reject()
    def test_each_changed_alias_stable_field_rejects(self):
        for field in retry.ALIAS_FIELDS:
            with self.subTest(field=field):
                self.data=fixture(); self.data[3][0][field]='changed';self.sync();self.reject()
    def test_alias_changed_log_rejects(self):
        self.data[6][600]+=b'changed\n';self.reject()
    def test_missing_logs_rejects(self):
        del self.data[6][503];self.reject()
    def test_malformed_history_records_fail_closed(self):
        for value in (None,[],{}, {'id':[]},{'id':True}):
            with self.subTest(value=value):
                self.data=fixture();self.data[4][0]=value;self.reject()
    def test_extra_job_rejects(self):
        self.data[4].append(copy.deepcopy(self.data[4][0]));self.reject()
    def test_third_attempt_rejects(self):
        self.data[2]['run_attempt']=3;self.reject()
    def test_changed_source_rejects(self):
        self.data[2]['head_sha']='f'*40;self.reject()
    def test_original_assertion_or_integrity_failure_rejects(self):
        target=self.data[1][3]
        for step in target['steps']:
            if step['name']==retry.DOWNLOAD_STEP:step['conclusion']='success'
            if step['name'].startswith('Verify and restore'):step['conclusion']='failure'
        self.sync();self.reject()
    def test_two_failed_lanes_reject(self):
        self.data[1][1]['conclusion']='failure';self.sync();self.reject()
    def test_downstream_execution_rejects(self):
        target=self.data[1][3]
        next(x for x in target['steps'] if x['name'].startswith('Verify and restore'))['conclusion']='success'
        self.sync();self.reject()
    def test_expired_or_future_artifact_rejects(self):
        for key,value in [('expired',True),('created_at','2027-01-01T00:00:00Z'),('expires_at','2026-10-14T00:05:00Z')]:
            with self.subTest(key=key):
                self.data=fixture();self.data[5][key]=value;self.reject()
    def test_changed_artifact_digest_rejects(self):
        self.data[5]['digest']='sha256:'+'0'*64;self.reject()
    def test_fresh_receipt_attempt_spoof_rejects(self):
        self.data[6][603]=self.data[6][603].replace(b'"producer_attempt":"1"',b'"producer_attempt":"2"');self.reject()
    def test_original_attempt_not_terminal_rejects(self):
        self.data[0]['status']='in_progress';self.reject()
    def test_missing_original_failed_history_rejects(self):
        self.data[4][:]=self.data[3];self.reject()

if __name__=='__main__':unittest.main()
