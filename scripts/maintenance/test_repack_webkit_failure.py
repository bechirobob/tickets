from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import repack_webkit_failure as repack

class RepackTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'original';self.folder=self.root/'test-results'/repack.TARGET
        self.folder.mkdir(parents=True);self.output=Path(self.temp.name)/'out'
        for name in ('trace.zip','test-failed-1.png','error-context.md'):
            (self.folder/name).write_bytes(bytes(range(256))*2)
        (self.root/'unrelated.txt').write_bytes(b'not exported')
    def test_chunks_reconstruct_original_and_index_includes_unexported_files(self):
        with patch.object(repack,'BUDGET',300):index=repack.package(self.root,self.output,{'source':repack.SOURCE})
        self.assertEqual(index['partCount'],6)
        self.assertEqual(len(index['files']),4)
        for item in index['files']:
            if not item['exported']:
                self.assertNotIn('chunks',item);continue
            data=b''
            for chunk in item['chunks']:
                self.assertEqual(chunk['offset'],len(data))
                part=chunk['part']
                with zipfile.ZipFile(self.output/f'part-{part:02}'/f'failure-evidence-{part:02}.zip') as archive:
                    raw=archive.read(chunk['member']);self.assertEqual(repack.sha(raw),chunk['sha256']);data+=raw
            self.assertEqual(data,(self.root/item['path']).read_bytes())
            self.assertEqual(repack.sha(data),item['sha256'])
    def test_missing_required_evidence_rejects(self):
        (self.folder/'trace.zip').unlink()
        with self.assertRaisesRegex(ValueError,'Required'):repack.package(self.root,self.output,{})
    def test_symlink_rejects(self):
        (self.root/'link').symlink_to(self.folder/'trace.zip')
        with self.assertRaisesRegex(ValueError,'Symlink'):repack.package(self.root,self.output,{})
    def test_bounded_output_rejects_without_dropping_files(self):
        with patch.object(repack,'BUDGET',100),self.assertRaisesRegex(ValueError,'eight'):
            repack.package(self.root,self.output,{})

if __name__=='__main__':unittest.main()
