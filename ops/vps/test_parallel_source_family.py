"""Reserved P-only regressions for complete full/staged C and P source families.

C carries all production controls and all other admission tests. Adding only
this genuine suite is the finite promotion delta; it grants no broader source
or migration authority.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import test_code_release as controls

release = controls.release


def blob(raw):
    return release.hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


class CompleteParallelFamilyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.git('init', '-q'); self.git('config', 'user.name', 'Family tests'); self.git('config', 'user.email', 'tests@example.invalid')
        self.base_files = {'package.json': b'{"fixture":true}\n', 'app/page.tsx': b'application bytes\n',
                           'README.md': b'baseline\n', 'ops/vps/runtime_release.py': b'unchanged runtime\n',
                           'ops/vps/code-release.py': b'old operator\n', 'ops/vps/test_code_release.py': b'old tests\n'}
        for name, raw in self.base_files.items(): self.write(name, raw)
        self.git('add', '-A'); self.git('commit', '-qm', 'base')
        baseline = self.git('rev-parse', 'HEAD'); tree = self.git('rev-parse', 'HEAD^{tree}')
        self.outputs = {name: ('reviewed ' + name + '\n').encode() for name in release.PARALLEL_OUTPUT_BLOBS}
        self.pins = {name: blob(raw) for name, raw in self.outputs.items()}
        self.staged_base = {name: ('100644', blob(raw)) for name, raw in self.base_files.items()
                            if name.startswith('ops/vps/')}
        for item in (patch.object(release, 'PARALLEL_RELEASE_BASELINE', baseline),
                     patch.object(release, 'PARALLEL_RELEASE_BASE_TREE', tree),
                     patch.object(release, 'PARALLEL_OUTPUT_BLOBS', self.pins),
                     patch.object(controls, 'PARALLEL_OPERATOR_BLOB', blob(b'independent evolving control\n')),
                     patch.object(controls, 'PARALLEL_STAGED_BASE', self.staged_base)):
            item.start(); self.addCleanup(item.stop)
        self.write_family(False)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args],
            stderr=subprocess.DEVNULL, env=release.git_environment()).decode().strip()

    def write(self, name, raw):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink(): path.unlink()
        path.write_bytes(raw); path.chmod(0o644); return path

    def write_family(self, promoted):
        for name, raw in self.outputs.items():
            if name != release.PARALLEL_PROMOTION_FILE or promoted: self.write(name, raw)
        for name in release.PARALLEL_CONTROL_FILES: self.write(name, b'independent evolving control\n')
        reserved = self.root / release.PARALLEL_PROMOTION_FILE
        if not promoted and reserved.exists(): reserved.unlink()

    def staged(self, root, promoted):
        for name, raw in self.base_files.items():
            if name in self.staged_base:
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'independent evolving control\n' if name in release.PARALLEL_CONTROL_FILES else raw)
        for name, raw in self.outputs.items():
            if ((name.startswith('ops/vps/') or name.startswith('.github/workflows/'))
                    and (name != release.PARALLEL_PROMOTION_FILE or promoted)):
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)

    def test_complete_full_c_and_p_each_recognized(self):
        for promoted in (False, True):
            self.write_family(promoted)
            manifest = controls.parallel_source_family(self.root)
            self.assertIn('app/page.tsx', manifest)
            self.assertEqual(release.PARALLEL_PROMOTION_FILE in manifest, promoted)
            self.assertEqual(len(set(manifest) & set(self.outputs)), 13 if promoted else 12)

    def test_complete_staged_c_and_p_each_recognized_with_unchanged_old_files(self):
        for promoted in (False, True):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); self.staged(root, promoted)
                manifest = controls.parallel_source_family(root)
                self.assertIn('ops/vps/runtime_release.py', manifest)
                self.assertNotIn('docs/reliability/parallel-candidate-benchmark.md', manifest)
                self.assertNotIn('tests/test_candidate_parallel_workflow.py', manifest)
                self.assertEqual(release.PARALLEL_PROMOTION_FILE in manifest, promoted)
                (root / 'ops/vps/runtime_release.py').write_text('mutated historical file\n')
                with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'): controls.parallel_source_family(root)

    def test_every_output_must_match_same_complete_family(self):
        self.write_family(True)
        for name, raw in self.outputs.items():
            path = self.write(name, b'older or unreviewed variant\n')
            with self.subTest(name=name), self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                controls.parallel_source_family(self.root)
            path.write_bytes(raw)

    def test_missing_source_family_files_never_fall_back_to_legacy(self):
        for name, raw in self.outputs.items():
            if name == release.PARALLEL_PROMOTION_FILE: continue
            path = self.root / name; path.unlink()
            with self.subTest(name=name), self.assertRaises(AssertionError): controls.parallel_source_family(self.root)
            path.write_bytes(raw)

    def test_full_application_dependency_and_unknown_file_mutations_reject(self):
        for name in ('app/page.tsx', 'package.json', 'README.md'):
            path = self.write(name, b'application mutation\n')
            with self.subTest(name=name), self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                controls.parallel_source_family(self.root)
            path.write_bytes(self.base_files[name])
        extra = self.write('tests/unreviewed.py', b'extra\n')
        with self.assertRaisesRegex(AssertionError, 'full inventory'): controls.parallel_source_family(self.root)
        extra.unlink()

    def test_index_assume_unchanged_cannot_hide_changed_application_bytes(self):
        self.git('update-index', '--assume-unchanged', 'app/page.tsx')
        (self.root / 'app/page.tsx').write_bytes(b'hidden application mutation\n')
        with self.assertRaisesRegex(AssertionError, 'unreviewed bytes'): controls.parallel_source_family(self.root)

    def test_staged_extra_missing_symlinked_and_executable_members_reject(self):
        for mutation in ('extra', 'missing', 'symlink', 'executable'):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); self.staged(root, True); target = root / 'ops/vps/candidate_build.py'
                if mutation == 'extra': (root / 'unexpected').write_bytes(b'extra\n')
                elif mutation == 'missing': target.unlink()
                elif mutation == 'symlink': target.unlink(); target.symlink_to('runtime_release.py')
                else: target.chmod(0o755)
                with self.subTest(mutation=mutation), self.assertRaises(AssertionError): controls.parallel_source_family(root)

    def test_partial_staged_new_family_cannot_select_old_pins(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); path = root / 'ops/vps/test_parallel_candidate.py'
            path.parent.mkdir(parents=True); path.write_bytes(self.outputs['ops/vps/test_parallel_candidate.py'])
            with self.assertRaisesRegex(AssertionError, 'inventory'): controls.parallel_source_family(root)

    def test_exact_operator_bytes_cannot_self_exempt(self):
        for staged in (False, True):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) if staged else self.root
                if staged: self.staged(root, True)
                path = root / 'ops/vps/code-release.py'
                original = path.read_bytes(); path.write_bytes(b'arbitrary operator bytes\n')
                with self.subTest(staged=staged), self.assertRaisesRegex(AssertionError, 'unreviewed bytes'):
                    controls.parallel_source_family(root)
                path.write_bytes(original)

    def test_staged_unknown_empty_directories_caches_and_hardlinks_reject(self):
        for mutation in ('empty-directory', 'nested-cache', 'fake-pyc', 'hardlink'):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); self.staged(root, True)
                if mutation == 'empty-directory': (root / 'unexpected-empty').mkdir()
                elif mutation == 'nested-cache':
                    path = root / 'ops/vps/__pycache__/arbitrary/unauthenticated.py'
                    path.parent.mkdir(parents=True); path.write_bytes(b'print("untrusted")\n')
                elif mutation == 'fake-pyc':
                    import sys
                    path = root / ('ops/vps/__pycache__/candidate_build.' + sys.implementation.cache_tag + '.pyc')
                    path.parent.mkdir(); path.write_bytes(b'not a generated cache')
                else:
                    path = root / 'ops/vps/candidate_build.py'
                    original = path.with_suffix('.saved'); path.rename(original); os.link(original, path)
                with self.subTest(mutation=mutation), self.assertRaises(AssertionError): controls.parallel_source_family(root)

    def test_genuine_generated_cache_for_pinned_source_is_accepted(self):
        import py_compile
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); self.staged(root, True)
            source = root / 'ops/vps/runtime_release.py'
            source.write_bytes(b'value = 1\n')
            self.staged_base['ops/vps/runtime_release.py'] = ('100644', blob(source.read_bytes()))
            py_compile.compile(str(source), doraise=True)
            controls.parallel_source_family(root)

    def test_timestamp_valid_modified_bytecode_and_trailing_cache_bytes_reject(self):
        import importlib.util
        import marshal
        import py_compile
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); self.staged(root, True)
            source = root / 'ops/vps/runtime_release.py'; source.write_bytes(b'value = 1\n')
            self.staged_base['ops/vps/runtime_release.py'] = ('100644', blob(source.read_bytes()))
            cache = Path(importlib.util.cache_from_source(str(source)))
            for mutation in ('altered-code', 'trailing-content'):
                py_compile.compile(str(source), doraise=True); raw = cache.read_bytes()
                if mutation == 'altered-code':
                    raw = raw[:16] + marshal.dumps(compile('value = 999\n', str(source), 'exec'))
                else: raw += b'unexpected bytes'
                cache.write_bytes(raw)
                with self.subTest(mutation=mutation), self.assertRaisesRegex(AssertionError, 'Cache code|trailing cache'):
                    controls.parallel_source_family(root)

    def test_combined_marker_removal_cannot_downgrade_mixed_archive_to_legacy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); self.staged(root, True)
            markers = ('parallel_candidate.py', 'parallel_candidate_control.py', 'test_parallel_candidate.py',
                       'test_parallel_candidate_control.py', 'test_parallel_admission.py', 'test_parallel_source_family.py')
            for name in markers: (root / 'ops/vps' / name).unlink()
            legacy = dict(self.staged_base)
            # Simulate restoring all old fingerprint files while retaining the
            # new candidate_build and workflow residue that defeated selection.
            fingerprints = ('.github/workflows/vps-runtime.yml', 'ops/vps/test_runtime_packaging.py',
                            'tests/test_audit_release_source.py')
            for fingerprint in fingerprints:
                path = root / fingerprint; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'legacy fingerprint\n')
                legacy[fingerprint] = ('100644', blob(b'legacy fingerprint\n'))
            legacy['ops/vps/code-release.py'] = ('100644', controls.PARALLEL_OPERATOR_BLOB)
            legacy['ops/vps/test_code_release.py'] = ('100644', None)
            self.assertIsNone(controls.parallel_source_family(root))
            with patch.object(controls, 'legacy_staged_manifests', return_value=[(legacy, {name: legacy[name][1] for name in fingerprints})]):
                with self.assertRaisesRegex(AssertionError, 'Mixed or unknown'): controls.staged_family_pins(root)

    def test_baseline_tree_must_be_the_independent_exact_pin(self):
        with patch.object(release, 'PARALLEL_RELEASE_BASE_TREE', 'f' * 40):
            with self.assertRaisesRegex(AssertionError, 'baseline tree'): controls.parallel_source_family(self.root)


if __name__ == '__main__':
    unittest.main()
