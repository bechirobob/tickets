"""Exact Yorke Way release controls; only temporary Git/SQLite/service fixtures."""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import test_code_release as controls

release = controls.release
ROOT = Path(__file__).resolve().parents[2]
SQL = b"""-- Campaign-specific single opt-in consent. No previous audience is imported.
CREATE TABLE yorkeway_early_access (
  email TEXT PRIMARY KEY NOT NULL,
  id TEXT NOT NULL UNIQUE,
  guest_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'withdrawn')),
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  withdrawal_hash TEXT NOT NULL UNIQUE,
  withdrawn_at TEXT
);
CREATE INDEX yorkeway_early_access_status_idx ON yorkeway_early_access(status, email);
"""


class YorkewaySourceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name); previous = Path.cwd(); os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q'); self.git('config', 'user.name', 'Isolated release tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.YORKEWAY_APPLICATION_BLOBS)
        self.prerequisites = tuple(release.YORKEWAY_CONTROL_BLOBS)
        for name in {'package.json', 'package-lock.json', 'README.md', *release.YORKEWAY_CONTROL_FILES,
                     *self.prerequisites, *self.files, *release.YORKEWAY_MAIN_BLOBS}:
            self.write(name, 'original fixture ' + name)
        # SQL is new, not an old schema edit.
        (self.root / release.YORKEWAY_SCHEMA_PATH).unlink()
        self.live = self.commit()
        for name in release.YORKEWAY_MAIN_BLOBS: self.write(name, 'approved historical prerequisite ' + name)
        self.main = self.commit()
        for name in self.files: self.write(name, SQL if name == release.YORKEWAY_SCHEMA_PATH else 'reviewed app ' + name)
        self.snapshot = self.commit()
        self.app = self.pins(self.snapshot, self.files)
        self.git('checkout', '-q', self.main)
        self.operator = b'independent bounded operator\n'
        for name in self.prerequisites:
            self.write(name, self.git('show', self.snapshot + ':' + name) if name in release.YORKEWAY_SHARED_FILES
                       else 'reviewed prerequisite ' + name)
        for name in release.YORKEWAY_CONTROL_FILES: self.write(name, self.operator if name.endswith('code-release.py') else 'reviewed control tests')
        self.control = self.commit(); self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {'YORKEWAY_RELEASE_BASELINE': self.live, 'YORKEWAY_RELEASE_BASE_TREE': self.tree(self.live),
                  'YORKEWAY_MAIN_SNAPSHOT': self.main, 'YORKEWAY_MAIN_TREE': self.tree(self.main),
                  'YORKEWAY_APP_SNAPSHOT': self.snapshot, 'YORKEWAY_APP_TREE': self.tree(self.snapshot),
                  'YORKEWAY_MAIN_BLOBS': self.pins(self.main, release.YORKEWAY_MAIN_BLOBS),
                  'YORKEWAY_APPLICATION_BLOBS': self.app,
                  'YORKEWAY_CONTROL_BLOBS': self.pins(self.control, self.prerequisites),
                  '__file__': str(self.root / 'ops/vps/code-release.py')}
        for name, value in values.items():
            p = patch.object(release, name, value); p.start(); self.addCleanup(p.stop)
        p = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control); p.start(); self.addCleanup(p.stop)
        operator_blob = release.hashlib.sha1(b'blob ' + str(len(self.operator)).encode() + b'\0' + self.operator).hexdigest()
        p = patch.object(controls, 'YORKEWAY_OPERATOR_BLOB', operator_blob); p.start(); self.addCleanup(p.stop)

    def git(self, *args): return controls.checkout_git(self.root, *args).decode().strip()
    def tree(self, revision): return self.git('rev-parse', revision + '^{tree}')
    def pins(self, revision, paths): return {name: self.git('rev-parse', revision + ':' + name) for name in paths}
    def write(self, name, content):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode() if isinstance(content, str) else content); path.chmod(0o644)
        return path
    def commit(self):
        self.git('add', '-A'); self.git('commit', '-qm', 'isolated fixture'); return self.git('rev-parse', 'HEAD')
    def verify(self, source=None): return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_complete_independent_control_and_promotion_is_accepted(self):
        self.assertEqual(set(self.verify()), set(release.YORKEWAY_MAIN_BLOBS) | set(self.files)
                         | set(self.prerequisites) | release.YORKEWAY_CONTROL_FILES)

    def test_complete_c_and_p_test_families_and_partial_promotion_rejection(self):
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            self.assertIn('ops/vps/code-release.py', controls.checkout_source_family(self.root))
        self.write(self.files[0], 'unreviewed partial output'); self.commit()
        with self.assertRaisesRegex(AssertionError, 'partial or unreviewed'):
            controls.checkout_source_family(self.root)

    def test_each_application_and_control_prerequisite_byte_is_pinned(self):
        for name in (*self.files, *self.prerequisites, *release.YORKEWAY_CONTROL_FILES):
            self.git('checkout', '-q', self.candidate); self.write(name, 'unreviewed bytes'); self.commit()
            with self.subTest(name=name), self.assertRaises(release.ReleaseError): self.verify()

    def test_missing_unrelated_dependency_and_mode_changes_reject(self):
        for mutation in ('missing', 'extra', 'dependency', 'mode', 'symlink'):
            self.git('checkout', '-q', self.candidate)
            name = self.files[0]; path = self.root / name
            if mutation == 'missing': self.git('rm', name)
            elif mutation == 'extra': self.write('tests/unapproved.py', 'unreviewed')
            elif mutation == 'dependency': self.write('package-lock.json', 'unreviewed dependency')
            elif mutation == 'mode': path.chmod(0o755)
            else: path.unlink(); path.symlink_to('README.md')
            self.commit()
            with self.subTest(mutation=mutation), self.assertRaises(release.ReleaseError): self.verify()

    def test_own_source_and_unmerged_trusted_controls_reject(self):
        with patch.dict(os.environ, BECORE_TRUSTED=self.candidate, BECORE_TRUSTED_BASE=self.candidate):
            with self.assertRaisesRegex(release.ReleaseError, 'independent'): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.main)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_wrong_tree_pins_and_extended_scope_reject(self):
        for name in ('YORKEWAY_RELEASE_BASE_TREE', 'YORKEWAY_MAIN_TREE', 'YORKEWAY_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in ('YORKEWAY_CONTROL_FILES', 'YORKEWAY_APPLICATION_BLOBS', 'YORKEWAY_CONTROL_BLOBS'):
            original = getattr(release, name)
            value = original | {'extra'} if isinstance(original, set) else {**original, 'extra': 'f' * 40}
            with patch.object(release, name, value), self.assertRaisesRegex(release.ReleaseError, 'scope'): self.verify()

    def test_shared_ci_fixtures_are_only_the_two_identical_snapshot_outputs(self):
        for name in release.YORKEWAY_SHARED_FILES:
            self.assertEqual(release.YORKEWAY_CONTROL_BLOBS[name], release.YORKEWAY_APPLICATION_BLOBS[name])
            with patch.dict(release.YORKEWAY_CONTROL_BLOBS, {name: 'f' * 40}):
                with self.assertRaisesRegex(release.ReleaseError, 'scope'): self.verify()
        with patch.object(release, 'YORKEWAY_SHARED_FILES', release.YORKEWAY_SHARED_FILES | {'package-lock.json'}):
            with self.assertRaisesRegex(release.ReleaseError, 'scope'): self.verify()

    def test_promotion_requires_original_application_ancestry(self):
        copy = self.git('commit-tree', self.tree(self.candidate), '-p', self.control, '-m', 'copied without S')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy)

    def test_application_cannot_be_sneaked_into_independent_controls(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.snapshot):
            with self.assertRaisesRegex(release.ReleaseError, 'independent'): self.verify()

    def test_0070_cannot_inherit_another_release_family(self):
        self.git('checkout', '-q', self.main)
        self.write(release.YORKEWAY_SCHEMA_PATH, SQL); candidate = self.commit()
        with self.assertRaisesRegex(release.ReleaseError, 'exact release family'):
            release.vetted_changes(self.main, candidate)


class YorkewayMigrationTests(unittest.TestCase):
    def test_exact_sql_and_schema_are_independently_pinned(self):
        spec = release.yorkeway_migration_plan()[0]
        self.assertEqual(release.migration_plan([release.YORKEWAY_SCHEMA_PATH]), [spec])
        self.assertEqual(controls.release.hashlib.sha1(b'blob ' + str(len(SQL)).encode() + b'\0' + SQL).hexdigest(), spec['blob'])
        statements, rows = release.reviewed_migration(SQL, spec)
        self.assertEqual(len(statements), 2)
        self.assertEqual({r[1] for r in rows}, {'yorkeway_early_access', 'yorkeway_early_access_status_idx'})
        with self.assertRaises(release.ReleaseError): release.reviewed_migration(SQL + b'DELETE FROM orders;', spec)

    def test_backup_preserves_existing_rows_reapplication_and_drift_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); db = root / 'tickets.sqlite'
            with release.sqlite3.connect(db) as c:
                c.execute('CREATE TABLE orders (id TEXT)'); c.execute("INSERT INTO orders VALUES ('synthetic-order')")
            db.chmod(0o600)
            migration = [(release.yorkeway_migration_plan()[0], SQL)]
            first = release.migrate_database(db, root / 'first', migration)
            self.assertTrue(first['tablesPreservedOnRollback']); self.assertTrue(first['created'])
            with release.sqlite3.connect(db) as c:
                self.assertEqual(c.execute('SELECT * FROM orders').fetchall(), [('synthetic-order',)])
                self.assertEqual(c.execute('SELECT count(*) FROM yorkeway_early_access').fetchone(), (0,))
            self.assertFalse(release.migrate_database(db, root / 'second', migration)['created'])
            with release.sqlite3.connect(db) as c: c.execute('DROP INDEX yorkeway_early_access_status_idx')
            with self.assertRaisesRegex(release.ReleaseError, 'partial'):
                release.migrate_database(db, root / 'third', migration)


class YorkewayDeploymentTests(controls.DeploymentFixture):
    def setUp(self):
        super().setUp()
        p = patch.object(release, 'YORKEWAY_RELEASE_BASELINE', controls.OLD); p.start(); self.addCleanup(p.stop)
        p = patch.object(release, 'verify_room_mail_vps_service'); self.mail = p.start(); self.addCleanup(p.stop)
        state = self.root / 'var/lib/becore-tickets'; state.chmod(0o700)
        with release.sqlite3.connect(state / 'tickets.sqlite') as c:
            c.execute('CREATE TABLE orders (id TEXT)'); c.execute("INSERT INTO orders VALUES ('synthetic-order')")
        (state / 'tickets.sqlite').chmod(0o600)
        member = tarfile.TarInfo('migrations/0070_yorkeway_early_access.sql'); member.mode = 0o644
        self.make_archive(manifest={'revision': controls.NEW, 'dirty': False, 'node': 'v24.22.1'}, extra=(member, SQL))
        self.proof['changedFiles'] = sorted(set(release.YORKEWAY_MAIN_BLOBS) | set(release.YORKEWAY_APPLICATION_BLOBS)
                                          | set(release.YORKEWAY_CONTROL_BLOBS) | release.YORKEWAY_CONTROL_FILES)
        self.proof['migrations'] = release.yorkeway_migration_plan(); self.refresh_digests()

    def test_success_preserves_config_and_checks_mail_twice(self):
        result = self.deployment.transact()
        self.assertTrue(result['dataMigration']); self.assertEqual(self.mail.call_count, 2)
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)

    def test_flags_incomplete_or_duplicate_manifest_reject_before_mutation(self):
        for flags in ({'enable_crypto': True}, {'enable_first_host': True, 'first_host_account_id': '11111111-1111-4111-8111-111111111111'}):
            with self.subTest(flags=flags), self.assertRaisesRegex(release.ReleaseError, 'preserve'):
                self.new_deployment(**flags).preflight()
        for change in (self.proof['changedFiles'][:-1], self.proof['changedFiles'] * 2):
            self.proof['changedFiles'] = change; self.refresh_digests()
            with self.assertRaisesRegex(release.ReleaseError, 'complete source'): self.deployment.preflight()
        self.assertEqual(self.system.restarts, 0); self.assertFalse(self.deployment.snapshot.exists())

    def test_mail_prerequisite_failure_rejects_before_snapshot(self):
        self.mail.side_effect = release.ReleaseError('mail prerequisite changed')
        with self.assertRaisesRegex(release.ReleaseError, 'mail prerequisite'): self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists()); self.assertEqual(self.system.restarts, 0)

    def test_mail_drift_on_second_check_rolls_back_without_activating_candidate(self):
        self.mail.side_effect = [None, release.ReleaseError('mail prerequisite drift')]
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assertEqual(self.mail.call_count, 2)
        self.assert_restored()

    def test_wrong_packaged_node_metadata_refuses_activation(self):
        for node in ('v24.21.0', 'v24.22.0', None):
            self.make_archive(manifest={'revision': controls.NEW, 'dirty': False, 'node': node})
            self.refresh_digests()
            with self.subTest(node=node), self.assertRaisesRegex(release.ReleaseError, 'packaged Node'):
                self.deployment.unpack()
            import shutil
            shutil.rmtree(self.deployment.release)
        self.assertEqual(self.system.restarts, 0)

    def test_failed_activation_restores_old_code_but_preserves_additive_schema(self):
        self.system.fail = 'public'
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'): self.deployment.transact()
        self.assert_restored()
        with release.sqlite3.connect(self.root / 'var/lib/becore-tickets/tickets.sqlite') as c:
            self.assertEqual(c.execute('SELECT count(*) FROM yorkeway_early_access').fetchone(), (0,))
            self.assertEqual(c.execute('SELECT * FROM orders').fetchall(), [('synthetic-order',)])


class YorkewayStagedInventoryTests(unittest.TestCase):
    def test_complete_archive_and_missing_extra_mode_or_operator_mutations(self):
        for mutation in (None, 'missing', 'extra', 'mode', 'operator'):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in controls.YORKEWAY_STAGED_BASE:
                    path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes((ROOT / name).read_bytes()); path.chmod(0o644)
                target = root / 'ops/vps/inspect-mail-service-readonly.py'
                if mutation == 'missing': target.unlink()
                elif mutation == 'extra': (root / 'unreviewed').mkdir()
                elif mutation == 'mode': target.chmod(0o755)
                elif mutation == 'operator': (root / 'ops/vps/code-release.py').write_bytes(b'older or unreviewed operator')
                # Match the staged executing test path: no historical fallback
                # is available when this new suite's operator is replaced.
                with patch.object(controls, 'YORKEWAY_TEST_FILE', root / 'ops/vps/test_code_release.py'):
                    if mutation is None:
                        self.assertIn('ops/vps/code-release.py', controls.checkout_source_family(root))
                    else:
                        with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                            controls.checkout_source_family(root)


class YorkewayTransportTests(unittest.TestCase):
    def test_generic_transport_adds_only_the_exact_existing_sibling_helper(self):
        raw = (ROOT / '.github/workflows/tickets-code-release.yml').read_text()
        line = '''          tailscale ssh root@hermes "umask 022; cat > '$stage/inspect-mail-service-readonly.py'" < "$RUNNER_TEMP/tickets-operator/ops/vps/inspect-mail-service-readonly.py"\n'''
        self.assertEqual(raw.count(line), 1)
        self.assertLess(raw.index(line), raw.index("printf '%s' \"$FIRST_HOST_ACCOUNT_ID\""))
        self.assertEqual(controls.release.hashlib.sha1(b'blob ' + str(len(raw.encode())).encode() + b'\0' + raw.encode()).hexdigest(),
                         release.YORKEWAY_CONTROL_BLOBS['.github/workflows/tickets-code-release.yml'])
        release.load_room_mail_vps_inspector()



OWNER_PUSH_SQL = b"-- Only new signups capture existing opted-in owner devices. No historical backfill.\nCREATE TABLE yorkeway_owner_push_deliveries (\n  id TEXT PRIMARY KEY,\n  signup_id TEXT NOT NULL REFERENCES yorkeway_early_access(id) ON DELETE CASCADE,\n  subscription_id TEXT NOT NULL REFERENCES organizer_push_subscriptions(id) ON DELETE CASCADE,\n  account_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,\n  subscription_version TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n  attempts INTEGER NOT NULL DEFAULT 0,\n  lease_until TEXT,\n  claim TEXT,\n  completed_at TEXT,\n  outcome TEXT\n);\nCREATE UNIQUE INDEX yorkeway_owner_push_device ON yorkeway_owner_push_deliveries(signup_id,subscription_id);\nCREATE INDEX yorkeway_owner_push_pending ON yorkeway_owner_push_deliveries(completed_at,lease_until,created_at);\n"


class OwnerPushSourceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name); previous = Path.cwd(); os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q'); self.git('config', 'user.name', 'Isolated release tests')
        self.git('config', 'user.email', 'tests@example.invalid')
        self.files = tuple(release.OWNER_PUSH_APPLICATION_BLOBS)
        for name in {'package.json', 'package-lock.json', 'README.md', *release.OWNER_PUSH_CONTROL_FILES,
                     *self.files}:
            self.write(name, 'original fixture ' + name)
        # OWNER_PUSH_SQL is new, not an old schema edit.
        (self.root / release.OWNER_PUSH_SCHEMA_PATH).unlink()
        self.live = self.commit()
        self.main = self.live
        for name in self.files: self.write(name, OWNER_PUSH_SQL if name == release.OWNER_PUSH_SCHEMA_PATH else 'reviewed app ' + name)
        self.snapshot = self.commit()
        self.app = self.pins(self.snapshot, self.files)
        self.git('checkout', '-q', self.main)
        self.operator = b'independent bounded operator\n'
        for name in release.OWNER_PUSH_CONTROL_FILES: self.write(name, self.operator if name.endswith('code-release.py') else 'reviewed control tests')
        self.control = self.commit(); self.git('update-ref', 'refs/remotes/origin/main', self.control)
        self.git('merge', '--no-ff', '--no-commit', self.snapshot)
        self.candidate = self.commit()
        values = {'OWNER_PUSH_RELEASE_BASELINE': self.live, 'OWNER_PUSH_BASE_TREE': self.tree(self.live),
                  'OWNER_PUSH_APP_SNAPSHOT': self.snapshot, 'OWNER_PUSH_APP_TREE': self.tree(self.snapshot),
                  'OWNER_PUSH_APPLICATION_BLOBS': self.app,
                  '__file__': str(self.root / 'ops/vps/code-release.py')}
        for name, value in values.items():
            p = patch.object(release, name, value); p.start(); self.addCleanup(p.stop)
        p = patch.dict(os.environ, BECORE_TRUSTED_BASE=self.control); p.start(); self.addCleanup(p.stop)
        operator_blob = release.hashlib.sha1(b'blob ' + str(len(self.operator)).encode() + b'\0' + self.operator).hexdigest()
        p = patch.object(controls, 'OWNER_PUSH_OPERATOR_BLOB', operator_blob); p.start(); self.addCleanup(p.stop)
        test_blob = self.git('rev-parse', self.control + ':ops/vps/test_yorkeway_release.py')
        p = patch.object(controls, 'OWNER_PUSH_TEST_BLOB', test_blob); p.start(); self.addCleanup(p.stop)

    def git(self, *args): return controls.checkout_git(self.root, *args).decode().strip()
    def tree(self, revision): return self.git('rev-parse', revision + '^{tree}')
    def pins(self, revision, paths): return {name: self.git('rev-parse', revision + ':' + name) for name in paths}
    def write(self, name, content):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode() if isinstance(content, str) else content); path.chmod(0o644)
        return path
    def commit(self):
        self.git('add', '-A'); self.git('commit', '-qm', 'isolated fixture'); return self.git('rev-parse', 'HEAD')
    def verify(self, source=None): return release.vetted_changes(self.live, source or self.git('rev-parse', 'HEAD'))

    def test_complete_independent_control_and_promotion_is_accepted(self):
        self.assertEqual(set(self.verify()), set(self.files)
                         | release.OWNER_PUSH_CONTROL_FILES)

    def test_complete_c_and_p_test_families_and_partial_promotion_rejection(self):
        for revision in (self.control, self.candidate):
            self.git('checkout', '-q', revision)
            self.assertIn('ops/vps/code-release.py', controls.checkout_source_family(self.root))
        self.write(self.files[0], 'unreviewed partial output'); self.commit()
        with self.assertRaisesRegex(AssertionError, 'partial or unreviewed'):
            controls.checkout_source_family(self.root)

    def test_each_application_and_control_prerequisite_byte_is_pinned(self):
        for name in (*self.files, *release.OWNER_PUSH_CONTROL_FILES):
            self.git('checkout', '-q', self.candidate); self.write(name, 'unreviewed bytes'); self.commit()
            with self.subTest(name=name), self.assertRaises(release.ReleaseError): self.verify()

    def test_missing_unrelated_dependency_and_mode_changes_reject(self):
        for mutation in ('missing', 'extra', 'dependency', 'mode', 'symlink'):
            self.git('checkout', '-q', self.candidate)
            name = self.files[0]; path = self.root / name
            if mutation == 'missing': self.git('rm', name)
            elif mutation == 'extra': self.write('tests/unapproved.py', 'unreviewed')
            elif mutation == 'dependency': self.write('package-lock.json', 'unreviewed dependency')
            elif mutation == 'mode': path.chmod(0o755)
            else: path.unlink(); path.symlink_to('README.md')
            self.commit()
            with self.subTest(mutation=mutation), self.assertRaises(release.ReleaseError): self.verify()

    def test_own_source_and_unmerged_trusted_controls_reject(self):
        with patch.dict(os.environ, BECORE_TRUSTED=self.candidate, BECORE_TRUSTED_BASE=self.candidate):
            with self.assertRaisesRegex(release.ReleaseError, 'independent'): self.verify()
        self.git('update-ref', 'refs/remotes/origin/main', self.main)
        with self.assertRaises(subprocess.CalledProcessError): self.verify()

    def test_wrong_tree_pins_and_extended_scope_reject(self):
        for name in ('OWNER_PUSH_BASE_TREE', 'OWNER_PUSH_APP_TREE'):
            with patch.object(release, name, 'f' * 40), self.assertRaises(release.ReleaseError): self.verify()
        for name in ('OWNER_PUSH_CONTROL_FILES', 'OWNER_PUSH_APPLICATION_BLOBS'):
            original = getattr(release, name)
            value = original | {'extra'} if isinstance(original, set) else {**original, 'extra': 'f' * 40}
            with patch.object(release, name, value), self.assertRaisesRegex(release.ReleaseError, 'scope'): self.verify()

    def test_promotion_requires_original_application_ancestry(self):
        copy = self.git('commit-tree', self.tree(self.candidate), '-p', self.control, '-m', 'copied without S')
        with self.assertRaises(subprocess.CalledProcessError): self.verify(copy)

    def test_application_cannot_be_sneaked_into_independent_controls(self):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=self.snapshot):
            with self.assertRaisesRegex(release.ReleaseError, 'independent'): self.verify()

    def test_0071_cannot_inherit_another_release_family(self):
        self.git('checkout', '-q', self.main)
        self.write('README.md', 'another baseline'); different = self.commit()
        self.write(release.OWNER_PUSH_SCHEMA_PATH, OWNER_PUSH_SQL); candidate = self.commit()
        with self.assertRaisesRegex(release.ReleaseError, 'exact release family'):
            release.vetted_changes(different, candidate)


class OwnerPushMigrationTests(unittest.TestCase):
    def test_exact_sql_and_schema_are_independently_pinned(self):
        spec = release.owner_push_migration_plan()[0]
        self.assertEqual(release.migration_plan([release.OWNER_PUSH_SCHEMA_PATH]), [spec])
        self.assertEqual(controls.release.hashlib.sha1(b'blob ' + str(len(OWNER_PUSH_SQL)).encode() + b'\0' + OWNER_PUSH_SQL).hexdigest(), spec['blob'])
        statements, rows = release.reviewed_migration(OWNER_PUSH_SQL, spec)
        self.assertEqual(len(statements), 3)
        self.assertEqual({r[1] for r in rows}, {'yorkeway_owner_push_deliveries', 'yorkeway_owner_push_device', 'yorkeway_owner_push_pending'})
        with self.assertRaises(release.ReleaseError): release.reviewed_migration(OWNER_PUSH_SQL + b'DELETE FROM orders;', spec)

    def test_backup_preserves_existing_rows_reapplication_and_drift_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); db = root / 'tickets.sqlite'
            with release.sqlite3.connect(db) as c:
                c.execute('CREATE TABLE orders (id TEXT)'); c.execute("INSERT INTO orders VALUES ('synthetic-order')")
            db.chmod(0o600)
            migration = [(release.owner_push_migration_plan()[0], OWNER_PUSH_SQL)]
            first = release.migrate_database(db, root / 'first', migration)
            self.assertTrue(first['tablesPreservedOnRollback']); self.assertTrue(first['created'])
            with release.sqlite3.connect(db) as c:
                self.assertEqual(c.execute('SELECT * FROM orders').fetchall(), [('synthetic-order',)])
                self.assertEqual(c.execute('SELECT count(*) FROM yorkeway_owner_push_deliveries').fetchone(), (0,))
            self.assertFalse(release.migrate_database(db, root / 'second', migration)['created'])
            with release.sqlite3.connect(db) as c: c.execute('DROP INDEX yorkeway_owner_push_pending')
            with self.assertRaisesRegex(release.ReleaseError, 'partial'):
                release.migrate_database(db, root / 'third', migration)


class OwnerPushDeploymentTests(controls.DeploymentFixture):
    def setUp(self):
        super().setUp()
        p = patch.object(release, 'OWNER_PUSH_RELEASE_BASELINE', controls.OLD); p.start(); self.addCleanup(p.stop)
        p = patch.object(release, 'verify_room_mail_vps_service'); self.mail = p.start(); self.addCleanup(p.stop)
        state = self.root / 'var/lib/becore-tickets'; state.chmod(0o700)
        with release.sqlite3.connect(state / 'tickets.sqlite') as c:
            c.execute('CREATE TABLE orders (id TEXT)'); c.execute("INSERT INTO orders VALUES ('synthetic-order')")
        (state / 'tickets.sqlite').chmod(0o600)
        member = tarfile.TarInfo('migrations/0071_yorkeway_owner_push.sql'); member.mode = 0o644
        self.make_archive(manifest={'revision': controls.NEW, 'dirty': False, 'node': 'v24.22.1'}, extra=(member, OWNER_PUSH_SQL))
        self.proof['changedFiles'] = sorted(set(release.OWNER_PUSH_APPLICATION_BLOBS) | release.OWNER_PUSH_CONTROL_FILES)
        self.proof['migrations'] = release.owner_push_migration_plan(); self.refresh_digests()

    def test_success_preserves_config_and_checks_mail_twice(self):
        result = self.deployment.transact()
        self.assertTrue(result['dataMigration']); self.assertEqual(self.mail.call_count, 2)
        self.assertEqual(self.deployment.config.read_bytes(), self.config_before)

    def test_flags_incomplete_or_duplicate_manifest_reject_before_mutation(self):
        for flags in ({'enable_crypto': True}, {'enable_first_host': True, 'first_host_account_id': '11111111-1111-4111-8111-111111111111'}):
            with self.subTest(flags=flags), self.assertRaisesRegex(release.ReleaseError, 'preserve'):
                self.new_deployment(**flags).preflight()
        for change in (self.proof['changedFiles'][:-1], self.proof['changedFiles'] * 2):
            self.proof['changedFiles'] = change; self.refresh_digests()
            with self.assertRaisesRegex(release.ReleaseError, 'complete source'): self.deployment.preflight()
        self.assertEqual(self.system.restarts, 0); self.assertFalse(self.deployment.snapshot.exists())

    def test_mail_prerequisite_failure_rejects_before_snapshot(self):
        self.mail.side_effect = release.ReleaseError('mail prerequisite changed')
        with self.assertRaisesRegex(release.ReleaseError, 'mail prerequisite'): self.deployment.preflight()
        self.assertFalse(self.deployment.snapshot.exists()); self.assertEqual(self.system.restarts, 0)

    def test_mail_drift_on_second_check_rolls_back_without_activating_candidate(self):
        self.mail.side_effect = [None, release.ReleaseError('mail prerequisite drift')]
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'):
            self.deployment.transact()
        self.assertEqual(self.mail.call_count, 2)
        self.assert_restored()

    def test_wrong_packaged_node_metadata_refuses_activation(self):
        for node in ('v24.21.0', 'v24.22.0', None):
            self.make_archive(manifest={'revision': controls.NEW, 'dirty': False, 'node': node})
            self.refresh_digests()
            with self.subTest(node=node), self.assertRaisesRegex(release.ReleaseError, 'packaged Node'):
                self.deployment.unpack()
            import shutil
            shutil.rmtree(self.deployment.release)
        self.assertEqual(self.system.restarts, 0)

    def test_failed_activation_restores_old_code_but_preserves_additive_schema(self):
        self.system.fail = 'public'
        with self.assertRaisesRegex(release.ReleaseError, 'previous release restored'): self.deployment.transact()
        self.assert_restored()
        with release.sqlite3.connect(self.root / 'var/lib/becore-tickets/tickets.sqlite') as c:
            self.assertEqual(c.execute('SELECT count(*) FROM yorkeway_owner_push_deliveries').fetchone(), (0,))
            self.assertEqual(c.execute('SELECT * FROM orders').fetchall(), [('synthetic-order',)])


class OwnerPushStagedInventoryTests(unittest.TestCase):
    def test_complete_archive_and_missing_extra_mode_or_operator_mutations(self):
        for mutation in (None, 'missing', 'extra', 'mode', 'operator'):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in controls.OWNER_PUSH_STAGED_BASE:
                    path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes((ROOT / name).read_bytes()); path.chmod(0o644)
                target = root / 'ops/vps/inspect-mail-service-readonly.py'
                if mutation == 'missing': target.unlink()
                elif mutation == 'extra': (root / 'unreviewed').mkdir()
                elif mutation == 'mode': target.chmod(0o755)
                elif mutation == 'operator': (root / 'ops/vps/code-release.py').write_bytes(b'older or unreviewed operator')
                # Match the staged executing test path: no historical fallback
                # is available when this new suite's operator is replaced.
                with patch.object(controls, 'OWNER_PUSH_TEST_FILE', root / 'ops/vps/test_code_release.py'):
                    if mutation is None:
                        self.assertIn('ops/vps/code-release.py', controls.checkout_source_family(root))
                    else:
                        with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                            controls.checkout_source_family(root)


if __name__ == '__main__': unittest.main()
