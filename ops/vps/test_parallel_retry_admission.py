"""Standalone operator retry proof binding, never network or host activation."""
import argparse
from contextlib import ExitStack
import json
import os
import hashlib
import re
import marshal
import struct
import importlib.util
import subprocess
import copy
import tempfile
import sys
from pathlib import Path
import types
import unittest
from unittest.mock import patch

import test_parallel_admission as admission_fixtures
from test_parallel_admission import release, proof_fixture, REPOSITORY, CANDIDATE, TREE, BASELINE


def retry_proof():
    proof = proof_fixture()
    proof.update(schema='tickets-parallel-candidate-retry/v3', original_attempt=1,
                 retry_browser='mobile-webkit')
    proof['artifact']['name'] = 'browser-build-456-1'
    proof['original_jobs'] = []
    for job in proof['jobs']:
        original = dict(job, id=job['id'] + 100, run_attempt=1,
                        conclusion='failure' if job['name'] in ('mobile-webkit', 'tickets-candidate-verified') else 'success')
        proof['original_jobs'].append(original)
    proof['aliases'] = [dict(name=j['name'], original_job_id=o['id'], alias_job_id=j['id'],
                             original_attempt=1, api_attempt=2)
                        for j,o in zip(proof['jobs'],proof['original_jobs'])
                        if j['name'] not in ('mobile-webkit', 'tickets-candidate-verified')]
    for receipt in proof['receipts']:
        if receipt['browser'] == 'mobile-webkit':
            receipt.update(schema='tickets-browser-build/v3', producer_attempt='1')
        else:
            receipt['run_attempt'] = '1'
    proof['metadata_sha256'] = dict.fromkeys(('original_run','original_jobs','run','jobs','all_jobs','artifact'), '6'*64)
    return proof


class RetryAdmissionTests(unittest.TestCase):
    def validate(self, proof):
        return release.validate_parallel_proof(proof, repository=REPOSITORY, candidate=CANDIDATE,
                                               tree=TREE, run_id='456', attempt=2, baseline=BASELINE)

    def test_explicit_retry_shape_and_old_v2_both_remain_valid(self):
        for proof in (proof_fixture(), retry_proof()):
            self.assertIs(self.validate(proof), proof)

    def test_all_retry_keys_and_exact_shapes_required(self):
        for key in retry_proof():
            proof=retry_proof(); del proof[key]
            with self.subTest(key=key),self.assertRaises(release.ReleaseError): self.validate(proof)
        proof=retry_proof();proof['unknown']=True
        with self.assertRaises(release.ReleaseError):self.validate(proof)
        for key in ('original_jobs','jobs','aliases','receipts'):
            for index in range(len(retry_proof()[key])):
                proof=retry_proof();proof[key][index]['unknown']=True
                with self.subTest(key=key,index=index),self.assertRaises(release.ReleaseError):self.validate(proof)

    def test_original_failure_history_and_alias_identity_cannot_be_rewritten(self):
        mutations=[lambda p:p.update(original_attempt=True), lambda p:p.update(run_attempt=3),
            lambda p:p.update(retry_browser='build'), lambda p:p['original_jobs'][3].update(conclusion='success'),
            lambda p:p['original_jobs'][0].update(run_attempt=2),lambda p:p['aliases'][0].update(original_attempt=True),
            lambda p:p['aliases'][0].update(original_job_id=p['jobs'][0]['id']),
            lambda p:p['jobs'][0].update(log_sha256='f'*64),lambda p:p['original_jobs'][1].update(steps_sha256='a'*64),
            lambda p:p['jobs'][4].update(id=p['original_jobs'][4]['id']), lambda p:p['aliases'].reverse(),
            lambda p:p['artifact'].update(name='browser-build-456-2')]
        for index, mutate in enumerate(mutations):
            proof=retry_proof(); mutate(proof)
            with self.subTest(index=index),self.assertRaises(release.ReleaseError):self.validate(proof)

    def test_receipts_keep_original_and_resumed_attempts_separate(self):
        for index in range(4):
            proof=retry_proof();proof['receipts'][index]['run_attempt']='1' if index==3 else '2'
            with self.subTest(index=index),self.assertRaises(release.ReleaseError):self.validate(proof)
        for key,value in [('producer_attempt','2'),('schema','tickets-browser-build/v2'),('source_sha','f'*40),('artifact_digest','0'*64)]:
            proof=retry_proof();proof['receipts'][3][key]=value
            with self.subTest(key=key),self.assertRaises(release.ReleaseError):self.validate(proof)

    def test_retry_mode_requires_actual_final_audit_before_writing_provenance(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            root=Path(tmp)
            runtime={'id':123,'run_attempt':1}; candidate={'id':456,'run_attempt':2,'head_sha':CANDIDATE}
            for name,value in [('runtime',runtime),('candidate',candidate),('runtime-jobs',[]),('candidate-jobs',[])]:
                (root/(name+'.json')).write_text(json.dumps(value))
            archive=root/'tickets-vps-runtime.tar.gz';archive.write_bytes(b'local transport fixture')
            (root/(archive.name+'.sha256')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name)
            args=argparse.Namespace(source=CANDIDATE,expected=BASELINE,metadata=tmp,candidate_mode='parallel-retry-v3',
                audit_directory=None,runtime_run='123',candidate_run='456',repository=REPOSITORY,archive=str(archive),output=str(root/'proof.json'))
            stack.enter_context(patch.dict(os.environ,{'GITHUB_REF':'refs/heads/main'}))
            stack.enter_context(patch.object(release,'git',side_effect=lambda *a: '' if a[0]=='status' else CANDIDATE if a==('rev-parse','HEAD') else TREE))
            stack.enter_context(patch.object(release.subprocess,'run'))
            for name in ('verify_trusted_operator','verify_run','verify_job_identity','verify_runtime_jobs','verify_parallel_run'):
                stack.enter_context(patch.object(release,name))
            stack.enter_context(patch.object(release,'vetted_changes',return_value=[]))
            stack.enter_context(patch.object(release,'verify_runtime_transport',return_value={}))
            collector=stack.enter_context(patch.object(release,'verify_parallel_candidate',return_value=retry_proof()))
            audit=stack.enter_context(patch.object(release,'verify_dependency_audit',return_value={'status':'clean'}))
            with self.assertRaisesRegex(release.ReleaseError,'final current dependency audit'):
                release.verify_ci(args)
            collector.assert_not_called();audit.assert_not_called();self.assertFalse(Path(args.output).exists())
            args.audit_directory=str(root/'audit')
            release.verify_ci(args)
            audit.assert_called_once_with(args.audit_directory,CANDIDATE)
            self.assertEqual(json.loads(Path(args.output).read_text())['dependencyAudit'],{'status':'clean'})

    def test_release_workflow_orders_single_final_audit_before_both_collections(self):
        path=Path(release.__file__).parents[2]/'.github/workflows/tickets-code-release.yml'
        blocks=re.split(r'(?m)(?=^      - name: )',path.read_text())[1:]
        names=[block.splitlines()[0].split('- name: ',1)[1] for block in blocks]
        audit_names=['Set up the shipping runtime version for final audit','Capture final dependency audit privately',
                     'Install the exact approved dependency lock for final audit','Verify installed dependencies against the final private audit']
        initial='Verify exact CI runs, source tree, ancestry and artifact provenance'
        final='Reconfirm exact CI attempts immediately before the host transaction'
        self.assertLess(names.index('Verify independently trusted operator before any host access'),names.index(audit_names[0]))
        for left,right in zip(audit_names,audit_names[1:]+[initial]):self.assertLess(names.index(left),names.index(right))
        self.assertLess(names.index(initial),names.index('Connect existing dedicated Tickets identity'))
        self.assertLess(names.index(final),names.index('Apply reversible Tickets-only code transaction'))
        for name in audit_names:self.assertEqual(names.count(name),1)
        for name in (initial,final):
            block=blocks[names.index(name)]
            self.assertIn('--audit-directory "$RUNNER_TEMP/tickets-final-audit"',block)
            self.assertIn('BECORE_PREINSTALL_RECEIPT_SHA256: ${{ steps.final_dependency_audit.outputs.audit_receipt_sha256 }}',block)

    def test_explicit_mode_selects_authenticated_retry_collector_only(self):
        proof=retry_proof(); calls=[]
        def collect(client,directory,**kwargs):
            calls.append((directory,kwargs));return proof
        modules={'runtime_release':types.SimpleNamespace(GitHub=lambda:object()),
                 'parallel_candidate_retry_control':types.SimpleNamespace(collect_or_verify=collect),
                 'parallel_candidate_retry':object()}
        candidate={'head_sha':CANDIDATE,'run_attempt':2}
        with tempfile.TemporaryDirectory() as tmp,patch.dict('os.environ',{'BECORE_TRUSTED_BASE':BASELINE}),patch.object(release,'authenticated_parallel_modules',return_value=modules) as loader:
            args=argparse.Namespace(source='a'*40,candidate_mode='parallel-retry-v3',output=tmp+'/proof',metadata=tmp,
                                    repository=REPOSITORY,candidate_run='456')
            self.assertEqual(release.verify_parallel_candidate(args,candidate,proof['jobs'],TREE),proof)
            loader.assert_called_once_with(args.source,retry=True)
            self.assertEqual(calls[0][0],Path(tmp)/'parallel-retry-evidence')
            self.assertIs(calls[0][1]['verifier'],modules['parallel_candidate_retry'])

    def test_actual_collector_verifier_output_binds_standalone_host_and_frozen_recheck(self):
        import test_parallel_candidate_retry_control as fixtures
        case=fixtures.CollectorTests()
        case.setUp()
        try:
            proof=case.collect();expected=case.data[-1]
            args=dict(repository=expected['repository'],candidate=expected['source_sha'],tree=expected['source_tree'],
                      run_id=str(expected['run_id']),attempt=2,baseline=expected['audit_trusted_base'])
            self.assertEqual(release.validate_parallel_proof(proof,**args),proof)
            self.assertEqual(case.collect(expected_proof=proof),proof)
            self.assertEqual(len(case.client.streams),10)
            changed=copy.deepcopy(proof);changed['aliases'][0]['original_job_id']=changed['jobs'][0]['id']
            with self.assertRaises(release.ReleaseError):release.validate_parallel_proof(changed,**args)
            case.client.advance_at=case.client.latest_calls+1
            with self.assertRaises(fixtures.control.CollectionError):case.collect(expected_proof=proof)
            self.assertEqual(len(case.client.streams),10)
        finally:case.doCleanups()

    def test_real_git_source_binding_requires_each_retry_helper_match_baseline(self):
        import parallel_candidate_retry_control as control
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            def git(*args):
                return subprocess.check_output(['git','--no-replace-objects','-C',tmp,*args],env=release.git_environment(),stderr=subprocess.DEVNULL).decode().strip()
            git('init','-q');git('config','user.name','Local test');git('config','user.email','tests@example.invalid')
            paths=set(control.base.CONTROL_PATHS)|set(control.RETRY_CONTROLS)
            for name in paths:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('reviewed '+name+'\n');path.chmod(0o644)
            git('add','.');git('commit','-qm','trusted controls');baseline=git('rev-parse','HEAD')
            (root/'README.md').write_text('candidate\n');git('add','.');git('commit','-qm','candidate');source=git('rev-parse','HEAD')
            git('update-ref','refs/remotes/origin/main',source)
            identity,_=control.authenticate_source(root,source=source,candidate=source,trusted_baseline=baseline)
            self.assertTrue(set(control.RETRY_CONTROLS)<=set(identity['controls']))
            for name in control.RETRY_CONTROLS:
                git('reset','--hard',source);(root/name).write_text('unreviewed helper\n')
                git('add',name);git('commit','-qm','mutated helper');changed=git('rev-parse','HEAD')
                git('update-ref','refs/remotes/origin/main',changed)
                with self.subTest(name=name),self.assertRaises(control.CollectionError):
                    control.authenticate_source(root,source=changed,candidate=changed,trusted_baseline=baseline)

    def test_parser_keeps_legacy_default_and_explicit_retry(self):
        required=['code-release.py','verify-ci','--source','a'*40,'--expected','b'*40,'--repository',REPOSITORY,
                  '--runtime-run','123','--candidate-run','456','--metadata','meta','--archive','archive','--output','out']
        for extra, expected in (([], 'legacy'), (['--candidate-mode','parallel-retry-v3'], 'parallel-retry-v3')):
            with patch.object(sys,'argv',required+extra),patch.object(release,'verify_ci') as verify:
                self.assertEqual(release.main(),0)
                self.assertEqual(verify.call_args.args[0].candidate_mode,expected)



class RetryTrustedModuleTests(unittest.TestCase):
    git=admission_fixtures.TrustedModuleTests.git
    commit=admission_fixtures.TrustedModuleTests.commit

    def setUp(self):
        # Reuse only the local Git fixture builder, not its v2 test assumptions.
        with patch.object(release,'PARALLEL_MODULES',release.RETRY_PARALLEL_MODULES):
            admission_fixtures.TrustedModuleTests.setUp(self)

    def test_new_retry_modules_ignore_same_path_forged_imports_and_valid_pyc(self):
        forged={}
        for name in release.RETRY_PARALLEL_MODULES:
            path=self.directory/(name+'.py')
            module=types.ModuleType(name);module.__file__=str(path);module.VALUE='forged';forged[name]=module
            cache=Path(importlib.util.cache_from_source(str(path)));cache.parent.mkdir(exist_ok=True)
            malicious=compile("raise RuntimeError('forged cache executed')",str(path),'exec')
            header=importlib.util.MAGIC_NUMBER+struct.pack('<III',0,int(path.stat().st_mtime),len(self.sources[name]))
            cache.write_bytes(header+marshal.dumps(malicious))
        with patch.dict(sys.modules,forged):
            modules=release.authenticated_parallel_modules(self.source,retry=True)
            self.assertEqual(set(modules),set(release.RETRY_PARALLEL_MODULES))
            for name in modules:self.assertEqual(modules[name].VALUE,name);self.assertIsNot(modules[name],forged[name])

    def test_either_new_retry_module_tamper_rejects_before_any_execution(self):
        for name in ('parallel_candidate_retry','parallel_candidate_retry_control'):
            path=self.directory/(name+'.py');path.write_text('malicious=True\n')
            with self.subTest(name=name),self.assertRaisesRegex(release.ReleaseError,'bytes differ'):
                release.authenticated_parallel_modules(self.source,retry=True)
            path.write_bytes(self.sources[name])

    def test_old_loader_does_not_require_new_retry_files(self):
        for name in ('parallel_candidate_retry','parallel_candidate_retry_control'):
            (self.directory/(name+'.py')).unlink()
        self.assertEqual(set(release.authenticated_parallel_modules(self.source)),set(release.PARALLEL_MODULES))


if __name__=='__main__': unittest.main()
