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
                         'source_tree': 'b'*40, 'workflow_sha': 'a'*40,
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

    def test_receipts_bind_artifact_identity_and_browser(self):
        value=build.receipt('producer',self.manifest,'17','d'*64,self.manifest_digest)
        self.assertEqual(value['run_attempt'],'1');self.assertEqual(value['artifact_id'],'17')
        for browser in build.BROWSERS:
            value=build.receipt('consumer',self.manifest,'17','d'*64,self.manifest_digest,browser)
            self.assertEqual(value['browser'],browser)
        for identity in ('','latest','01'):
            with self.assertRaises(build.BuildError):build.receipt('producer',self.manifest,identity,'d'*64,self.manifest_digest)
        with self.assertRaises(build.BuildError):build.receipt('consumer',self.manifest,'17','d'*64,self.manifest_digest,'unknown')


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
