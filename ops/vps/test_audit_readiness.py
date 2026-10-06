"""Read-only diagnostics contract tests using disposable isolated SQLite files."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, MagicMock
from retention import clean

spec = importlib.util.spec_from_file_location('audit_readiness', Path(__file__).with_name('audit-readiness.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class ReadinessTests(unittest.TestCase):
    def test_deployment_lock_observation_reports_permissions_without_content_or_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'lock'
            path.write_text('private-lock-content-sentinel')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                real_stat = os.stat
                def fixed_path_stat(name, *, follow_symlinks):
                    self.assertEqual(name, '/run/lock/becore-tickets-deploy.lock')
                    self.assertFalse(follow_symlinks)
                    return real_stat(path, follow_symlinks=False)
                for mode in (0o600, 0o644):
                    path.chmod(mode)
                    before = os.fstat(fd)
                    with patch.object(audit.os, 'stat', side_effect=fixed_path_stat), \
                         patch.object(audit.os, 'open', side_effect=AssertionError('No new file open')), \
                         patch.object(audit.os, 'read', side_effect=AssertionError('No content read')), \
                         patch.object(audit.os, 'write', side_effect=AssertionError('No write')), \
                         patch.object(audit.os, 'chmod', side_effect=AssertionError('No mode change')), \
                         patch.object(audit.os, 'fchmod', side_effect=AssertionError('No mode change')):
                        result = audit.deployment_lock_metadata(fd)
                    self.assertTrue(result['stable_identity'])
                    self.assertEqual(result['descriptor'], result['path'])
                    self.assertEqual(result['path'], {'uid': before.st_uid, 'gid': before.st_gid,
                        'mode': oct(mode), 'type': 'regular', 'nlink': 1, 'size_bytes': before.st_size})
                    self.assertNotIn('private-lock-content', json.dumps(result))
                    self.assertEqual(os.fstat(fd), before)
            finally:
                os.close(fd)

    def test_deployment_lock_identity_drift_and_symlink_are_reported_without_following(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'lock'
            path.touch()
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                real_stat = os.stat
                original = Path(folder) / 'old-lock'
                path.rename(original)
                for symlink in (False, True):
                    if symlink:
                        path.symlink_to(original)
                    else:
                        path.touch()
                    with patch.object(audit.os, 'stat', side_effect=lambda name, **kwargs: real_stat(path, **kwargs)):
                        result = audit.deployment_lock_metadata(fd)
                    self.assertFalse(result['stable_identity'])
                    self.assertEqual(result['descriptor']['type'], 'regular')
                    self.assertEqual(result['path']['type'], 'symlink' if symlink else 'regular')
                    path.unlink()
            finally:
                os.close(fd)

    def test_deployment_lock_stat_failure_uses_existing_secret_suppression(self):
        output = io.StringIO()
        with patch.object(audit.os, 'fstat', side_effect=OSError('private-lock-secret-sentinel')), \
             audit.contextlib.redirect_stderr(output):
            try:
                audit.deployment_lock_metadata(123)
            except Exception as error:
                audit.report_readiness_failure(error)
        self.assertNotIn('private-lock-secret-sentinel', output.getvalue())
        self.assertIn('sensitive details suppressed', output.getvalue())

    def test_stopped_release_attempt_checks_only_two_fixed_paths_without_contents(self):
        paths = ('/var/lib/becore-tickets-handover/code-release-37528616045-1',
                 '/srv/becore-tickets/releases/9dd3b8fde2841d0d72422a221d1b25319b8474b7')
        with patch.object(audit.os, 'stat', side_effect=FileNotFoundError('private-sentinel')) as checked, \
             patch.object(audit.os, 'open', side_effect=AssertionError('No content open')):
            result = audit.stopped_release_attempt_metadata()
        self.assertEqual([call.args[0] for call in checked.call_args_list], list(paths))
        self.assertTrue(all(call.kwargs == {'follow_symlinks': False} for call in checked.call_args_list))
        self.assertEqual(result, {'snapshot': {'exists': False, 'type': 'absent'}, 'candidate': {'exists': False, 'type': 'absent'}})
        self.assertNotIn('private-sentinel', json.dumps(result))
        with patch.object(audit.os, 'stat', side_effect=[SimpleNamespace(st_mode=audit.stat.S_IFDIR | 0o700),
                                                     SimpleNamespace(st_mode=audit.stat.S_IFLNK | 0o777)]):
            result = audit.stopped_release_attempt_metadata()
        self.assertEqual(result, {'snapshot': {'exists': True, 'type': 'directory'}, 'candidate': {'exists': True, 'type': 'symlink'}})

    def test_secret_values_never_returned(self):
        data = {k: 'private-test-value' for k in audit.SECRET_NAMES}
        data.update(ENVIRONMENT='production', SEEV_ENABLED='true', SEEV_ENVIRONMENT='production')
        result = audit.configuration_summary(data)
        self.assertNotIn('private-test-value', json.dumps(result))
        self.assertTrue(all(result['present'].values()))
        self.assertTrue(result['production'])

    def test_domain_read_is_fixed_target_and_never_returns_credentials(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"data":[{"name":"becoreops.com","status":"verified"},{"name":"unrelated.test","status":"failed"}]}'
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(audit.urllib.request, 'build_opener', return_value=opener):
            result = audit.resend_domain_summary({'RESEND_API_KEY':'private-key', 'EMAIL_FROM':'BeCore Tickets <tickets@becoreops.com>'})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.resend.com/domains?limit=100')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(result['status'], 'verified')
        self.assertNotIn('private-key', json.dumps(result))
        self.assertNotIn('unrelated.test', json.dumps(result))
        self.assertFalse(result['quota_verified'])

    def test_send_only_key_rejection_stays_unverified_without_retry(self):
        opener = MagicMock()
        opener.open.side_effect = audit.urllib.error.HTTPError('https://api.resend.com/domains',403,'hidden',None,None)
        with patch.object(audit.urllib.request, 'build_opener', return_value=opener):
            result = audit.resend_domain_summary({'RESEND_API_KEY':'private-key','EMAIL_FROM':'tickets@becoreops.com'})
        self.assertEqual(result['reason'], 'metadata_access_denied')
        self.assertEqual(opener.open.call_count, 1)
        self.assertNotIn('hidden', json.dumps(result))

    def test_database_observation_preserves_rows_and_omits_personal_data(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tickets.sqlite'
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE delivery_events(status TEXT, recipient TEXT); INSERT INTO delivery_events VALUES('failed','private@example.test'); CREATE TABLE background_job_health(job_key TEXT,started_at TEXT,finished_at TEXT,last_success_at TEXT,last_failure_at TEXT,failure_count INTEGER);")
            db.commit(); db.close()
            before = path.read_bytes()
            result = audit.inspect_database(path, True)
            self.assertEqual(result['counts']['delivery_events']['failed'], 1)
            self.assertTrue(result['quick_check_ok'])
            self.assertNotIn('private@example.test', json.dumps(result))
            self.assertEqual(path.read_bytes(), before)

    def test_owner_count_and_guard_metadata_are_aggregate_only(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tickets.sqlite'
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE staff_accounts(role TEXT,status TEXT,email TEXT); INSERT INTO staff_accounts VALUES('owner','active','private@example.test'); CREATE TRIGGER staff_last_active_owner_update_guard BEFORE UPDATE ON staff_accounts BEGIN SELECT 1; END;")
            db.commit(); db.close()
            result = audit.inspect_database(path, True)
            self.assertEqual(result['active_owner_count'], 1)
            self.assertTrue(result['owner_update_guard_present'])
            self.assertNotIn('private@example.test', json.dumps(result))

    def test_queue_overdue_counts_without_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'operations.sqlite'
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE delivery_queue(available INTEGER, lease INTEGER, body TEXT); INSERT INTO delivery_queue VALUES(1,NULL,'secret payload');")
            db.commit(); db.close()
            result = audit.inspect_database(path)
            self.assertEqual(result['overdue'], 1)
            self.assertNotIn('secret payload', json.dumps(result))


class ReleaseRetentionMetadataTests(unittest.TestCase):
    NOW = 2000000

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.home = Path(self.folder.name)
        self.releases = self.home / 'releases'
        self.releases.mkdir()
        home = patch.object(audit, 'HOME', self.home)
        home.start(); self.addCleanup(home.stop)
        clock = patch.object(audit.time, 'time', return_value=self.NOW)
        clock.start(); self.addCleanup(clock.stop)

    def release(self, number, age):
        path = self.releases / format(number, '040x')
        path.mkdir()
        os.utime(path, (self.NOW - age, self.NOW - age))
        return path

    def point(self, current, previous):
        (self.home / 'current').symlink_to(current)
        (self.home / 'previous').symlink_to(previous)

    def test_stat_only_snapshot_keeps_paths_ages_and_existing_state(self):
        current = self.release(1, 3600)
        previous = self.release(2, 72 * 3600)
        private = previous / 'release.json'
        private.write_text('private content must never be opened')
        os.utime(previous, (self.NOW - 72 * 3600,) * 2)
        self.point(Path('releases') / current.name, previous)
        paths = [self.home, self.releases, current, previous, private, self.home / 'current', self.home / 'previous']
        before = [(p.lstat().st_ino, p.lstat().st_mtime_ns, p.lstat().st_ctime_ns, p.lstat().st_mode) for p in paths]
        with patch('builtins.open', side_effect=AssertionError('Content read')), \
             patch.object(audit.os, 'open', side_effect=AssertionError('File open')), \
             patch.object(audit.os, 'read', side_effect=AssertionError('Content read')), \
             patch.object(Path, 'read_text', side_effect=AssertionError('Content read')), \
             patch.object(Path, 'read_bytes', side_effect=AssertionError('Content read')), \
             patch.object(audit.subprocess, 'check_output', side_effect=AssertionError('Command execution')):
            result = audit.release_retention_metadata()
        after = [(p.lstat().st_ino, p.lstat().st_mtime_ns, p.lstat().st_ctime_ns, p.lstat().st_mode) for p in paths]
        self.assertEqual(before, after)
        self.assertNotIn('private content', json.dumps(result))
        self.assertEqual(result['pointers']['previous']['resolved_path'], str(previous))
        self.assertEqual(result['pointers']['previous']['mtime_epoch'], self.NOW - 72 * 3600)
        self.assertEqual(result['pointers']['previous']['age_seconds'], 72 * 3600)
        self.assertFalse(result['both_pointers_within_47h_release_guard'])
        self.assertTrue(result['pointers']['previous']['protected_now'])
        self.assertTrue(result['pointers']['previous']['protected_after_one_newer_release_and_pointer_rotation'])
        self.assertTrue(result['metadata_only'])
        self.assertFalse(result['snapshot_atomic'])
        self.assertFalse(result['host_retention_policy_verified'])

    def test_old_previous_loses_protection_when_pushed_out_of_newest_three(self):
        current = self.release(1, 3600)
        self.release(2, 2 * 3600)
        previous = self.release(3, 72 * 3600)
        self.point(current, previous)
        result = audit.release_retention_metadata()
        old = result['pointers']['previous']
        self.assertEqual((old['newest_rank_min'], old['newest_rank_max']), (3, 3))
        self.assertTrue(old['protected_now'])
        self.assertFalse(old['protected_after_one_newer_release_and_pointer_rotation'])
        self.assertTrue(old['older_than_48h_retention_grace'])
        self.assertTrue(result['pointers']['current']['protected_after_one_newer_release_and_pointer_rotation'])

    def test_projection_matches_retention_on_disposable_release_directories(self):
        current = self.release(1, 3600)
        previous = self.release(2, 72 * 3600)
        self.point(current, previous)
        for previous_rank in (2, 3):
            with self.subTest(previous_rank=previous_rank):
                predicted = audit.release_retention_metadata()['pointers']['previous']
                candidate = self.release(3, 0)
                (self.home / 'previous').unlink()
                (self.home / 'previous').symlink_to(current)
                (self.home / 'current').unlink()
                (self.home / 'current').symlink_to(candidate)
                clean(self.home, now=self.NOW)
                self.assertEqual(previous.exists(), predicted['protected_after_one_newer_release_and_pointer_rotation'])
                if previous_rank == 2:
                    (self.home / 'current').unlink()
                    (self.home / 'current').symlink_to(current)
                    (self.home / 'previous').unlink()
                    (self.home / 'previous').symlink_to(previous)
                    candidate.rmdir()
                    self.release(4, 2 * 3600)

    def test_47h_guard_and_48h_deletion_boundaries_are_strict(self):
        current = self.release(1, 47 * 3600 - 1)
        previous = self.release(2, 47 * 3600)
        boundary = self.release(3, 48 * 3600)
        old = self.release(4, 48 * 3600 + 1)
        self.point(current, previous)
        result = audit.release_retention_metadata()
        items = {item['revision']: item for item in result['directories']}
        self.assertTrue(items[current.name]['within_47h_release_guard'])
        self.assertFalse(items[previous.name]['within_47h_release_guard'])
        self.assertFalse(items[boundary.name]['older_than_48h_retention_grace'])
        self.assertTrue(items[old.name]['older_than_48h_retention_grace'])
        self.assertFalse(items[old.name]['protected_now'])

    def test_equal_mtimes_report_uncertain_cutoff(self):
        current = self.release(1, 3600)
        previous = self.release(2, 72 * 3600)
        peer = self.release(3, 72 * 3600)
        self.point(current, previous)
        result = audit.release_retention_metadata()
        self.assertIsNone(result['pointers']['previous']['protected_after_one_newer_release_and_pointer_rotation'])
        self.release(4, 72 * 3600)
        result = audit.release_retention_metadata()
        peer_item = next(item for item in result['directories'] if item['revision'] == peer.name)
        self.assertEqual((peer_item['newest_rank_min'], peer_item['newest_rank_max']), (2, 4))
        self.assertIsNone(peer_item['protected_now'])
        self.assertTrue(result['pointers']['previous']['protected_now'])

    def test_same_current_and_previous_stays_pointer_protected_after_rotation(self):
        old = self.release(1, 72 * 3600)
        for number in (2, 3, 4):
            self.release(number, number * 3600)
        self.point(old, old)
        result = audit.release_retention_metadata()
        self.assertEqual(result['pointers']['previous']['pointer_names'], ['current', 'previous'])
        self.assertTrue(result['pointers']['previous']['protected_after_one_newer_release_and_pointer_rotation'])

    def test_inventory_ignores_unmanaged_names_files_and_symlinks_without_echoing_them(self):
        current = self.release(1, 1)
        self.point(current, current)
        (self.releases / 'private-customer-name').mkdir()
        (self.releases / ('2' * 40)).symlink_to(current)
        (self.releases / ('3' * 40)).write_text('private file')
        result = audit.release_retention_metadata()
        self.assertEqual(result['release_count'], 1)
        self.assertNotIn('private', json.dumps(result))
        self.assertNotIn('2' * 40, json.dumps(result))
        self.assertNotIn('3' * 40, json.dumps(result))

    def test_entry_bound_includes_ignored_entries(self):
        current = self.release(1, 1)
        self.point(current, current)
        for number in range(audit.MAX_RELEASE_ENTRIES - 1):
            (self.releases / f'ignored-{number}').mkdir()
        result = audit.release_retention_metadata()
        self.assertEqual(result['release_count'], 1)
        (self.releases / 'one-too-many').mkdir()
        with self.assertRaises(AssertionError):
            audit.release_retention_metadata()

    def test_unsafe_pointer_targets_are_rejected(self):
        current = self.release(1, 1)
        outside = self.home / 'outside-private'
        outside.mkdir()
        alias = self.releases / ('2' * 40)
        alias.symlink_to(current)
        plain_file = self.releases / ('3' * 40)
        plain_file.touch()
        (self.home / 'current').symlink_to(current)
        for target in (outside, alias, plain_file, self.releases / ('4' * 40),
                       self.releases / 'invalid-revision', Path('releases/../releases') / current.name):
            with self.subTest(target=target):
                pointer = self.home / 'previous'
                pointer.symlink_to(target)
                try:
                    with self.assertRaises((AssertionError, FileNotFoundError)):
                        audit.release_retention_metadata()
                finally:
                    pointer.unlink()
        (self.home / 'previous').mkdir()
        with self.assertRaises(AssertionError):
            audit.release_retention_metadata()

    def test_symlink_release_root_is_rejected(self):
        actual = self.home / 'actual'
        self.releases.rename(actual)
        self.releases.symlink_to(actual)
        with self.assertRaises(AssertionError):
            audit.release_retention_metadata()


class RetentionPolicyAttestationTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.home = Path(folder.name) / 'home'
        self.release = self.home / 'releases' / ('1' * 40)
        operations = self.release / 'operations'
        operations.mkdir(parents=True)
        (self.home / 'current').symlink_to(self.release)
        self.units = Path(folder.name) / 'units'
        self.units.mkdir()
        self.paths = {}
        for name, expected in audit.RETENTION_SHA256.items():
            content = Path(__file__).with_name(name).read_bytes()
            self.assertEqual(audit.hashlib.sha256(content).hexdigest(), expected)
            path = (operations if name == 'retention.py' else self.units) / name
            path.write_bytes(content)
            self.paths[name] = path
        for key, value in (('HOME', self.home), ('SYSTEMD_UNITS', self.units)):
            patcher = patch.object(audit, key, value)
            patcher.start(); self.addCleanup(patcher.stop)
        # Disposable fixtures need no privileged ownership changes. Preserve real
        # inode/timestamps and fixture-tree modes while modeling root ownership.
        # Only ancestors outside the fixture model the production secure path;
        # hosted runners normally put the fixture beneath world-writable /tmp.
        self.owner_overrides = {}
        real_stat, real_fstat = os.stat, os.fstat
        ancestor_ids = {(p.stat().st_dev, p.stat().st_ino) for p in Path(folder.name).parents}
        self.ancestor_modes = {}
        def metadata(value):
            fields = ('st_dev', 'st_ino', 'st_mode', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')
            modeled = {key: getattr(value, key) for key in fields}
            key = (value.st_dev, value.st_ino)
            if key in ancestor_ids:
                modeled['st_mode'] = self.ancestor_modes.get(key, value.st_mode) & ~0o7022
            return SimpleNamespace(**modeled,
                                   st_uid=self.owner_overrides.get(value.st_ino, 0))
        self.ancestor_ids = ancestor_ids
        for key, real in (('stat', real_stat), ('fstat', real_fstat)):
            patcher = patch.object(audit.os, key, side_effect=lambda *args, _real=real, **kwargs: metadata(_real(*args, **kwargs)))
            patcher.start(); self.addCleanup(patcher.stop)
        self.properties = {}
        for name in ('becore-tickets-retention.service', 'becore-tickets-retention.timer'):
            self.properties[name] = {'Id': name, 'LoadState': 'loaded', 'FragmentPath': str(self.units / name),
                                     'SourcePath': '', 'DropInPaths': '', 'NeedDaemonReload': 'no', 'Transient': 'no'}
        self.properties['becore-tickets-retention.service'].update(
            Type='oneshot', ExecStart='{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 '
            + str(self.home / 'current/operations/retention.py')
            + ' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }',
            ExecStartPre='', ExecStartPost='', ExecCondition='', ExecStop='', ExecStopPost='', ExecReload='')
        self.properties['becore-tickets-retention.timer']['Unit'] = 'becore-tickets-retention.service'
        def unit_output(*args):
            self.assertEqual(args[:2], ('systemctl', 'show'))
            self.assertIn(args[2], self.properties)
            self.assertEqual(args[3], '--no-pager')
            self.assertEqual(args[4], '--all')
            self.assertEqual(set(args[5].removeprefix('--property=').split(',')), set(self.properties[args[2]]))
            return '\n'.join(f'{key}={value}' for key, value in self.properties[args[2]].items())
        self.unit_output = unit_output
        patcher = patch.object(audit, 'run', side_effect=unit_output)
        self.run = patcher.start(); self.addCleanup(patcher.stop)

    def test_exact_reviewed_hashes_and_loaded_units_attest_without_contents(self):
        with patch.object(audit.os, 'open', wraps=os.open) as opened:
            result = audit.retention_policy_attestation()
        file_opens = [call.args[0] for call in opened.call_args_list if not call.args[1] & os.O_DIRECTORY]
        self.assertEqual(file_opens, list(audit.RETENTION_SHA256))
        self.assertTrue(result['host_retention_policy_verified'])
        self.assertFalse(result['snapshot_atomic'])
        self.assertEqual(self.run.call_count, 4)
        self.assertEqual(set(result['files']), set(audit.RETENTION_SHA256))
        self.assertNotIn('shutil.rmtree', json.dumps(result))
        self.assertNotIn('ExecStart=', json.dumps(result))
        for name, item in result['files'].items():
            self.assertEqual(item['sha256'], audit.RETENTION_SHA256[name])
            self.assertEqual(item['path'], str(self.paths[name]))
            self.assertEqual(item['uid'], 0)

    def test_modified_policy_hash_stays_unverified_and_never_echoes_content(self):
        self.paths['retention.py'].write_text('private unexpected file content')
        result = audit.retention_policy_attestation()
        self.assertFalse(result['host_retention_policy_verified'])
        self.assertFalse(result['files']['retention.py']['matches_reviewed'])
        self.assertNotIn('private unexpected', json.dumps(result))

    def test_fixture_ancestor_model_handles_hosted_runner_sticky_tmp(self):
        self.ancestor_modes.update({key: audit.stat.S_IFDIR | 0o1777 for key in self.ancestor_ids})
        self.assertTrue(audit.retention_policy_attestation()['host_retention_policy_verified'])
        # The normalization must never sanitize permissions inside the fixture.
        self.release.chmod(0o777)
        with self.assertRaises(AssertionError):
            audit.retention_policy_attestation()

    def test_loaded_unit_drift_never_attests_or_echoes_values(self):
        service = self.properties['becore-tickets-retention.service']
        for key, value in (('FragmentPath', '/private/unreviewed.service'), ('SourcePath', '/private/source'),
                           ('DropInPaths', '/private/override.conf'), ('NeedDaemonReload', 'yes'),
                           ('Transient', 'yes'), ('LoadState', 'error'), ('ExecStartPre', '/private/command'),
                           ('ExecStart', service['ExecStart'] + ' { private extra command }')):
            with self.subTest(key=key):
                original = service[key]
                service[key] = value
                try:
                    result = audit.retention_policy_attestation()
                    self.assertFalse(result['host_retention_policy_verified'])
                    self.assertNotIn('private', json.dumps(result))
                finally:
                    service[key] = original
        self.properties['becore-tickets-retention.timer']['Unit'] = 'unreviewed.service'
        self.assertFalse(audit.retention_policy_attestation()['host_retention_policy_verified'])

    def test_unsafe_owner_modes_symlinks_and_hardlinks_are_rejected_before_content_read(self):
        path = self.paths['retention.py']
        mode = path.stat().st_mode & 0o777
        for bad_mode in (0o666, 0o664, 0o4755):
            with self.subTest(mode=bad_mode):
                path.chmod(bad_mode)
                with patch.object(audit.os, 'read', side_effect=AssertionError('No content read')) as read:
                    with self.assertRaises(AssertionError):
                        audit.retention_policy_attestation()
                    read.assert_not_called()
        path.chmod(mode)
        self.owner_overrides[path.stat().st_ino] = 1000
        with patch.object(audit.os, 'read') as read:
            with self.assertRaises(AssertionError):
                audit.retention_policy_attestation()
            read.assert_not_called()
        self.owner_overrides.clear()
        original = path.with_name('unapproved.py')
        path.rename(original)
        for hardlink in (False, True):
            with self.subTest(hardlink=hardlink):
                if hardlink:
                    path.hardlink_to(original)
                else:
                    path.symlink_to(original)
                try:
                    with patch.object(audit.os, 'read') as read:
                        with self.assertRaises((AssertionError, OSError)):
                            audit.retention_policy_attestation()
                        read.assert_not_called()
                finally:
                    path.unlink()

    def test_unsafe_parent_and_pointer_are_rejected(self):
        self.release.chmod(0o777)
        with patch.object(audit.os, 'read') as read:
            with self.assertRaises(AssertionError):
                audit.retention_policy_attestation()
            read.assert_not_called()
        self.release.chmod(0o755)
        pointer = self.home / 'current'
        pointer.unlink(); pointer.symlink_to(self.units)
        with self.assertRaises(AssertionError):
            audit.retention_policy_attestation()

    def test_symlink_parent_is_rejected_before_reading_the_target(self):
        operations = self.release / 'operations'
        actual = self.release / 'outside-operations'
        operations.rename(actual)
        operations.symlink_to(actual)
        with patch.object(audit.os, 'read') as read:
            with self.assertRaises(audit.RetentionAttestationError):
                audit.retention_policy_attestation()
            read.assert_not_called()

    def test_oversized_files_and_unit_metadata_are_rejected(self):
        self.paths['retention.py'].write_bytes(b'x' * 16385)
        with patch.object(audit.os, 'read') as read:
            with self.assertRaises(AssertionError):
                audit.retention_policy_attestation()
            read.assert_not_called()
        self.run.side_effect = None
        self.run.return_value = 'x' * 16385
        with self.assertRaises(AssertionError):
            audit.retention_policy_attestation()

    def test_content_and_path_replacement_during_hashing_are_rejected(self):
        original_read = os.read
        path = self.paths['retention.py']
        for replacement in (False, True):
            with self.subTest(replacement=replacement):
                changed = False
                def racing_read(fd, count):
                    nonlocal changed
                    content = original_read(fd, count)
                    if not changed:
                        changed = True
                        if replacement:
                            path.unlink()
                        path.write_text('changed during inspection')
                    return content
                with patch.object(audit.os, 'read', side_effect=racing_read):
                    with self.assertRaises(AssertionError):
                        audit.retention_policy_attestation()

    def test_unit_metadata_race_does_not_attest(self):
        calls = 0
        def changing_units(*args):
            nonlocal calls
            calls += 1
            if calls == 3:
                self.properties['becore-tickets-retention.service']['NeedDaemonReload'] = 'yes'
            return self.unit_output(*args)
        self.run.side_effect = changing_units
        result = audit.retention_policy_attestation()
        self.assertFalse(result['host_retention_policy_verified'])
        self.assertFalse(result['unit_checks']['becore-tickets-retention.service']['metadata_stable'])

    def test_pointer_or_parent_replacement_during_observation_is_rejected(self):
        for change_parent in (False, True):
            with self.subTest(change_parent=change_parent):
                calls = 0
                def racing_units(*args):
                    nonlocal calls
                    calls += 1
                    if calls == 3:
                        if change_parent:
                            operations = self.release / 'operations'
                            operations.rename(self.release / 'old-operations')
                            operations.mkdir()
                        else:
                            pointer = self.home / 'current'
                            pointer.unlink(); pointer.symlink_to(self.release)
                    return self.unit_output(*args)
                self.run.side_effect = racing_units
                with self.assertRaises(AssertionError):
                    audit.retention_policy_attestation()

    def test_fixed_stages_suppress_secret_exception_values(self):
        sentinel = 'secret-sentinel-credential-and-customer-value'
        for stage in audit.RETENTION_FAILURE_STAGES:
            with self.subTest(stage=stage):
                def fail(progress):
                    progress[0] = stage
                    raise OSError(sentinel)
                output = io.StringIO()
                with patch.object(audit, '_retention_policy_attestation', side_effect=fail), \
                     audit.contextlib.redirect_stderr(output):
                    with self.assertRaises(audit.RetentionAttestationError) as raised:
                        audit.retention_policy_attestation()
                    audit.report_readiness_failure(raised.exception)
                self.assertIn('Retention attestation stage: ' + stage + '.', output.getvalue())
                self.assertNotIn(sentinel, output.getvalue())
                self.assertNotIn(sentinel, str(raised.exception))
        for error in (RuntimeError(sentinel), audit.RetentionAttestationError(sentinel),
                      audit.RetentionAttestationError('pointer_metadata', sentinel)):
            output = io.StringIO()
            with audit.contextlib.redirect_stderr(output):
                audit.report_readiness_failure(error)
            self.assertNotIn(sentinel, output.getvalue())
            self.assertNotIn('Retention attestation stage:', output.getvalue())

    def test_unit_shape_failure_reports_stage_without_raw_values(self):
        self.run.side_effect = None
        self.run.return_value = 'Id=secret-sentinel-value\nprivate-invalid-line'
        with self.assertRaises(audit.RetentionAttestationError) as raised:
            audit.retention_policy_attestation()
        self.assertEqual(str(raised.exception), 'service_before_shape')

    def test_each_fixed_file_has_a_distinct_safe_metadata_failure_stage(self):
        for name, path in self.paths.items():
            with self.subTest(name=name):
                self.owner_overrides[path.stat().st_ino] = 1000
                try:
                    with self.assertRaises(audit.RetentionAttestationError) as raised:
                        audit.retention_policy_attestation()
                    self.assertEqual(str(raised.exception), audit.RETENTION_FILE_LABELS[name] + '_file_metadata')
                finally:
                    self.owner_overrides.clear()

    def test_explicit_all_preserves_empty_properties_without_widening_selection(self):
        def suppress_empty_without_all(*args):
            values = self.properties[args[2]]
            self.assertEqual(set(args[-1].removeprefix('--property=').split(',')), set(values))
            return '\n'.join(f'{key}={value}' for key, value in values.items() if value or '--all' in args)
        self.run.side_effect = suppress_empty_without_all
        self.assertTrue(audit.retention_policy_attestation()['host_retention_policy_verified'])
        self.assertTrue(all('--all' in call.args for call in self.run.call_args_list))

    def failed_unit_diagnostics(self):
        with self.assertRaises(audit.RetentionAttestationError) as raised:
            audit.retention_policy_attestation()
        output = io.StringIO()
        with audit.contextlib.redirect_stderr(output):
            audit.report_readiness_failure(raised.exception)
        return raised.exception, output.getvalue()

    def test_systemd_empty_exec_arrays_normalize_but_preserve_raw_presence(self):
        # systemd v255 systemctl-show.c prints Exec* arrays only inside its
        # per-command loop, so an empty array can be absent even with --all.
        def omit_empty_command_arrays(*args):
            return '\n'.join(f'{key}={value}' for key, value in self.properties[args[2]].items()
                             if value or not key.startswith('Exec'))
        self.run.side_effect = omit_empty_command_arrays
        result = audit.retention_policy_attestation()
        self.assertTrue(result['host_retention_policy_verified'])
        self.assertEqual(self.run.call_count, 4)
        self.assertEqual(set(result['unit_metadata']), {'service_before', 'timer_before', 'service_after', 'timer_after'})
        for phase in ('before', 'after'):
            service = result['unit_metadata']['service_' + phase]
            self.assertTrue(service['present']['ExecStart'])
            self.assertTrue(all(not service['present'][key] for key in audit.RETENTION_EMPTY_EXEC_ARRAYS))
            self.assertTrue(service['load_state_parseable'])
            self.assertEqual(service['load_state'], 'loaded')
            self.assertTrue(service['matches_expected']['LoadState'])
            self.assertEqual(service['malformed_count'] + service['duplicate_count'] + service['unexpected_count'], 0)

    def test_malformed_duplicate_and_unexpected_fields_emit_counts_not_names_or_values(self):
        sentinel = 'private-secret-sentinel'
        def corrupt_service(*args):
            raw = self.unit_output(*args)
            return raw + f'\n{sentinel}\nId={sentinel}\n{sentinel}={sentinel}' if args[2].endswith('.service') else raw
        self.run.side_effect = corrupt_service
        error, output = self.failed_unit_diagnostics()
        service = error.unit_diagnostics['service_before']
        self.assertEqual(service['malformed_count'], 1)
        self.assertEqual(service['duplicate_count'], 1)
        self.assertEqual(service['unexpected_count'], 1)
        self.assertTrue(service['present']['Id'])
        self.assertFalse(service['matches_expected']['Id'])
        self.assertNotIn(sentinel, output)
        self.assertNotIn(sentinel, json.dumps(error.unit_diagnostics))

    def test_unloaded_unit_and_missing_field_are_distinguishable(self):
        service_name = 'becore-tickets-retention.service'
        def unloaded_service(*args):
            if args[2] == service_name:
                return 'Id=' + service_name + '\nLoadState=not-found\nFragmentPath='
            return self.unit_output(*args)
        self.run.side_effect = unloaded_service
        error, output = self.failed_unit_diagnostics()
        item = error.unit_diagnostics['service_before']
        self.assertEqual(item['load_state'], 'not-found')
        self.assertTrue(item['matches_expected']['Id'])
        self.assertFalse(item['matches_expected']['FragmentPath'])
        self.assertFalse(item['present']['Type'])
        self.run.side_effect = lambda *args: '\n'.join(line for line in self.unit_output(*args).splitlines() if not line.startswith('Type='))
        error, output = self.failed_unit_diagnostics()
        item = error.unit_diagnostics['service_before']
        self.assertEqual(item['load_state'], 'loaded')
        self.assertFalse(item['present']['Type'])
        self.assertTrue(item['present']['ExecCondition'])

    def test_after_phase_shape_failure_keeps_both_before_and_after_summaries(self):
        calls = 0
        def missing_after_field(*args):
            nonlocal calls
            calls += 1
            raw = self.unit_output(*args)
            return '\n'.join(line for line in raw.splitlines() if not line.startswith('DropInPaths=')) if calls == 3 else raw
        self.run.side_effect = missing_after_field
        error, output = self.failed_unit_diagnostics()
        self.assertEqual(str(error), 'service_after_shape')
        self.assertEqual(set(error.unit_diagnostics), {'service_before', 'timer_before', 'service_after', 'timer_after'})
        self.assertTrue(error.unit_diagnostics['service_before']['present']['DropInPaths'])
        self.assertFalse(error.unit_diagnostics['service_after']['present']['DropInPaths'])

    def test_reporter_rejects_forged_summary_content(self):
        self.run.side_effect = lambda *args: 'LoadState=private-secret-sentinel'
        error, output = self.failed_unit_diagnostics()
        self.assertNotIn('private-secret-sentinel', output)
        original = error.unit_diagnostics['service_before']
        for field, value in (('load_state', {'private-secret-sentinel': True}),
                             ('unexpected_count', 'private-secret-sentinel'),
                             ('present', {'private-secret-sentinel': True})):
            error.unit_diagnostics = {'service_before': {**original, field: value}}
            output = io.StringIO()
            with audit.contextlib.redirect_stderr(output):
                audit.report_readiness_failure(error)
            self.assertNotIn('private-secret-sentinel', output.getvalue())
            self.assertNotIn('Retention unit metadata:', output.getvalue())

    def test_every_nonoptional_property_is_still_required_before_file_reads(self):
        for name, values in self.properties.items():
            optional = set(audit.RETENTION_EMPTY_EXEC_ARRAYS) if name.endswith('.service') else set()
            for omitted in set(values) - optional:
                with self.subTest(unit=name, omitted=omitted):
                    def omit_required(*args):
                        raw = self.unit_output(*args)
                        return '\n'.join(line for line in raw.splitlines() if not line.startswith(omitted + '=')) if args[2] == name else raw
                    self.run.side_effect = omit_required
                    with patch.object(audit.os, 'open') as opened:
                        self.failed_unit_diagnostics()
                    opened.assert_not_called()

    def test_each_nonempty_exec_hook_still_prevents_verification_and_is_suppressed(self):
        service = self.properties['becore-tickets-retention.service']
        for key in audit.RETENTION_EMPTY_EXEC_ARRAYS:
            with self.subTest(key=key):
                service[key] = 'private-unreviewed-command-sentinel'
                try:
                    result = audit.retention_policy_attestation()
                    self.assertFalse(result['host_retention_policy_verified'])
                    self.assertFalse(result['unit_checks']['becore-tickets-retention.service']['execution_matches'])
                    self.assertNotIn('private-unreviewed', json.dumps(result))
                finally:
                    service[key] = ''

    def test_empty_hook_normalization_does_not_bypass_loaded_identity_or_hashes(self):
        def omit_empty_command_arrays(*args):
            return '\n'.join(f'{key}={value}' for key, value in self.properties[args[2]].items()
                             if value or not key.startswith('Exec'))
        self.run.side_effect = omit_empty_command_arrays
        service = self.properties['becore-tickets-retention.service']
        for key, value in (('LoadState', 'not-found'), ('DropInPaths', '/private/unreviewed'), ('NeedDaemonReload', 'yes')):
            with self.subTest(key=key):
                original = service[key]
                service[key] = value
                try:
                    self.assertFalse(audit.retention_policy_attestation()['host_retention_policy_verified'])
                finally:
                    service[key] = original
        self.paths['retention.py'].write_text('unexpected-policy-sentinel')
        result = audit.retention_policy_attestation()
        self.assertFalse(result['host_retention_policy_verified'])
        self.assertFalse(result['files']['retention.py']['matches_reviewed'])
        self.assertNotIn('unexpected-policy-sentinel', json.dumps(result))

    def test_duplicate_empty_hook_is_rejected_despite_normalization(self):
        self.run.side_effect = lambda *args: self.unit_output(*args) + ('\nExecStartPre=' if args[2].endswith('.service') else '')
        error, output = self.failed_unit_diagnostics()
        self.assertEqual(error.unit_diagnostics['service_before']['duplicate_count'], 1)

if __name__ == '__main__': unittest.main()
