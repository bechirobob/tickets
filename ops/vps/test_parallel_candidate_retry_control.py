"""Authenticated-client boundary and real private custody, using offline API fixtures."""
import copy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import parallel_candidate_retry_control as control
import parallel_candidate_retry as verifier
from test_parallel_candidate_retry import fixture


class Client:
    def __init__(self,data):
        self.data=data;self.streams=[];self.latest_calls=0;self.advance_at=None
    def repository(self):
        return dict(id=10,full_name=control.base.REPOSITORY,private=False,visibility='public',fork=False)
    def api(self,path):
        old,oldjobs,current,currentjobs,history,artifact,logs,workflow,expected=self.data
        if path=='actions/runs/12345':
            self.latest_calls+=1
            result=copy.deepcopy(current)
            result.update(created_at=old['created_at'],jobs_url=current['url']+'/jobs',logs_url=current['url']+'/logs')
            if self.advance_at and self.latest_calls>=self.advance_at:result['run_attempt']=3
            return result
        if path=='actions/runs/12345/attempts/1':return copy.deepcopy(old)
        if path=='actions/runs/12345/attempts/2':return copy.deepcopy(current)
        if path=='actions/runs/12345/attempts/1/jobs?per_page=100':return dict(total_count=len(oldjobs),jobs=copy.deepcopy(oldjobs))
        if path=='actions/runs/12345/attempts/2/jobs?per_page=100':return dict(total_count=len(currentjobs),jobs=copy.deepcopy(currentjobs))
        if path=='actions/runs/12345/jobs?filter=all&per_page=100':return dict(total_count=len(history),jobs=copy.deepcopy(history))
        if path=='actions/artifacts/9876':return copy.deepcopy(artifact)
        raise AssertionError(path)
    def stream(self,path,destination,max_size):
        self.streams.append(path)
        raw=self.data[6][int(path.split('/')[2])]
        fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as out:out.write(raw)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.parent=Path(self.temp.name);self.directory=self.parent/'selected'
        self.data=fixture();self.client=Client(self.data)
        e=self.data[-1]
        self.identity=dict(repository=e['repository'],source_sha=e['source_sha'],candidate_sha=e['source_sha'],
                           source_tree=e['source_tree'],trusted_baseline=e['audit_trusted_base'],
                           controls={control.base.WORKFLOW:e['workflow_blob']})
        self.auth=patch.object(control,'authenticate_source',return_value=(self.identity,self.data[-2]))
        self.auth.start();self.addCleanup(self.auth.stop)
    def collect(self,**extra):
        e=self.data[-1]
        return control.collect_or_verify(self.client,self.directory,root=self.parent,source=e['source_sha'],
               candidate=e['source_sha'],trusted_baseline=e['audit_trusted_base'],run_id=e['run_id'],
               attempt=2,verifier=verifier,now=e['now'],**extra)
    def test_observed_attempt_record_creation_and_endpoint_differences(self):
        documents,_=control.inventory(self.client,run_id=12345,candidate='a'*40)
        current=documents['run']; original=documents['original_run']
        self.assertGreater(current['created_at'],current['run_started_at'])
        self.assertNotEqual(current['created_at'],original['created_at'])
        self.collect()
    def test_latest_creation_and_endpoint_routes_cannot_be_ignored(self):
        documents,_=control.inventory(self.client,run_id=12345,candidate='a'*40)
        newest=self.client.api('actions/runs/12345')
        for key in ('created_at','jobs_url','logs_url','head_sha'):
            with self.subTest(key=key):
                changed=copy.deepcopy(newest);changed[key]='changed'
                with self.assertRaises(control.CollectionError):control.match_latest(changed,documents,12345)
    def test_real_verifier_initial_then_no_replacement_prehost(self):
        proof=self.collect();self.assertEqual(len(self.client.streams),10)
        self.assertEqual(self.collect(expected_proof=proof),proof)
        self.assertEqual(len(self.client.streams),10)
        self.assertGreaterEqual(self.client.latest_calls,5)
    def test_latest_advances_during_download_rejects(self):
        self.client.advance_at=2
        with self.assertRaises(control.CollectionError):self.collect()
        self.assertFalse(self.directory.exists())
    def test_latest_advances_before_prehost_rejects(self):
        proof=self.collect();self.client.advance_at=self.client.latest_calls+1
        with self.assertRaises(control.CollectionError):self.collect(expected_proof=proof)
        self.assertEqual(len(self.client.streams),10)
    def test_missing_selected_log_no_redownload(self):
        proof=self.collect();(self.directory/'job-503.log').unlink()
        with self.assertRaises(control.CollectionError):self.collect(expected_proof=proof)
        self.assertEqual(len(self.client.streams),10)
    def test_mutated_selected_log_no_redownload(self):
        proof=self.collect();(self.directory/'job-503.log').write_bytes(b'changed')
        with self.assertRaises(control.CollectionError):self.collect(expected_proof=proof)
        self.assertEqual(len(self.client.streams),10)
    def test_missing_previously_selected_directory_rejects(self):
        with self.assertRaises(control.CollectionError):self.collect(expected_proof={'any':'proof'})
        self.assertEqual(self.client.streams,[])
    def test_artifact_changed_prehost_rejects(self):
        proof=self.collect();self.data[5]['expired']=True
        with self.assertRaises(control.CollectionError):self.collect(expected_proof=proof)
    def test_symlink_custody_rejects(self):
        other=self.parent/'other';other.mkdir(mode=0o700);self.directory.symlink_to(other)
        with self.assertRaises(control.CollectionError):self.collect()
    def test_hardlink_log_rejects(self):
        proof=self.collect();os.link(self.directory/'job-500.log',self.parent/'extra')
        with self.assertRaises(control.CollectionError):self.collect(expected_proof=proof)
    def test_extra_attempt_history_rejects_before_download(self):
        self.data[4].append(copy.deepcopy(self.data[4][0]))
        with self.assertRaises(control.CollectionError):self.collect()
        self.assertEqual(self.client.streams,[])
    def test_new_module_source_baseline_checks(self):
        self.auth.stop()
        with patch.object(control.base,'authenticate_source',return_value=(self.identity,self.data[-2])), \
             patch.object(control.base,'control_blob',return_value=('a'*40,b'bytes')) as blob:
            control.authenticate_source(self.parent,source='a'*40,candidate='b'*40,trusted_baseline='c'*40)
            self.assertEqual(blob.call_count,12)
            self.assertEqual(set(self.identity['controls'])- {control.base.WORKFLOW},set(control.RETRY_CONTROLS))
    def test_changed_new_module_source_rejects(self):
        self.auth.stop()
        with patch.object(control.base,'authenticate_source',return_value=(self.identity,self.data[-2])), \
             patch.object(control.base,'control_blob',side_effect=[('a'*40,b'old'),('b'*40,b'new')]):
            with self.assertRaises(control.CollectionError):
                control.authenticate_source(self.parent,source='a'*40,candidate='b'*40,trusted_baseline='c'*40)

if __name__=='__main__':unittest.main()
