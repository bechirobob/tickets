"""Offline same-build transport regressions. No providers or runtime admission."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import stat
import zipfile
import tempfile
import unittest
from unittest.mock import patch

import candidate_build as build

ROOT = Path(__file__).resolve().parents[2]


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.before = Path.cwd()
        self.addCleanup(os.chdir, self.before)
        os.chdir(self.temp.name)
        self.expected = {'repository': 'bechirobob/tickets', 'source_sha': 'a'*40,
                         'source_tree': 'b'*40, 'workflow_sha': 'a'*40, 'audit_trusted_base': 'd'*40,
                         'run_id': '42', 'run_attempt': '1', 'lock_sha256': 'c'*64,
                         'node': 'v22.13.0', 'browsers': list(build.BROWSERS)}
        Path('dist/client/.vite').mkdir(parents=True)
        Path('dist/server').mkdir(parents=True)
        Path('dist/client/.vite/manifest.json').write_text('{}')
        Path('dist/client/app.js').write_text('console.log("fixture");')
        Path('dist/server/index.js').write_text('export default {};')
        Path('dist/server/wrangler.json').write_text(json.dumps({'vars': {'RELEASE_SHA':'a'*40}}))
        self.directory = Path('package')
        self.manifest = build.package(self.directory, self.expected)
        self.refresh()

    def refresh(self):
        self.archive_digest = build.digest(self.directory/build.ARCHIVE)
        self.manifest_digest = build.digest(self.directory/build.MANIFEST)

    def validate(self, expected=None):
        return build.validate(self.directory, expected or self.expected, self.archive_digest, self.manifest_digest)

    def rewrite_manifest(self, value):
        (self.directory/build.MANIFEST).write_bytes(build.canonical(value))
        self.refresh()

    def rewrite_archive(self, change):
        source = self.directory/build.ARCHIVE
        with zipfile.ZipFile(source) as handle:
            entries = [(copy.copy(m), handle.read(m)) for m in handle.infolist()]
        entries = change(entries)
        source.chmod(0o600)
        with zipfile.ZipFile(source, 'w') as handle:
            for member,data in entries:
                handle.writestr(member, data)
        value = copy.deepcopy(self.manifest)
        value['archive_sha256'] = build.digest(source)
        value['archive_bytes'] = source.stat().st_size
        self.rewrite_manifest(value)

    def test_roundtrip_same_bytes_and_hidden_manifest(self):
        original = {p.as_posix():p.read_bytes() for p in Path('dist').rglob('*') if p.is_file()}
        shutil.rmtree('dist')
        result = build.restore(self.directory,self.expected,self.archive_digest,self.manifest_digest)
        self.assertEqual(result,self.manifest)
        self.assertEqual({p.as_posix():p.read_bytes() for p in Path('dist').rglob('*') if p.is_file()},original)

    def assert_config_pack_restore(self, config):
        config['vars']['RELEASE_SHA'] = self.expected['source_sha']
        raw = json.dumps(config).encode()
        Path('dist/server/wrangler.json').write_bytes(raw)
        manifest = build.package('decimal-package', self.expected)
        shutil.rmtree('dist')
        restored = build.restore('decimal-package', self.expected,
                                 build.digest(Path('decimal-package') / build.ARCHIVE),
                                 build.digest(Path('decimal-package') / build.MANIFEST))
        self.assertEqual(restored, manifest)
        self.assertEqual(Path('dist/server/wrangler.json').read_bytes(), raw)
        self.assertEqual(build.parse_config(raw), config)

    def test_decimal_configuration_full_pack_restore_in_all_layouts(self):
        # Self-contained so the real failing decimal is exercised in both the
        # application checkout and the intentionally narrow staged controls.
        config = {'name': 'becore-tickets', 'main': './index.js',
                  'compatibility_date': '2026-08-11',
                  'compatibility_flags': ['nodejs_compat'], 'vars': {},
                  'observability': {'enabled': True,
                                    'logs': {'enabled': True, 'head_sampling_rate': 1},
                                    'traces': {'enabled': True, 'head_sampling_rate': 0.05}}}
        self.assert_config_pack_restore(config)

    def test_checked_in_wrangler_config_full_checkout_only(self):
        path = ROOT / 'wrangler.jsonc'
        if not path.exists():
            self.assertFalse((ROOT / 'package.json').exists() or (ROOT / 'app').exists(),
                             'Full application checkout must include wrangler.jsonc')
            self.skipTest('Application config is intentionally absent from the staged controls archive')
        config = json.loads(path.read_bytes())
        self.assertEqual(config['observability']['traces']['head_sampling_rate'], 0.05)
        self.assert_config_pack_restore(config)

    def test_config_decimal_mode_never_relaxes_manifest_numbers(self):
        values = (b'0.05', b'1.0', b'-0.125', b'1.25e-7', b'1e19', b'0.0', b'-0.0')
        for value in values:
            raw = b'{"sampling":' + value + b'}'
            with self.subTest(value=value):
                self.assertEqual(build.parse_config(raw)['sampling'], float(value))
                with self.assertRaises(build.BuildError): build.parse(raw)
        for field in ('archive_bytes', 'expanded_bytes'):
            manifest = copy.deepcopy(self.manifest)
            manifest[field] = float(manifest[field])
            self.rewrite_manifest(manifest)
            with self.subTest(field=field), self.assertRaises(build.BuildError): self.validate()
        manifest = copy.deepcopy(self.manifest)
        manifest['files'][0]['size'] = float(manifest['files'][0]['size'])
        self.rewrite_manifest(manifest)
        with self.assertRaises(build.BuildError): self.validate()

    def test_config_numbers_duplicates_and_resource_bounds_fail_closed(self):
        values = (b'NaN', b'Infinity', b'-Infinity', b'1e309', b'-1e309', b'1e20',
                  b'-1e20', b'1e-999', b'100000000000000000000', b'0.' + b'0'*128 + b'1')
        malformed = [b'{"sampling":' + value + b'}' for value in values]
        malformed.extend((b'{"sampling":0.05,"sampling":0.1}', b'{',
                          b'['*33 + b'0.05' + b']'*33, b'['*1500 + b']'*1500))
        for raw in malformed:
            with self.subTest(raw=raw[:60]), self.assertRaises(build.BuildError): build.parse_config(raw)
        with patch.object(build, 'MAX_MANIFEST', 1), self.assertRaises(build.BuildError):
            build.parse_config(b'{}')

    def test_decimal_config_still_requires_exact_embedded_release_identity(self):
        invalid = ({'vars': {'RELEASE_SHA': 'b'*40}, 'sampling': 0.05},
                   {'sampling': 0.05}, {'vars': None, 'sampling': 0.05},
                   {'vars': [], 'sampling': 0.05}, [0.05])
        for index, config in enumerate(invalid):
            Path('dist/server/wrangler.json').write_text(json.dumps(config))
            directory = Path(f'invalid-config-{index}')
            build.package(directory, self.expected)
            shutil.rmtree('dist')
            with self.subTest(config=config), self.assertRaisesRegex(build.BuildError, 'Embedded release identity'):
                build.restore(directory, self.expected, build.digest(directory / build.ARCHIVE),
                              build.digest(directory / build.MANIFEST))

    def test_realistic_generated_basename_over_100_bytes(self):
        name='dist/server/'+('framework~index~page~'*8)+'.js'
        Path(name).write_text('export default {};')
        build.package('long-package',self.expected)
        shutil.rmtree('dist')
        build.restore('long-package',self.expected,build.digest(Path('long-package')/build.ARCHIVE),
                      build.digest(Path('long-package')/build.MANIFEST))
        self.assertEqual(Path(name).read_text(),'export default {};')

    def test_restore_never_overwrites_existing_checkout(self):
        with self.assertRaises(build.BuildError):
            build.restore(self.directory,self.expected,self.archive_digest,self.manifest_digest)

    def test_all_identity_changes_fail_closed_including_partial_rerun(self):
        for key in self.expected:
            value=copy.deepcopy(self.expected)
            value[key] = ['wrong'] if key=='browsers' else 'wrong'
            with self.subTest(key=key),self.assertRaises(build.BuildError):
                self.validate(value)

    def test_independent_digest_mismatch(self):
        for archive,manifest in [('0'*64,self.manifest_digest),(self.archive_digest,'0'*64),('',self.manifest_digest)]:
            with self.assertRaises(build.BuildError):
                build.validate(self.directory,self.expected,archive,manifest)

    def test_duplicate_json_keys_and_unknown_fields(self):
        p=self.directory/build.MANIFEST
        original=p.read_bytes()
        p.write_bytes(original.replace(b'{',b'{"schema":"wrong",',1));self.refresh()
        with self.assertRaises(build.BuildError): self.validate()
        value=copy.deepcopy(self.manifest);value['extra']=1;self.rewrite_manifest(value)
        with self.assertRaises(build.BuildError): self.validate()

    def test_file_inventory_duplicates_missing_wrong_sizes_and_types(self):
        for mutation in ('duplicate','missing','size','bool','digest','total'):
            value=copy.deepcopy(self.manifest)
            if mutation=='duplicate': value['files'].append(value['files'][0])
            if mutation=='missing': value['files'].pop()
            if mutation=='size': value['files'][0]['size']+=1
            if mutation=='bool': value['files'][0]['size']=True
            if mutation=='digest': value['files'][0]['sha256']='0'*64
            if mutation=='total': value['expanded_bytes']=True
            self.rewrite_manifest(value)
            with self.subTest(mutation=mutation),self.assertRaises(build.BuildError):self.validate()

    def test_missing_duplicate_content_and_special_archive_members(self):
        original=(self.directory/build.ARCHIVE).read_bytes()
        for mutation in ('missing','duplicate','content','symlink','hardlink','fifo','device','mode','traversal'):
            (self.directory/build.ARCHIVE).chmod(0o600)
            (self.directory/build.ARCHIVE).write_bytes(original)
            def change(entries):
                if mutation=='missing':return entries[:-1]
                if mutation=='duplicate':return entries+[entries[0]]
                member,data=entries[0]
                if mutation=='content': data=b'X'*len(data)
                if mutation in ('symlink','hardlink','fifo','device'):
                    member.external_attr=({'symlink':stat.S_IFLNK,'hardlink':stat.S_IFDIR,'fifo':stat.S_IFIFO,'device':stat.S_IFCHR}[mutation]|0o644)<<16
                if mutation=='mode':member.external_attr=(stat.S_IFREG|0o4755)<<16
                if mutation=='traversal':member.filename='dist/client/../../outside'
                return [(member,data),*entries[1:]]
            self.rewrite_archive(change)
            with self.subTest(mutation=mutation),self.assertRaises(build.BuildError):self.validate()

    def test_private_paths_symlinks_and_secret_literals_never_package(self):
        for name in ('dist/client/.env','dist/server/.dev.vars','dist/server/data.sqlite','dist/client/secret.pem','dist/server/.wrangler/state/file'):
            p=Path(name);p.parent.mkdir(parents=True,exist_ok=True);p.write_text('private')
            with self.subTest(name=name),self.assertRaises((build.BuildError,build.privacy.PublicRuntimeError)):
                build.package('rejected',self.expected)
            p.unlink()
        Path('dist/client/link').symlink_to('app.js')
        with self.assertRaises(build.BuildError):build.package('rejected',self.expected)
        Path('dist/client/link').unlink()
        Path('dist/server/leak.js').write_text('const secret="ghp_'+'A'*40+'";')
        with self.assertRaises(build.privacy.PublicRuntimeError):build.package('rejected',self.expected)
        self.assertFalse(Path('rejected').exists())

    def test_path_syntax_and_roots(self):
        for name in ('/dist/client/a','dist/client/../a','dist/client//a','dist/client/a\\b','dist/server/a\n','dist/other/a','dist/client/node_modules/a','dist/client/.git/a'):
            with self.subTest(name=name),self.assertRaises((build.BuildError,build.privacy.PublicRuntimeError)):build.safe_name(name)

    def test_compressed_expanded_manifest_and_file_limits(self):
        for key,value in [('MAX_ARCHIVE',1),('MAX_EXPANDED',1),('MAX_MANIFEST',1),('MAX_FILES',1)]:
            with self.subTest(limit=key),patch.object(build,key,value),self.assertRaises(build.BuildError):self.validate()

    def test_inventory_ancestor_collision_rejected_before_extraction(self):
        value=copy.deepcopy(self.manifest)
        value['files'][0]['path']='dist/client/a'
        value['files'][1]['path']='dist/client/a/b'
        self.rewrite_manifest(value)
        with self.assertRaisesRegex(build.BuildError,'ancestor collisions'): self.validate()

    def test_manifest_and_archive_symlink_inputs_rejected(self):
        p=self.directory/build.MANIFEST;p.rename('real.json');p.symlink_to(Path.cwd()/'real.json')
        with self.assertRaises(build.BuildError):self.validate()

    def test_version_one_and_mismatched_audit_baseline_never_transport(self):
        for mutate in (lambda value: value.update(schema='tickets-browser-build/v1'),
                       lambda value: value.pop('audit_trusted_base'),
                       lambda value: value.update(audit_trusted_base='e'*40)):
            value = copy.deepcopy(self.manifest)
            mutate(value)
            self.rewrite_manifest(value)
            with self.assertRaises(build.BuildError): self.validate()
        value = copy.deepcopy(self.manifest)
        value['schema'] = 'tickets-browser-build/v1'
        with self.assertRaises(build.BuildError):
            build.receipt('producer', value, '17', 'd'*64, self.manifest_digest)

    def test_invalid_build_json_numbers_and_types_fail_closed(self):
        for raw in (b'{', b'{"a":1.0}', b'{"a":NaN}', b'{"a":1,"a":2}', b'['*1500+b']'*1500):
            with self.subTest(raw=raw[:30]), self.assertRaises(build.BuildError): build.parse(raw)
        for field in ('run_id', 'run_attempt', 'audit_trusted_base', 'source_sha', 'lock_sha256'):
            value = copy.deepcopy(self.expected)
            value[field] = True
            with self.subTest(field=field), self.assertRaises(build.BuildError): build.validate_identity(value)
        for digest in ('', True, 'g'*64):
            with self.assertRaises(build.BuildError):
                build.receipt('producer', self.manifest, '17', 'd'*64, digest)

    def test_receipts_bind_artifact_identity_and_browser(self):
        value=build.receipt('producer',self.manifest,'17','d'*64,self.manifest_digest)
        self.assertEqual(value['run_attempt'],'1');self.assertEqual(value['artifact_id'],'17')
        self.assertEqual(value['schema'], 'tickets-browser-build/v2')
        self.assertEqual(value['audit_trusted_base'], self.expected['audit_trusted_base'])
        for browser in build.BROWSERS:
            value=build.receipt('consumer',self.manifest,'17','d'*64,self.manifest_digest,browser)
            self.assertEqual(value['browser'],browser)
            self.assertEqual(value['audit_trusted_base'], self.expected['audit_trusted_base'])
        for identity in ('','latest','01'):
            with self.assertRaises(build.BuildError):build.receipt('producer',self.manifest,identity,'d'*64,self.manifest_digest)
        with self.assertRaises(build.BuildError):build.receipt('consumer',self.manifest,'17','d'*64,self.manifest_digest,'unknown')

    def test_explicit_retry_transport_keeps_original_manifest_and_v2_strict(self):
        current = {**self.expected, 'run_attempt': '2'}
        with self.assertRaisesRegex(build.BuildError, 'Build identity differs'):
            self.validate(current)
        shutil.rmtree('dist')
        restored = build.restore_retry(self.directory, current, '1',
                                       self.archive_digest, self.manifest_digest)
        self.assertEqual(restored, self.manifest)
        self.assertEqual(restored['run_attempt'], '1')
        self.assertEqual(restored['schema'], build.SCHEMA)
        for browser in build.BROWSERS:
            old = build.receipt('consumer', restored, '17', 'd'*64, self.manifest_digest, browser)
            value = build.retry_receipt(restored, current, '1', '17', 'd'*64,
                                        self.manifest_digest, browser)
            self.assertEqual(set(value), set(old) | {'producer_attempt'})
            self.assertEqual(value, {**old, 'schema': build.RETRY_RECEIPT_SCHEMA,
                                    'run_attempt': '2', 'producer_attempt': '1'})

    def test_retry_transport_only_allows_exact_first_to_second_attempt(self):
        for producer, consumer in (('1','1'),('1','3'),('2','2'),('2','3'),('', '2'),
                                   ('01','2'),(1,'2'),(True,'2'),('1',2),('1',True)):
            current = {**self.expected, 'run_attempt': consumer}
            with self.subTest(producer=producer, consumer=consumer), self.assertRaises(build.BuildError):
                build.retry_producer_identity(current, producer)
        self.assertEqual(build.retry_producer_identity({**self.expected, 'run_attempt':'2'},'1'), self.expected)

    def test_retry_transport_rejects_every_changed_original_identity_field(self):
        mutations = {'source_sha':'e'*40, 'source_tree':'e'*40, 'workflow_sha':'e'*40,
                     'audit_trusted_base':'e'*40, 'run_id':'43', 'lock_sha256':'e'*64,
                     'node':'v22.23.5', 'repository':'other/tickets', 'browsers':['desktop-chromium']}
        for field, value in mutations.items():
            current = {**self.expected, 'run_attempt':'2', field:value}
            with self.subTest(field=field), self.assertRaises(build.BuildError):
                build.restore_retry(self.directory, current, '1', self.archive_digest, self.manifest_digest)
            with self.subTest(receipt_field=field), self.assertRaises(build.BuildError):
                build.retry_receipt(self.manifest, current, '1', '17', 'd'*64,
                                    self.manifest_digest, 'desktop-chromium')

    def test_retry_transport_never_overwrites_or_accepts_tampered_archive(self):
        current = {**self.expected, 'run_attempt':'2'}
        with self.assertRaisesRegex(build.BuildError, 'absent dist'):
            build.restore_retry(self.directory, current, '1', self.archive_digest, self.manifest_digest)
        shutil.rmtree('dist')
        path = self.directory / build.ARCHIVE
        path.chmod(0o600)
        path.write_bytes(path.read_bytes()+b'tampered')
        with self.assertRaisesRegex(build.BuildError, 'Producer build digest differs'):
            build.restore_retry(self.directory, current, '1', self.archive_digest, self.manifest_digest)
        self.assertFalse(Path('dist').exists())

    def test_retry_receipt_rejects_unknown_browser_and_invalid_artifact(self):
        current = {**self.expected, 'run_attempt':'2'}
        for artifact, digest, browser in (('', 'd'*64, 'desktop-chromium'),
                                          ('17', 'invalid', 'desktop-chromium'),
                                          ('17', 'd'*64, 'unknown'), ('17','d'*64,None)):
            with self.subTest(artifact=artifact,browser=browser), self.assertRaises(build.BuildError):
                build.retry_receipt(self.manifest,current,'1',artifact,digest,self.manifest_digest,browser)


    def test_cli_requires_explicit_retry_command_and_emits_bound_receipt(self):
        current = {**self.expected, 'run_attempt':'2'}
        environment = {'BUILD_PRODUCER_ATTEMPT':'1','BUILD_ARTIFACT_ID':'17',
                       'BUILD_ARTIFACT_DIGEST':'d'*64,'BUILD_ARCHIVE_DIGEST':self.archive_digest,
                       'BUILD_MANIFEST_DIGEST':self.manifest_digest}
        shutil.rmtree('dist')
        with patch.object(build, 'identity', return_value=current), patch.dict(os.environ, environment):
            with patch('sys.argv',['candidate_build.py','restore','--directory',str(self.directory),
                                   '--browser','mobile-webkit']), self.assertRaisesRegex(build.BuildError,'Build identity differs'):
                build.main()
            self.assertFalse(Path('dist').exists())
            with patch('sys.argv',['candidate_build.py','restore-retry','--directory',str(self.directory),
                                   '--browser','mobile-webkit']), patch('sys.stdout',new_callable=io.StringIO) as output:
                build.main()
            value=json.loads(output.getvalue().removeprefix(build.PREFIX))
            self.assertEqual(value['schema'],build.RETRY_RECEIPT_SCHEMA)
            self.assertEqual((value['producer_attempt'],value['run_attempt']),('1','2'))
            self.assertEqual(value['manifest_sha256'],self.manifest_digest)

    def test_package_cli_exports_exact_producer_attempt_without_new_manifest_schema(self):
        with patch.object(build,'identity',return_value=self.expected), patch.dict(os.environ, {'GITHUB_OUTPUT':'outputs'}), \
             patch('sys.argv',['candidate_build.py','package','--directory','second-package']):
            build.main()
        outputs=dict(line.split('=',1) for line in Path('outputs').read_text().splitlines())
        self.assertEqual(outputs['producer_attempt'],'1')
        self.assertEqual(set(outputs),{'producer_attempt','archive_digest','manifest_digest'})
        self.assertEqual(build.parse(Path('second-package/browser-build.json').read_bytes())['schema'],build.SCHEMA)



class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.before = Path.cwd()
        self.addCleanup(os.chdir, self.before)
        os.chdir(self.temp.name)
        def command(*args):
            return subprocess.check_output(['git', *args], text=True, stderr=subprocess.DEVNULL).strip()
        self.git = command
        command('init', '-q')
        command('config', 'user.name', 'Identity fixture')
        command('config', 'user.email', 'fixture@example.invalid')
        Path('package-lock.json').write_text('{}')
        command('add', 'package-lock.json')
        command('commit', '-qm', 'independent audit controls')
        self.baseline = command('rev-parse', 'HEAD')
        Path('source.txt').write_text('candidate')
        command('add', 'source.txt')
        command('commit', '-qm', 'candidate source')
        self.source = command('rev-parse', 'HEAD')
        command('update-ref', 'refs/remotes/origin/main', self.source)
        self.env = {'GITHUB_REPOSITORY': 'bechirobob/tickets', 'BECORE_RELEASE_SHA': self.source,
                    'GITHUB_WORKFLOW_SHA': self.source, 'BECORE_TRUSTED_BASE': self.baseline,
                    'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2'}
        self.original_output = subprocess.check_output

    def identity(self):
        def output(args, **kwargs):
            return 'v22.13.0' if args == ['node', '--version'] else self.original_output(args, **kwargs)
        with patch.dict(os.environ, self.env), patch.object(subprocess, 'check_output', side_effect=output):
            return build.identity()

    def test_v2_identity_binds_exact_source_tree_and_independent_ancestor(self):
        result = self.identity()
        self.assertEqual(result['audit_trusted_base'], self.baseline)
        self.assertEqual(result['source_sha'], self.source)
        self.assertEqual(result['source_tree'], self.git('rev-parse', 'HEAD^{tree}'))

    def test_missing_self_or_noncommit_audit_baseline_rejected(self):
        for value in ('', 'HEAD', self.source, self.git('rev-parse', 'HEAD:source.txt'), '0'*40):
            self.env['BECORE_TRUSTED_BASE'] = value
            with self.subTest(value=value), self.assertRaises(build.BuildError): self.identity()

    def test_audit_baseline_must_be_ancestor_of_both_source_and_main(self):
        self.git('checkout', '--orphan', 'other')
        self.git('rm', '-qrf', '.')
        Path('foreign.txt').write_text('unrelated')
        self.git('add', 'foreign.txt'); self.git('commit', '-qm', 'unrelated history')
        foreign = self.git('rev-parse', 'HEAD')
        self.git('checkout', '--detach', self.source)
        self.env['BECORE_TRUSTED_BASE'] = foreign
        with self.assertRaises(build.BuildError): self.identity()
        self.env['BECORE_TRUSTED_BASE'] = self.baseline
        self.git('update-ref', 'refs/remotes/origin/main', foreign)
        with self.assertRaises(build.BuildError): self.identity()

    def test_dirty_unstaged_staged_deleted_or_different_head_rejected(self):
        for mode in ('unstaged', 'staged', 'deleted'):
            self.git('reset', '--hard', self.source)
            if mode == 'deleted': Path('source.txt').unlink()
            else: Path('source.txt').write_text('changed source')
            if mode == 'staged': self.git('add', 'source.txt')
            with self.subTest(mode=mode), self.assertRaises(build.BuildError): self.identity()
        self.git('reset', '--hard', self.source)
        self.env['BECORE_RELEASE_SHA'] = self.baseline
        self.env['GITHUB_WORKFLOW_SHA'] = self.baseline
        with self.assertRaises(build.BuildError): self.identity()

    def test_git_environment_cannot_replace_source_or_enable_lazy_fetch(self):
        with patch.dict(os.environ, {'GIT_CONFIG_COUNT':'1', 'GIT_CONFIG_KEY_0':'alias.rev-parse',
                                     'GIT_CONFIG_VALUE_0':'!exit 0', 'GIT_DIR':'/not/a/repository'}):
            self.assertEqual(self.identity()['source_sha'], self.source)


class BenchmarkSourceFamilyTests(unittest.TestCase):
    def test_all_or_none_exact_tooling_extension_without_application_change(self):
        import test_code_release as contracts
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            def git(*args):
                return subprocess.check_output(['git','-C',str(root),*args],text=True,stderr=subprocess.DEVNULL).strip()
            git('init','-q');git('config','user.name','Source fixture');git('config','user.email','fixture@example.invalid')
            (root/'application.txt').write_text('unchanged application')
            (root/'control.py').write_text('reviewed controls')
            git('add','-A');git('commit','-qm','baseline')
            baseline=git('rev-parse','HEAD');tree=git('rev-parse','HEAD^{tree}')
            raw=b'reviewed benchmark'
            blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            with patch.dict(contracts.BENCHMARK_FILE_BLOBS, {'bench/a.py':blob,'bench/b.py':blob}, clear=True):
                check=lambda: contracts.exact_application_checkout(root,baseline,tree,{'control.py'})
                self.assertTrue(check(), 'Original checkout must remain valid')
                (root/'bench').mkdir();(root/'bench/a.py').write_bytes(raw);git('add','bench/a.py')
                self.assertFalse(check(), 'Partial tooling must fail')
                (root/'bench/b.py').write_bytes(raw);git('add','bench/b.py')
                self.assertTrue(check(), 'Complete exact tooling must pass')
                (root/'bench/a.py').write_text('tampered');self.assertFalse(check())
                (root/'bench/a.py').write_bytes(raw);(root/'bench/a.py').chmod(0o755);self.assertFalse(check())
                (root/'bench/a.py').chmod(0o644);(root/'bench/a.py').unlink();(root/'bench/a.py').symlink_to('b.py');self.assertFalse(check())
                (root/'bench/a.py').unlink();(root/'bench/a.py').write_bytes(raw)
                (root/'unknown.txt').write_text('unknown');self.assertFalse(check())
                git('add','unknown.txt');self.assertFalse(check(), 'Unknown tracked addition must fail')
                (root/'unknown.txt').unlink();git('reset','-q','HEAD','unknown.txt')
                (root/'application.txt').write_text('changed');self.assertFalse(check(), 'App byte checks remain strict')



if __name__=='__main__': unittest.main()
