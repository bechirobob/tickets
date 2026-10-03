"""Offline public-boundary fixtures; no secrets, credentials or external writes."""
import io
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import public_runtime_guard as guard


class PublicRuntimeGuardTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.stage = self.root / 'dist-vps'
        self.stage.mkdir()
        self.archive = self.root / 'runtime.tgz'
        self.node = self.root / 'node'
        self.node.write_bytes(b'node executable fixture')
        self.tracked = {'ops/vps/backup.mjs', 'drizzle/0000_schema.sql'}
        for name, content in {
            'server.mjs': b'export {}', 'release.json': b'{}', 'package.json': b'{}',
            'bin/node': self.node.read_bytes(), 'client/assets/app.js': b'console.log("public");',
            'server/index.js': b'export {}', 'operations/backup.mjs': b'// backup program source',
            'migrations/0000_schema.sql': b'CREATE TABLE test (id TEXT);',
            'node_modules/pkg/index.js': b'module.exports = {};',
        }.items():
            file = self.stage / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
            origin = name.replace('operations/', 'ops/vps/').replace('migrations/', 'drizzle/')
            if origin != name or name.startswith('node_modules/'):
                original = self.root / origin
                original.parent.mkdir(parents=True, exist_ok=True)
                original.write_bytes(content)
        patcher = patch.object(guard, 'tracked_sources', return_value=self.tracked)
        patcher.start()
        self.addCleanup(patcher.stop)

    def pack(self, extra=None):
        with tarfile.open(self.archive, 'w:gz') as archive:
            archive.add(self.stage, arcname='.', recursive=True)
            if extra:
                item, data = extra
                archive.addfile(item, io.BytesIO(data) if data else None)

    def verify(self):
        return guard.validate_public_archive(self.archive, root=self.root, node=self.node)

    def test_current_package_and_internal_dependency_link(self):
        for base in (self.stage, self.root):
            (base / 'node_modules/.bin').mkdir()
            (base / 'node_modules/.bin/pkg').symlink_to('../pkg/index.js')
        self.pack()
        self.assertGreater(self.verify()['members'], 10)

    def test_internal_hardlink_matches_earlier_regular_dependency(self):
        import os
        for base in (self.stage, self.root):
            os.link(base / 'node_modules/pkg/index.js', base / 'node_modules/pkg/linked.js')
            (base / 'node_modules/pkg/command').symlink_to('linked.js')
        self.pack()
        self.verify()
        # An unapproved destination or forward/absent target never works.
        for name, link in (('./client/link.js', './node_modules/pkg/index.js'),
                           ('./node_modules/pkg/extra.js', './node_modules/pkg/missing.js')):
            item = tarfile.TarInfo(name)
            item.type, item.linkname = tarfile.LNKTYPE, link
            self.pack((item, b''))
            with self.assertRaises(guard.PublicRuntimeError): self.verify()

    def test_forbidden_nested_names(self):
        for name in ('client/.env.production', 'client/.dev.vars', 'node_modules/pkg/.dev.vars.production', 'node_modules/pkg/.npmrc', 'server/customer.sqlite',
                     'operations/credentials.json', 'client/logs/customer.txt', 'server/raw.sql',
                     'state/db', 'client/key.pem', 'node_modules/pkg/.ssh/config',
                     'client/assets/innocent.enc', 'client/assets/snapshot.tar.gz',
                     'node_modules/pkg/innocent.zip'):
            with self.subTest(name=name):
                p = self.stage / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b'fixture')
                self.pack()
                with self.assertRaises(guard.PublicRuntimeError):
                    self.verify()
                p.unlink()
                # Empty forbidden directories are also rejected, remove fixture tree.
                for ancestor in list(p.parents):
                    if ancestor == self.stage:
                        break
                    try: ancestor.rmdir()
                    except OSError: break

    def test_sensitive_content_under_innocent_name_and_across_chunk_boundary(self):
        for marker in (b'-----BEGIN ' + b'PRIVATE KEY-----\n' + b'A' * 40, b'ghp_' + b'A' * 36):
            p = self.stage / 'client/assets/innocent.js'
            p.write_bytes(b'x' * (1024 * 1024 - 8) + marker)
            self.pack()
            with self.assertRaises(guard.PublicRuntimeError): self.verify()

    def test_crypto_parser_references_allowed_but_escaped_key_material_rejected(self):
        p = self.stage / 'client/assets/innocent.js'
        p.write_bytes(b"parser checks " + b'-----BEGIN ' + b'PRIVATE KEY-----')
        self.pack()
        self.verify()
        for separator in (bytes([92, 110]), bytes([92, 114, 92, 110])):
            p.write_bytes(b'-----BEGIN ' + b'PRIVATE KEY-----' + separator + b'A' * 40)
            self.pack()
            with self.assertRaises(guard.PublicRuntimeError): self.verify()

    def test_database_magic_header_but_not_library_constant_rejected(self):
        p = self.stage / 'client/assets/innocent.js'
        p.write_bytes(b'SQLite format 3\x00' + b'fixture')
        self.pack()
        with self.assertRaises(guard.PublicRuntimeError): self.verify()
        p.write_bytes(b'library constant: SQLite format 3\x00')
        self.pack()
        self.verify()

    def test_copy_origins_and_untracked_operator_rejected(self):
        for name in ('operations/backup.mjs', 'migrations/0000_schema.sql', 'node_modules/pkg/index.js', 'bin/node'):
            p = self.stage / name
            saved = p.read_bytes()
            p.write_bytes(b'drift')
            self.pack()
            with self.assertRaises(guard.PublicRuntimeError): self.verify()
            p.write_bytes(saved)
        (self.stage / 'operations/untracked.py').write_text('fixture')
        self.pack()
        with self.assertRaises(guard.PublicRuntimeError): self.verify()

    def test_duplicate_traversal_absolute_and_device_rejected(self):
        for name, kind in (('./server.mjs', tarfile.REGTYPE), ('../outside', tarfile.REGTYPE),
                           ('/outside', tarfile.REGTYPE), ('./client/device', tarfile.CHRTYPE)):
            item = tarfile.TarInfo(name)
            item.type = kind
            self.pack((item, b''))
            with self.assertRaises(guard.PublicRuntimeError): self.verify()

    def test_unsafe_link_and_link_parent_rejected(self):
        for target in ('../../outside', '/etc/passwd', '../pkg/missing.js', '../other/link'):
            for base in (self.stage, self.root):
                (base / 'node_modules/.bin').mkdir(exist_ok=True)
                p = base / 'node_modules/.bin/pkg'
                if p.is_symlink(): p.unlink()
                p.symlink_to(target)
            self.pack()
            with self.assertRaises(guard.PublicRuntimeError): self.verify()

    def test_archive_drift_incomplete_inventory_and_corruption_rejected(self):
        self.pack()
        (self.stage / 'client/omitted.js').write_text('uninspected')
        with self.assertRaises(guard.PublicRuntimeError): self.verify()
        (self.stage / 'client/omitted.js').unlink()
        (self.stage / 'server.mjs').write_text('changed after tar')
        with self.assertRaises(guard.PublicRuntimeError): self.verify()
        self.archive.write_bytes(b'bad gzip')
        with self.assertRaises(guard.PublicRuntimeError): self.verify()

    def test_limits_and_special_modes_rejected(self):
        self.pack()
        with patch.object(guard, 'MAX_MEMBERS', 2), self.assertRaises(guard.PublicRuntimeError): self.verify()
        with patch.object(guard, 'MAX_BYTES', 2), self.assertRaises(guard.PublicRuntimeError): self.verify()
        (self.stage / 'server.mjs').chmod(0o4755)
        self.pack()
        with self.assertRaises(guard.PublicRuntimeError): self.verify()


if __name__ == '__main__': unittest.main()
