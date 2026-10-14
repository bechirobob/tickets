"""Local-only admission regression tests; no network, provider or host access."""
import argparse
import copy
import importlib.util
import json
import marshal
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('parallel_code_release', Path(__file__).with_name('code-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE, CANDIDATE, BASELINE, TREE = ('a' * 40, 'b' * 40, 'c' * 40, 'd' * 40)
REPOSITORY = 'bechirobob/tickets'
BRANCH = 'improve/release-evidence-parallel-20261013'
BROWSERS = ('desktop-chromium', 'mobile-chromium', 'mobile-webkit')


def proof_fixture():
    artifact = {'id': 1234, 'name': 'browser-build-456-2', 'size_in_bytes': 100,
                'digest': '1' * 64, 'archive_sha256': '2' * 64, 'manifest_sha256': '3' * 64,
                'created_at': '2026-10-14T07:00:00Z', 'expires_at': '2026-10-15T07:00:00Z'}
    receipts = [{'schema': 'tickets-browser-build/v2', 'kind': 'producer' if browser is None else 'consumer',
                 'browser': browser, 'repository': REPOSITORY, 'source_sha': CANDIDATE, 'source_tree': TREE,
                 'workflow_sha': CANDIDATE, 'audit_trusted_base': BASELINE, 'run_id': '456', 'run_attempt': '2',
                 'artifact_id': '1234', 'artifact_digest': artifact['digest'],
                 'archive_sha256': artifact['archive_sha256'], 'manifest_sha256': artifact['manifest_sha256']}
                for browser in (None, *BROWSERS)]
    return {'schema': 'tickets-parallel-candidate/v2', 'repository': REPOSITORY, 'source_sha': CANDIDATE,
            'source_tree': TREE, 'workflow': '.github/workflows/candidate-parallel-checks.yml',
            'workflow_sha': CANDIDATE, 'workflow_blob': 'e' * 40, 'audit_trusted_base': BASELINE,
            'run_id': 456, 'run_attempt': 2, 'event': 'push', 'head_branch': BRANCH,
            'artifact': artifact, 'receipts': receipts,
            'jobs': [{'id': index + 100, 'name': name, 'log_sha256': '4' * 64, 'steps_sha256': '5' * 64}
                     for index, name in enumerate(('build', *BROWSERS, 'verify'))],
            'metadata_sha256': dict.fromkeys(('run', 'jobs', 'artifact'), '6' * 64)}


class ParallelProofTests(unittest.TestCase):
    def validate(self, value):
        return release.validate_parallel_proof(value, repository=REPOSITORY, candidate=CANDIDATE,
                                               tree=TREE, run_id='456', attempt=2, baseline=BASELINE)

    def test_complete_v2_proof_is_bound_without_changing_legacy_outer_version(self):
        proof = proof_fixture()
        self.assertIs(self.validate(proof), proof)

    def test_every_root_field_is_mandatory_and_unknown_fields_reject(self):
        for name in proof_fixture():
            value = proof_fixture()
            del value[name]
            with self.subTest(name=name), self.assertRaises(release.ReleaseError):
                self.validate(value)
        with self.assertRaises(release.ReleaseError):
            self.validate(dict(proof_fixture(), extra=True))

    def test_identity_schema_wrong_types_and_cross_attempt_reject(self):
        for key, value in (('schema', 'tickets-parallel-candidate/v1'), ('repository', 'fork/tickets'),
                           ('source_sha', SOURCE), ('source_tree', SOURCE), ('workflow_sha', SOURCE),
                           ('workflow_blob', ''), ('audit_trusted_base', CANDIDATE), ('run_id', True),
                           ('run_id', '456'), ('run_attempt', True), ('run_attempt', 3),
                           ('event', 'pull_request'), ('head_branch', 'main')):
            with self.subTest(key=key, value=value), self.assertRaises(release.ReleaseError):
                self.validate(dict(proof_fixture(), **{key: value}))

    def test_artifact_fields_bounds_digests_and_timestamps_reject(self):
        for key, value in (('id', True), ('id', 0), ('size_in_bytes', True), ('size_in_bytes', 0),
                           ('size_in_bytes', 272 * 1024**2 + 1), ('name', 'browser-build-456-1'),
                           ('digest', 'sha256:' + '1' * 64), ('archive_sha256', 'bad'),
                           ('manifest_sha256', None), ('created_at', '2026-99-99T00:00:00Z'),
                           ('expires_at', '2026-10-13T00:00:00Z')):
            proof = proof_fixture(); proof['artifact'][key] = value
            with self.subTest(key=key), self.assertRaises(release.ReleaseError): self.validate(proof)
        for name in proof_fixture()['artifact']:
            proof = proof_fixture(); del proof['artifact'][name]
            with self.subTest(missing=name), self.assertRaises(release.ReleaseError): self.validate(proof)

    def test_complete_numeric_distinct_job_inventory_and_digests_required(self):
        variants = []
        for value in (True, 0, '100', 10**20):
            proof = proof_fixture(); proof['jobs'][0]['id'] = value; variants.append(proof)
        for mutation in ('missing', 'extra', 'duplicate', 'name', 'digest', 'unknown'):
            proof = proof_fixture()
            if mutation == 'missing': proof['jobs'].pop()
            elif mutation == 'extra': proof['jobs'].append(copy.deepcopy(proof['jobs'][0]))
            elif mutation == 'duplicate': proof['jobs'][1]['id'] = proof['jobs'][0]['id']
            elif mutation == 'name': proof['jobs'][0]['name'] = 'verify'
            elif mutation == 'digest': proof['jobs'][0]['log_sha256'] = 'bad'
            else: proof['jobs'][0]['unknown'] = 1
            variants.append(proof)
        for index, proof in enumerate(variants):
            with self.subTest(index=index), self.assertRaises(release.ReleaseError): self.validate(proof)

    def test_every_receipt_field_binds_all_four_lanes_to_one_build(self):
        for index in range(4):
            for name in proof_fixture()['receipts'][index]:
                proof = proof_fixture(); proof['receipts'][index][name] = 'changed'
                with self.subTest(lane=index, field=name), self.assertRaises(release.ReleaseError): self.validate(proof)
        for container in ('receipts', 'metadata_sha256'):
            proof = proof_fixture(); proof[container] = []
            with self.subTest(container=container), self.assertRaises(release.ReleaseError): self.validate(proof)

    def test_host_preflight_checks_optional_proof_before_any_host_audit(self):
        # Exercise the real preflight order on a minimal filesystem fixture.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('home', 'releases', 'journal', 'override'): (root / name).mkdir()
            deployment = object.__new__(release.Deployment)
            deployment.home = root / 'home'; deployment.releases = root / 'releases'
            deployment.journal = root / 'journal' / 'record'; deployment.override = root / 'override' / 'unit'
            deployment.release = root / 'releases' / SOURCE; deployment.snapshot = root / 'snapshot'
            deployment.recover_prepared = ''; deployment.source = SOURCE; deployment.expected = BASELINE
            deployment.archive = root / 'archive'; deployment.provenance = root / 'proof'
            deployment.archive.write_bytes(b'archive'); deployment.archive_digest = release.digest_file(deployment.archive)
            outer = {'version': 1, 'source': SOURCE, 'expectedActive': BASELINE,
                     'archiveSha256': deployment.archive_digest, 'ancestryVerified': True,
                     'sourceTree': TREE, 'candidateTree': TREE, 'candidateSha': CANDIDATE,
                     'repository': REPOSITORY, 'candidateRun': '456', 'candidateAttempt': 2,
                     'candidateVerification': dict(proof_fixture(), schema='v1')}
            deployment.provenance.write_text(json.dumps(outer)); deployment.provenance_digest = release.digest_file(deployment.provenance)
            with patch.object(deployment, 'file', side_effect=lambda path: Path(path).read_bytes()), \
                 patch.object(deployment, 'verify_dependency_audit') as audit:
                with self.assertRaisesRegex(release.ReleaseError, 'Version 2'): deployment.preflight()
                audit.assert_not_called()


class TrustedModuleTests(unittest.TestCase):
    def setUp(self):
        modules = patch.dict(sys.modules, {}); modules.start(); self.addCleanup(modules.stop)
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.old = Path.cwd(); os.chdir(self.root); self.addCleanup(os.chdir, self.old)
        self.git('init', '-q'); self.git('config', 'user.name', 'Local tests'); self.git('config', 'user.email', 'tests@example.invalid')
        self.directory = self.root / 'ops/vps'; self.directory.mkdir(parents=True)
        self.operator = self.directory / 'code-release.py'; self.operator.write_text('# trusted control\n')
        self.sources = {}
        for index, name in enumerate(release.PARALLEL_MODULES):
            body = "VALUE = " + repr(name) + '\n'
            if index: body += 'import ' + release.PARALLEL_MODULES[index-1] + '\n'
            self.sources[name] = body.encode(); (self.directory / (name + '.py')).write_bytes(body.encode())
        self.baseline = self.commit(); (self.root / 'candidate').write_text('candidate\n'); self.source = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.source)
        for item in (patch.object(release, '__file__', str(self.operator)),
                     patch.dict(os.environ, BECORE_TRUSTED_BASE=self.baseline)):
            item.start(); self.addCleanup(item.stop)

    def git(self, *args):
        return subprocess.check_output(['git', '--no-replace-objects', *args], stderr=subprocess.DEVNULL,
                                       env=release.git_environment()).decode().strip()

    def commit(self):
        self.git('add', '-A'); self.git('commit', '-qm', 'isolated fixture'); return self.git('rev-parse', 'HEAD')

    def test_fresh_modules_ignore_same_path_sys_modules_forgeries(self):
        forged = {}
        for name in release.PARALLEL_MODULES:
            module = types.ModuleType(name); module.__file__ = str(self.directory / (name + '.py')); module.VALUE = 'forged'
            forged[name] = module
        with patch.dict(sys.modules, forged):
            modules = release.authenticated_parallel_modules(self.source)
            for index, name in enumerate(release.PARALLEL_MODULES):
                self.assertIsNot(modules[name], forged[name]); self.assertEqual(modules[name].VALUE, name)
                if index: self.assertIs(getattr(modules[name], release.PARALLEL_MODULES[index-1]), modules[release.PARALLEL_MODULES[index-1]])
            self.assertTrue(all(sys.modules[name] is modules[name] for name in forged))

    def test_valid_timestamp_malicious_pyc_is_never_executed(self):
        for name in release.PARALLEL_MODULES:
            source = self.directory / (name + '.py'); cache = Path(importlib.util.cache_from_source(str(source)))
            cache.parent.mkdir(exist_ok=True)
            malicious = compile("raise RuntimeError('malicious valid timestamp bytecode executed')", str(source), 'exec')
            header = importlib.util.MAGIC_NUMBER + struct.pack('<III', 0, int(source.stat().st_mtime), len(self.sources[name]))
            cache.write_bytes(header + marshal.dumps(malicious))
        modules = release.authenticated_parallel_modules(self.source)
        self.assertEqual(modules['parallel_candidate_control'].VALUE, 'parallel_candidate_control')

    def test_all_modules_authenticated_before_any_source_executes(self):
        first = self.directory / (release.PARALLEL_MODULES[0] + '.py')
        first.write_text("raise RuntimeError('execution before authentication')\n")
        self.baseline = self.commit(); self.git('update-ref', 'refs/remotes/origin/main', self.baseline)
        (self.root / 'candidate').write_text('second candidate\n'); self.source = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.source)
        (self.directory / (release.PARALLEL_MODULES[-1] + '.py')).write_text('unauthenticated = True\n')
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.baseline), self.assertRaisesRegex(release.ReleaseError, 'bytes differ'):
            release.authenticated_parallel_modules(self.source)

    def test_module_bytes_executable_modes_symlinks_and_missing_files_reject(self):
        path = self.directory / 'candidate_build.py'
        for mutation in ('bytes', 'mode', 'symlink', 'missing'):
            path.write_bytes(self.sources['candidate_build']); path.chmod(0o644)
            if mutation == 'bytes': path.write_text('malicious = True\n')
            elif mutation == 'mode': path.chmod(0o755)
            elif mutation == 'symlink': path.unlink(); path.symlink_to('runtime_release.py')
            else: path.unlink()
            with self.subTest(mutation=mutation), self.assertRaises((release.ReleaseError, OSError)):
                release.authenticated_parallel_modules(self.source)
            if path.is_symlink(): path.unlink()


    def test_parallel_collection_then_shared_transport_rejects_forged_cached_success(self):
        self.sources['runtime_release'] = ("class GitHub: pass\n"
            "def verify_local_receipt(*args, **kwargs):\n"
            "    raise ValueError('genuine authenticated transport rejected invalid archive')\n").encode()
        body = "import subprocess\ndef collect_or_verify(client, directory, **kwargs):\n"
        body += '    proof = ' + repr(proof_fixture()) + '\n'
        body += "    proof.update(source_sha=kwargs['candidate'], workflow_sha=kwargs['candidate'], audit_trusted_base=kwargs['trusted_baseline'])\n"
        body += "    proof['source_tree'] = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}']).decode().strip()\n"
        body += "    for receipt in proof['receipts']:\n        receipt.update(source_sha=proof['source_sha'], workflow_sha=proof['workflow_sha'], source_tree=proof['source_tree'], audit_trusted_base=proof['audit_trusted_base'])\n"
        body += '    return proof\n'
        self.sources['parallel_candidate_control'] = body.encode()
        for name, raw in self.sources.items(): (self.directory / (name + '.py')).write_bytes(raw)
        trusted = self.commit(); (self.root / 'candidate').write_text('promoted candidate\n'); source = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', source)
        forged = types.ModuleType('runtime_release'); forged.__file__ = str(self.directory / 'runtime_release.py')
        forged.verify_local_receipt = lambda *args, **kwargs: {'forged': True}
        run, jobs = ParallelSelectionTests().fixture(); run['head_sha'] = source
        for job in jobs: job['head_sha'] = source
        runtime = dict(run, id=123, run_attempt=1, head_branch='main', path='.github/workflows/vps-runtime.yml')
        runtime_jobs = [{'id': index + 10, 'name': name, 'run_id': 123, 'run_attempt': 1, 'head_sha': source,
            'status': 'completed', 'conclusion': 'success',
            'steps': [{'name': step, 'status': 'completed', 'conclusion': 'success'} for step in steps]}
            for index, (name, steps) in enumerate((('verify', release.RUNTIME_VERIFY_STEPS), ('handoff', release.RUNTIME_HANDOFF_STEPS)))]
        with tempfile.TemporaryDirectory() as temporary:
            metadata = Path(temporary)
            for name, value in (('runtime', runtime), ('candidate', run), ('runtime-jobs', runtime_jobs), ('candidate-jobs', jobs)):
                (metadata / (name + '.json')).write_text(json.dumps(value))
            archive = metadata / 'tickets-vps-runtime.tar.gz'; archive.write_bytes(b'invalid transport archive')
            (metadata / (archive.name + '.sha256')).write_text(release.digest_file(archive) + '  tickets-vps-runtime.tar.gz\n')
            args = argparse.Namespace(source=source, expected=self.baseline, candidate_mode='parallel-v1',
                runtime_run='123', candidate_run='456', repository=REPOSITORY, metadata=str(metadata),
                archive=str(archive), output=str(metadata / 'proof.json'))
            with patch.dict(sys.modules, runtime_release=forged), \
                 patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted, GITHUB_REF='refs/heads/main'), \
                 patch.object(release, 'vetted_changes', return_value=[]):
                with self.assertRaisesRegex(release.ReleaseError, 'Runtime release transport evidence mismatch'):
                    release.verify_ci(args)
                self.assertIsNot(sys.modules['runtime_release'], forged)
                self.assertFalse(Path(args.output).exists())

    def test_authentication_or_compile_failure_preserves_original_module_cache(self):
        originals = {name: types.ModuleType(name) for name in release.PARALLEL_MODULES}
        with patch.dict(sys.modules, originals):
            path = self.directory / 'parallel_candidate_control.py'; original = path.read_bytes()
            path.write_bytes(b'changed source\n')
            with self.assertRaises(release.ReleaseError): release.authenticated_parallel_modules(self.source)
            self.assertTrue(all(sys.modules[name] is value for name, value in originals.items()))
            path.write_bytes(b'def invalid syntax\n'); trusted = self.commit()
            (self.root / 'candidate').write_text('new child\n'); source = self.commit()
            self.git('update-ref', 'refs/remotes/origin/main', source)
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=trusted), self.assertRaises(SyntaxError):
                release.authenticated_parallel_modules(source)
            self.assertTrue(all(sys.modules[name] is value for name, value in originals.items()))


class ParallelSelectionTests(unittest.TestCase):
    def fixture(self):
        run = {'id': 456, 'run_attempt': 2, 'status': 'completed', 'conclusion': 'success', 'head_sha': CANDIDATE,
               'path': '.github/workflows/candidate-parallel-checks.yml', 'head_branch': BRANCH, 'event': 'push',
               'repository': {'full_name': REPOSITORY}, 'head_repository': {'full_name': REPOSITORY}}
        jobs = [{'id': index + 100, 'name': name, 'run_id': 456, 'head_sha': CANDIDATE,
                 'status': 'completed', 'conclusion': 'success'} for index, name in enumerate(('build', *BROWSERS, 'verify'))]
        return run, jobs

    def test_exact_parallel_jobs_allow_absent_attempt_only_with_later_authentication(self):
        run, jobs = self.fixture(); release.verify_parallel_run(run, jobs, repository=REPOSITORY)
        for job in jobs: job['run_attempt'] = 2
        release.verify_parallel_run(run, jobs, repository=REPOSITORY)
        for key, value in (('run_attempt', 1), ('run_attempt', True), ('id', True), ('run_id', True),
                           ('head_sha', SOURCE), ('conclusion', 'skipped'), ('name', 'other')):
            changed = copy.deepcopy(jobs); changed[0][key] = value
            with self.subTest(key=key), self.assertRaises(release.ReleaseError):
                release.verify_parallel_run(run, changed, repository=REPOSITORY)

    def test_parallel_branch_does_not_change_legacy_admission(self):
        run, jobs = self.fixture()
        with self.assertRaises(release.ReleaseError):
            release.verify_run(run, workflow='candidate-checks.yml', repository=REPOSITORY)
        for key, value in (('path', '.github/workflows/candidate-checks.yml'), ('event', 'pull_request'),
                           ('head_branch', 'main'), ('head_repository', {'full_name': 'fork/tickets'})):
            with self.subTest(key=key), self.assertRaises(release.ReleaseError):
                release.verify_parallel_run(dict(run, **{key: value}), jobs, repository=REPOSITORY)

    def test_collector_is_bound_to_original_proof_and_selected_numeric_jobs(self):
        run, jobs = self.fixture()
        with tempfile.TemporaryDirectory() as temporary:
            args = argparse.Namespace(source=SOURCE, candidate_run='456', repository=REPOSITORY,
                                      metadata=temporary, output=str(Path(temporary) / 'provenance.json'))
            from unittest.mock import Mock
            collector = Mock(); collector.collect_or_verify.return_value = proof_fixture()
            transport = Mock(); offline = object()
            modules = {'runtime_release': transport, 'parallel_candidate_control': collector, 'parallel_candidate': offline}
            with patch.object(release, 'authenticated_parallel_modules', return_value=modules), \
                 patch.dict(os.environ, BECORE_TRUSTED_BASE=BASELINE):
                self.assertEqual(release.verify_parallel_candidate(args, run, jobs, TREE), proof_fixture())
                self.assertIsNone(collector.collect_or_verify.call_args.kwargs['expected_proof'])
                Path(args.output).write_text(json.dumps({'candidateVerification': proof_fixture()}))
                release.verify_parallel_candidate(args, run, jobs, TREE)
                self.assertEqual(collector.collect_or_verify.call_args.kwargs['expected_proof'], proof_fixture())
                collector.collect_or_verify.return_value = dict(proof_fixture(), run_attempt=3)
                with self.assertRaises(release.ReleaseError): release.verify_parallel_candidate(args, run, jobs, TREE)
                collector.collect_or_verify.return_value = proof_fixture(); jobs[0]['id'] = 999
                with self.assertRaisesRegex(release.ReleaseError, 'job IDs'): release.verify_parallel_candidate(args, run, jobs, TREE)
                jobs[0]['id'] = 101; jobs[1]['id'] = 100
                with self.assertRaisesRegex(release.ReleaseError, 'job IDs'): release.verify_parallel_candidate(args, run, jobs, TREE)


class ParallelSourceAdmissionTests(unittest.TestCase):
    """Real isolated Git B/C/P objects exercise the production finite gate."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); previous = Path.cwd(); os.chdir(self.root); self.addCleanup(os.chdir, previous)
        self.git('init', '-q'); self.git('config', 'user.name', 'Local tests'); self.git('config', 'user.email', 'tests@example.invalid')
        for name in ('README.md', 'app/page.tsx', 'package.json', 'package-lock.json', 'drizzle/0001.sql',
                     *release.PARALLEL_CONTROL_FILES): self.write(name, 'baseline ' + name + '\n')
        self.base = self.commit(); tree = self.git('rev-parse', self.base + '^{tree}')
        outputs = {name: 'reviewed output ' + name + '\n' for name in release.PARALLEL_OUTPUT_BLOBS}
        for name, raw in outputs.items():
            if name != release.PARALLEL_PROMOTION_FILE: self.write(name, raw)
        for name in release.PARALLEL_CONTROL_FILES: self.write(name, 'reviewed control ' + name + '\n')
        self.control = self.commit()
        self.write(release.PARALLEL_PROMOTION_FILE, outputs[release.PARALLEL_PROMOTION_FILE]); self.source = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', self.source)
        self.pins = {name: self.git('rev-parse', self.source + ':' + name) for name in outputs}
        for item in (patch.object(release, 'PARALLEL_RELEASE_BASELINE', self.base),
                     patch.object(release, 'PARALLEL_RELEASE_BASE_TREE', tree),
                     patch.object(release, 'PARALLEL_OUTPUT_BLOBS', self.pins),
                     patch.object(release, '__file__', str(self.root / 'ops/vps/code-release.py')),
                     patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control)):
            item.start(); self.addCleanup(item.stop)

    def git(self, *args):
        return subprocess.check_output(['git', '--no-replace-objects', *args], stderr=subprocess.DEVNULL,
                                       env=release.git_environment()).decode().strip()

    def write(self, name, content):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(content); return path

    def commit(self):
        self.git('add', '-A'); self.git('commit', '-qm', 'isolated rollout'); return self.git('rev-parse', 'HEAD')

    def test_complete_14_control_1_promotion_15_total_admits_without_migrations(self):
        changes = release.vetted_changes(self.base, self.source)
        self.assertEqual(set(changes), set(self.pins) | release.PARALLEL_CONTROL_FILES)
        self.assertEqual(len(changes), 15); self.assertEqual(release.migration_plan(changes), [])

    def test_application_dependency_migration_docs_and_extra_test_changes_reject(self):
        for name in ('app/page.tsx', 'package.json', 'package-lock.json', 'drizzle/0002.sql',
                     'docs/unreviewed.md', 'tests/unreviewed.py'):
            self.git('reset', '--hard', self.source); self.git('clean', '-fdq')
            self.write(name, 'unapproved change\n'); source = self.commit()
            self.git('update-ref', 'refs/remotes/origin/main', source)
            with self.subTest(name=name), self.assertRaisesRegex(release.ReleaseError, 'promotion'):
                release.vetted_changes(self.base, source)

    def test_every_reviewed_output_and_control_mutation_rejects(self):
        for name in (*self.pins, *release.PARALLEL_CONTROL_FILES):
            self.git('reset', '--hard', self.source)
            self.write(name, 'unreviewed\n'); source = self.commit()
            self.git('update-ref', 'refs/remotes/origin/main', source)
            with self.subTest(name=name), self.assertRaises(release.ReleaseError):
                release.vetted_changes(self.base, source)

    def test_promoted_reserved_test_is_required_and_cannot_ship_in_control(self):
        with self.assertRaises(release.ReleaseError): release.vetted_changes(self.base, self.control)
        (self.root / 'README.md').write_text('descendant\n'); later = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', later)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.source), self.assertRaisesRegex(release.ReleaseError, '14-path'):
            release.reviewed_parallel_application_blobs(self.base, later)

    def test_baseline_tree_independence_and_merged_ancestry_required(self):
        with patch.object(release, 'PARALLEL_RELEASE_BASE_TREE', 'f' * 40), self.assertRaisesRegex(release.ReleaseError, 'baseline'):
            release.vetted_changes(self.base, self.source)
        for baseline in (self.base, self.source):
            with patch.dict(os.environ, BECORE_TRUSTED_BASE=baseline), self.assertRaisesRegex(release.ReleaseError, 'independent'):
                release.vetted_changes(self.base, self.source)
        self.git('update-ref', 'refs/remotes/origin/main', self.base)
        with self.assertRaises(subprocess.CalledProcessError): release.vetted_changes(self.base, self.source)

    def test_controls_must_be_ancestor_of_source_even_when_independently_merged(self):
        operator = (self.root / 'ops/vps/code-release.py').read_bytes()
        self.git('reset', '--hard', self.base)
        (self.root / 'ops/vps/code-release.py').write_bytes(operator)
        unrelated_source = self.commit()
        # C is still on origin/main, but the separate source branch did not inherit C.
        with self.assertRaises(subprocess.CalledProcessError):
            release.reviewed_parallel_application_blobs(self.base, unrelated_source)

    def test_partial_control_or_mode_changes_cannot_be_admitted(self):
        self.git('reset', '--hard', self.control)
        removed = next(name for name in self.pins if name != release.PARALLEL_PROMOTION_FILE)
        (self.root / removed).unlink(); wrong_control = self.commit()
        self.write(release.PARALLEL_PROMOTION_FILE, 'reviewed output ' + release.PARALLEL_PROMOTION_FILE + '\n')
        source = self.commit(); self.git('update-ref', 'refs/remotes/origin/main', source)
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=wrong_control), self.assertRaisesRegex(release.ReleaseError, '14-path'):
            release.reviewed_parallel_application_blobs(self.base, source)
        self.git('reset', '--hard', self.source)
        (self.root / release.PARALLEL_PROMOTION_FILE).chmod(0o755); source = self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', source)
        with self.assertRaisesRegex(release.ReleaseError, 'New executable'):
            release.vetted_changes(self.base, source)


class ParallelCiPipelineTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.candidate, self.jobs = ParallelSelectionTests().fixture()
        self.runtime = dict(self.candidate, id=123, run_attempt=1, head_sha=SOURCE, head_branch='main',
                            path='.github/workflows/vps-runtime.yml')
        self.runtime_jobs = []
        for index, (name, steps) in enumerate((('verify', release.RUNTIME_VERIFY_STEPS), ('handoff', release.RUNTIME_HANDOFF_STEPS))):
            self.runtime_jobs.append({'id': 10 + index, 'name': name, 'run_id': 123, 'run_attempt': 1,
                'head_sha': SOURCE, 'status': 'completed', 'conclusion': 'success',
                'steps': [{'name': step, 'status': 'completed', 'conclusion': 'success'} for step in steps]})
        for name, value in (('runtime', self.runtime), ('candidate', self.candidate),
                            ('runtime-jobs', self.runtime_jobs), ('candidate-jobs', self.jobs)):
            (self.root / (name + '.json')).write_text(json.dumps(value))
        self.archive = self.root / 'tickets-vps-runtime.tar.gz'; self.archive.write_bytes(b'runtime fixture')
        self.checksum = self.root / (self.archive.name + '.sha256')
        self.checksum.write_text(release.digest_file(self.archive) + '  tickets-vps-runtime.tar.gz\n')
        self.args = argparse.Namespace(source=SOURCE, expected=BASELINE, repository=REPOSITORY, metadata=str(self.root),
            runtime_run='123', candidate_run='456', archive=str(self.archive), output=str(self.root / 'proof.json'),
            candidate_mode='parallel-v1')
        for item in (patch.dict(os.environ, GITHUB_REF='refs/heads/main'),
                     patch.object(release, 'verify_trusted_operator'), patch.object(release.subprocess, 'run'),
                     patch.object(release, 'git', side_effect=[SOURCE, '', TREE, TREE]),
                     patch.object(release, 'vetted_changes', return_value=['ops/vps/test_parallel_source_family.py']),
                     patch.object(release, 'verify_runtime_transport', return_value={'verified': True}),
                     patch.object(release, 'verify_parallel_candidate', return_value=proof_fixture())):
            mocked = item.start(); self.addCleanup(item.stop)
        self.collector = release.verify_parallel_candidate

    def test_parallel_admission_keeps_runtime_transport_ancestry_changes_and_outer_version(self):
        release.verify_ci(self.args)
        proof = json.loads(Path(self.args.output).read_text())
        self.assertEqual(proof['version'], 1)
        self.assertEqual(proof['candidateVerification'], proof_fixture())
        self.assertEqual(proof['sourceTree'], proof['candidateTree'])
        self.assertEqual(proof['changedFiles'], ['ops/vps/test_parallel_source_family.py'])
        self.assertEqual(proof['migrations'], [])
        release.verify_runtime_transport.assert_called_once_with(self.archive, SOURCE, TREE, self.runtime)
        release.vetted_changes.assert_called_once_with(BASELINE, SOURCE)
        self.collector.assert_called_once_with(self.args, self.candidate, self.jobs, TREE)

    def test_tree_mismatch_rejects_before_any_collector(self):
        release.git.side_effect = [SOURCE, '', TREE, 'f' * 40]
        with self.assertRaisesRegex(release.ReleaseError, 'tree differs'): release.verify_ci(self.args)
        self.collector.assert_not_called(); release.vetted_changes.assert_not_called()

    def test_unvetted_changes_reject_before_collector(self):
        release.vetted_changes.side_effect = release.ReleaseError('Unvetted source')
        with self.assertRaisesRegex(release.ReleaseError, 'Unvetted'): release.verify_ci(self.args)
        self.collector.assert_not_called()

    def test_runtime_gate_and_candidate_numeric_identity_precede_collector(self):
        for mutation in ('runtime', 'candidate'):
            release.git.side_effect = [SOURCE, '', TREE, TREE]
            if mutation == 'runtime':
                value = copy.deepcopy(self.runtime_jobs); value[0]['steps'].pop()
                (self.root / 'runtime-jobs.json').write_text(json.dumps(value))
            else:
                (self.root / 'runtime-jobs.json').write_text(json.dumps(self.runtime_jobs))
                value = copy.deepcopy(self.jobs); value[0]['id'] = True
                (self.root / 'candidate-jobs.json').write_text(json.dumps(value))
            with self.subTest(mutation=mutation), self.assertRaises(release.ReleaseError): release.verify_ci(self.args)
            self.collector.assert_not_called()

    def test_archive_and_runtime_transport_failure_still_block_parallel(self):
        self.checksum.write_text('f' * 64 + '  tickets-vps-runtime.tar.gz\n')
        with self.assertRaisesRegex(release.ReleaseError, 'checksum'): release.verify_ci(self.args)
        self.assertFalse(Path(self.args.output).exists())
        self.checksum.write_text(release.digest_file(self.archive) + '  tickets-vps-runtime.tar.gz\n')
        release.git.side_effect = [SOURCE, '', TREE, TREE]
        release.verify_runtime_transport.side_effect = release.ReleaseError('runtime transport rejected')
        with self.assertRaisesRegex(release.ReleaseError, 'runtime transport rejected'): release.verify_ci(self.args)
        self.assertFalse(Path(self.args.output).exists())

    def test_shared_dependency_audit_remains_required_when_supplied(self):
        self.args.audit_directory = 'private-audit'
        with patch.object(release, 'verify_dependency_audit', side_effect=release.ReleaseError('audit rejected')) as audit:
            with self.assertRaisesRegex(release.ReleaseError, 'audit rejected'): release.verify_ci(self.args)
            audit.assert_called_once_with('private-audit', SOURCE)
        self.assertFalse(Path(self.args.output).exists())

    def test_invalid_or_default_legacy_mode_never_calls_parallel_collector(self):
        for mode in ('invalid', None):
            release.git.side_effect = [SOURCE, '', TREE, TREE]
            if mode is None: del self.args.candidate_mode
            else: self.args.candidate_mode = mode
            with self.subTest(mode=mode), self.assertRaises(release.ReleaseError): release.verify_ci(self.args)
            self.collector.assert_not_called()

    def test_cli_default_is_legacy_and_parallel_is_explicit(self):
        args = ['code-release.py', 'verify-ci']
        for name in ('source', 'expected', 'repository', 'metadata', 'runtime-run', 'candidate-run', 'archive', 'output'):
            args += ['--' + name, 'fixture']
        for extra, expected in (([], 'legacy'), (['--candidate-mode', 'parallel-v1'], 'parallel-v1')):
            with patch.object(sys, 'argv', args + extra), patch.object(release, 'verify_ci') as verify:
                self.assertEqual(release.main(), 0); self.assertEqual(verify.call_args.args[0].candidate_mode, expected)


class ParallelFinitePinsTests(unittest.TestCase):
    def test_rollout_is_exactly_15_paths_and_no_application_or_schema_authority(self):
        self.assertEqual(release.PARALLEL_RELEASE_BASELINE, '45ae58430aea3bad312a8244432078a4ffde59f8')
        self.assertEqual(release.PARALLEL_RELEASE_BASE_TREE, '5c24c7eb3e0b7add6c04226bdbab33fea1b7846f')
        self.assertEqual(release.PARALLEL_CONTROL_FILES, {'ops/vps/code-release.py', 'ops/vps/test_code_release.py'})
        self.assertEqual(len(release.PARALLEL_OUTPUT_BLOBS), 13)
        self.assertEqual(set(release.PARALLEL_OUTPUT_MODES), set(release.PARALLEL_OUTPUT_BLOBS))
        self.assertEqual(set(release.PARALLEL_OUTPUT_MODES.values()), {'100644'})
        self.assertFalse(release.PARALLEL_CONTROL_FILES & set(release.PARALLEL_OUTPUT_BLOBS))
        self.assertIn(release.PARALLEL_PROMOTION_FILE, release.PARALLEL_OUTPUT_BLOBS)
        self.assertTrue(all(release.SHA.fullmatch(value) and value != '0' * 40
                            for value in release.PARALLEL_OUTPUT_BLOBS.values()))
        files = set(release.PARALLEL_OUTPUT_BLOBS) | release.PARALLEL_CONTROL_FILES
        self.assertEqual(len(files), 15); self.assertEqual(release.migration_plan(files), [])
        self.assertFalse(any(name.startswith(('app/', 'lib/', 'runtime/', 'drizzle/'))
                             or name in {'package.json', 'package-lock.json'} for name in files))


if __name__ == '__main__':
    unittest.main()
