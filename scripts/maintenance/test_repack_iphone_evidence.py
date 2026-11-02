import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import repack_iphone_evidence as repack


class RepackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'original'
        self.out = Path(self.tmp.name) / 'parts'
        self.root.mkdir()
        (self.root / 'website-comparison').mkdir()
        self.parity = [{'match': True}]
        self.write('screens.json', {'sourceCommit': repack.SOURCE, 'websiteCommit': repack.SOURCE,
            'websiteEnvironment': 'candidate', 'parity': self.parity,
            'pages': [{'files': ['screen.png']}]})
        self.write('parity.json', self.parity)
        captures = [{'side': side, 'state': state, 'filename': f'{side}-{state}.png',
            'sourceRevision': repack.SOURCE if side == 'after' else 'a' * 40, 'horizontalOverflow': False}
            for side in ['before', 'after'] for state in ['home', 'menu', 'my-nights']]
        self.write('website-comparison/comparison.json', {'schemaVersion': 1, 'status': 'complete',
            'candidate': {'sourceRevision': repack.SOURCE}, 'baseline': {'sourceRevision': 'a' * 40},
            'menuChecks': [{'assessment': {'passed': True}}], 'screenshots': captures})
        for name in ['screen.png'] + ['website-comparison/' + x['filename'] for x in captures]:
            (self.root / name).write_bytes(b'\x89PNG\r\n\x1a\n' + bytes(range(256)) * 8)

    def write(self, name, obj):
        (self.root / name).write_text(json.dumps(obj))

    def run_pack(self):
        return repack.package(self.root, self.out, {'source': repack.SOURCE})

    def test_multiple_parts_preserve_every_byte_and_complete_hash_index(self):
        with patch.object(repack, 'BUDGET', 6000):
            index = self.run_pack()
        self.assertGreater(index['partCount'], 1)
        seen = set()
        for item in index['files']:
            archive = self.out / f"part-{item['part']:02}" / f"iphone-evidence-{item['part']:02}.zip"
            with zipfile.ZipFile(archive) as packed:
                data = packed.read(item['path'])
                self.assertEqual(data, (self.root / item['path']).read_bytes())
                self.assertEqual(repack.sha(data), item['sha256'])
                self.assertEqual(json.loads(packed.read('REPACK-PROVENANCE.json')), index)
            seen.add(item['path'])
        self.assertEqual(seen, {p.relative_to(self.root).as_posix() for p in self.root.rglob('*') if p.is_file()})

    def test_wrong_source_rejected(self):
        p = self.root / 'screens.json'
        data = json.loads(p.read_text()); data['sourceCommit'] = 'b' * 40
        self.write('screens.json', data)
        with self.assertRaisesRegex(ValueError, 'source mismatch'): self.run_pack()

    def test_extra_and_missing_files_rejected(self):
        (self.root / 'extra.png').write_bytes(b'png')
        with self.assertRaisesRegex(ValueError, 'unreferenced'): self.run_pack()
        (self.root / 'extra.png').unlink(); (self.root / 'screen.png').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing or'): self.run_pack()

    def test_symlink_rejected(self):
        (self.root / 'link.png').symlink_to(self.root / 'screen.png')
        with self.assertRaisesRegex(ValueError, 'Symlink'): self.run_pack()

    def test_unsafe_manifest_path_rejected(self):
        p = self.root / 'screens.json'; data = json.loads(p.read_text())
        data['pages'][0]['files'] = ['../screen.png']; self.write('screens.json', data)
        with self.assertRaisesRegex(ValueError, 'Unsafe'): self.run_pack()

    def test_oversized_file_rejected_without_reencoding(self):
        with patch.object(repack, 'BUDGET', 100):
            with self.assertRaisesRegex(ValueError, 'Single file'): self.run_pack()

    def test_failed_parity_rejected(self):
        self.write('parity.json', [{'match': False}])
        with self.assertRaisesRegex(ValueError, 'Parity'): self.run_pack()


if __name__ == '__main__':
    unittest.main()
