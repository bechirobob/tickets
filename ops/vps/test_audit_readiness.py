"""Read-only diagnostics contract tests using disposable isolated SQLite files."""
import importlib.util
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
            self.assertEqual(set(args[4].removeprefix('--property=').split(',')), set(self.properties[args[2]]))
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
            with self.assertRaises(OSError):
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

if __name__ == '__main__': unittest.main()
